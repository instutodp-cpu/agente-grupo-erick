'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateContextAssemblyRequest, ACCEPTABLE_MODEL_SELECTION_DECISION_STATUSES } = require('./context-assembly-request');
const {
  CONTEXT_ASSEMBLY_SECTION_VALIDATOR_VERSION,
  MAX_TOKENS_REFERENCE: MAX_SECTION_TOKENS,
  validateContextAssemblySection
} = require('./context-assembly-section');
const { deduplicateSourceReferences, buildContextAssemblyPlan } = require('./context-assembly-plan');
const { buildContextAssemblyResult } = require('./context-assembly-result');

const SOURCE_TYPE_TO_SECTION_TYPE = Object.freeze({
  SYSTEM_INSTRUCTION_REFERENCE: 'SYSTEM_SECTION',
  AGENT_IDENTITY_REFERENCE: 'AGENT_SECTION',
  AGENT_METADATA_REFERENCE: 'AGENT_SECTION',
  POLICY_REFERENCE: 'POLICY_SECTION',
  SESSION_REFERENCE: 'SESSION_SECTION',
  CONVERSATION_REFERENCE: 'SESSION_SECTION',
  MEMORY_REFERENCE: 'MEMORY_SECTION',
  TASK_REFERENCE: 'TASK_SECTION',
  USER_INPUT_REFERENCE: 'USER_INPUT_SECTION',
  DOCUMENT_REFERENCE: 'DOCUMENT_SECTION',
  TOOL_RESULT_REFERENCE: 'TOOL_RESULT_SECTION',
  WORKFLOW_REFERENCE: 'WORKFLOW_SECTION',
  MODEL_SELECTION_REFERENCE: 'MODEL_SELECTION_SECTION',
  AUDIT_REFERENCE: 'AUDIT_SECTION'
});
const SOURCE_TYPE_TO_ALLOW_FLAG = Object.freeze({
  SYSTEM_INSTRUCTION_REFERENCE: 'allow_system_instruction_reference',
  AGENT_IDENTITY_REFERENCE: 'allow_agent_identity_reference',
  AGENT_METADATA_REFERENCE: 'allow_agent_metadata_reference',
  POLICY_REFERENCE: 'allow_policy_reference',
  SESSION_REFERENCE: 'allow_session_reference',
  CONVERSATION_REFERENCE: 'allow_conversation_reference',
  MEMORY_REFERENCE: 'allow_memory_reference',
  TASK_REFERENCE: 'allow_task_reference',
  USER_INPUT_REFERENCE: 'allow_user_input_reference',
  DOCUMENT_REFERENCE: 'allow_document_reference',
  TOOL_RESULT_REFERENCE: 'allow_tool_result_reference',
  WORKFLOW_REFERENCE: 'allow_workflow_reference',
  MODEL_SELECTION_REFERENCE: 'allow_model_selection_reference',
  AUDIT_REFERENCE: 'allow_audit_reference'
});
// The Context Budget contract (per PR #87 spec) reserves a token pool per section type, but has
// no dedicated `reserved_model_selection_tokens` field — MODEL_SELECTION_SECTION content is
// metadata-sized (a reference, never real content) and shares the system pool by design.
const SECTION_TYPE_TO_RESERVED_FIELD = Object.freeze({
  SYSTEM_SECTION: 'reserved_system_tokens',
  AGENT_SECTION: 'reserved_agent_tokens',
  POLICY_SECTION: 'reserved_policy_tokens',
  SESSION_SECTION: 'reserved_session_tokens',
  MEMORY_SECTION: 'reserved_memory_tokens',
  TASK_SECTION: 'reserved_task_tokens',
  USER_INPUT_SECTION: 'reserved_user_input_tokens',
  DOCUMENT_SECTION: 'reserved_document_tokens',
  TOOL_RESULT_SECTION: 'reserved_tool_result_tokens',
  WORKFLOW_SECTION: 'reserved_workflow_tokens',
  MODEL_SELECTION_SECTION: 'reserved_system_tokens',
  AUDIT_SECTION: 'reserved_audit_tokens'
});
const REQUIRE_FLAG_TO_SECTION_TYPE = Object.freeze({
  require_policy_reference: 'POLICY_SECTION',
  require_session_reference: 'SESSION_SECTION',
  require_task_reference: 'TASK_SECTION',
  require_model_selection_reference: 'MODEL_SELECTION_SECTION'
});

function safeFingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function blockedResult(request, status, reasonCodes, extra = {}) {
  const agentRef = isPlainObject(request) && isPlainObject(request.agent_contract_reference) ? request.agent_contract_reference : {};
  const decision = buildContextAssemblyResult({
    result_id: isPlainObject(request) ? `context_assembly_result_${request.assembly_request_id || 'not_available'}` : 'context_assembly_result_not_available',
    assembly_request_id: isPlainObject(request) ? request.assembly_request_id : undefined,
    agent_id: agentRef.agent_id,
    tenant_id: agentRef.tenant_id,
    organization_id: agentRef.organization_id,
    status,
    request_fingerprint: isPlainObject(request) ? safeFingerprint(request) : undefined,
    policy_fingerprint: isPlainObject(request) && isPlainObject(request.assembly_policy) ? safeFingerprint(request.assembly_policy) : undefined,
    budget_fingerprint: isPlainObject(request) && isPlainObject(request.context_budget) ? safeFingerprint(request.context_budget) : undefined,
    model_selection_decision_fingerprint: isPlainObject(request) && isPlainObject(request.model_selection_decision_reference) ? safeFingerprint(request.model_selection_decision_reference) : undefined,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...extra
  });
  return { result: decision, plan: null, sections: [] };
}

function isSourceEligibleForPolicy(source, assemblyPolicy) {
  const allowFlag = SOURCE_TYPE_TO_ALLOW_FLAG[source.source_type];
  if (allowFlag && assemblyPolicy[allowFlag] !== true) return 'source_type_not_allowed_by_policy';
  if (source.trusted_reference !== true && assemblyPolicy.allow_untrusted_reference !== true) return 'untrusted_reference_not_allowed_by_policy';
  return null;
}

function allocateSectionBudget(sources, reservedTokens, overflowStrategy) {
  const sorted = [...sources].sort((a, b) => {
    const priorityDiff = (b.priority || 0) - (a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    if (a.source_reference_id < b.source_reference_id) return -1;
    if (a.source_reference_id > b.source_reference_id) return 1;
    return 0;
  });
  const totalEstimated = sorted.reduce((sum, source) => sum + source.estimated_tokens, 0);
  const hasRequired = sorted.some((source) => source.required === true);
  const requiredTotal = sorted.filter((source) => source.required === true).reduce((sum, source) => sum + source.estimated_tokens, 0);

  if (totalEstimated <= reservedTokens) {
    return {
      included: true, trimmed: false, excluded: false, allocatedTokens: totalEstimated,
      keptSourceIds: sorted.map((source) => source.source_reference_id), excludedSourceIds: [],
      exclusionReasonCodes: [], overflowDetected: false, blocksAssembly: false, blockReasonCodes: []
    };
  }

  if (requiredTotal > reservedTokens) {
    return {
      included: false, trimmed: false, excluded: true, allocatedTokens: 0, keptSourceIds: [],
      excludedSourceIds: sorted.map((source) => source.source_reference_id),
      exclusionReasonCodes: ['budget_overflow_required_exceeds_reserved'], overflowDetected: true,
      blocksAssembly: true, blockReasonCodes: ['budget_overflow_required_exceeds_reserved']
    };
  }

  if (overflowStrategy === 'BLOCK') {
    return {
      included: false, trimmed: false, excluded: true, allocatedTokens: 0, keptSourceIds: [],
      excludedSourceIds: sorted.map((source) => source.source_reference_id),
      exclusionReasonCodes: ['budget_overflow_block_strategy'], overflowDetected: true,
      blocksAssembly: hasRequired, blockReasonCodes: hasRequired ? ['budget_overflow_block_strategy'] : []
    };
  }

  if (overflowStrategy === 'REQUIRE_REASSEMBLY') {
    return {
      included: false, trimmed: false, excluded: true, allocatedTokens: 0, keptSourceIds: [],
      excludedSourceIds: sorted.map((source) => source.source_reference_id),
      exclusionReasonCodes: ['overflow_requires_reassembly'], overflowDetected: true,
      blocksAssembly: hasRequired, blockReasonCodes: hasRequired ? ['overflow_requires_reassembly'] : []
    };
  }

  if (overflowStrategy === 'TRIM_OPTIONAL_REFERENCES') {
    return {
      included: false, trimmed: true, excluded: false, allocatedTokens: reservedTokens,
      keptSourceIds: sorted.map((source) => source.source_reference_id), excludedSourceIds: [],
      exclusionReasonCodes: [], overflowDetected: true, blocksAssembly: false, blockReasonCodes: []
    };
  }

  // DROP_LOWEST_PRIORITY_OPTIONAL
  const kept = [...sorted];
  const droppedIds = [];
  while (kept.reduce((sum, source) => sum + source.estimated_tokens, 0) > reservedTokens) {
    let dropIndex = -1;
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      if (kept[i].required !== true) { dropIndex = i; break; }
    }
    if (dropIndex === -1) break;
    droppedIds.push(kept[dropIndex].source_reference_id);
    kept.splice(dropIndex, 1);
  }
  const keptTotal = kept.reduce((sum, source) => sum + source.estimated_tokens, 0);
  const trimmed = droppedIds.length > 0;
  return {
    included: !trimmed, trimmed, excluded: false, allocatedTokens: keptTotal,
    keptSourceIds: kept.map((source) => source.source_reference_id), excludedSourceIds: uniqueOrEmpty(droppedIds),
    exclusionReasonCodes: trimmed ? ['dropped_lowest_priority_optional'] : [], overflowDetected: true,
    blocksAssembly: false, blockReasonCodes: []
  };
}

function uniqueOrEmpty(list) {
  return Array.from(new Set(list));
}

function evaluateContextAssemblyRequest(request, context = {}) {
  const requestValidation = validateContextAssemblyRequest(request);
  if (!requestValidation.valid) {
    return blockedResult(request, 'VALIDATION_FAILED', requestValidation.errors);
  }

  const agentRef = request.agent_contract_reference;
  const sessionRef = request.session_reference;
  const policyRef = request.policy_decision_reference;
  const modelSelectionRef = request.model_selection_decision_reference;
  const assemblyPolicy = request.assembly_policy;
  const contextBudget = request.context_budget;
  const sources = request.source_references;

  if (isNonEmptyString(context.tenant_id) && context.tenant_id !== agentRef.tenant_id) {
    return blockedResult(request, 'TENANT_BLOCKED', ['requested_tenant_mismatch']);
  }
  if (isNonEmptyString(context.organization_id) && context.organization_id !== agentRef.organization_id) {
    return blockedResult(request, 'ORGANIZATION_BLOCKED', ['requested_organization_mismatch']);
  }

  if (sources.some((source) => source.tenant_id !== agentRef.tenant_id)) {
    return blockedResult(request, 'TENANT_BLOCKED', ['source_reference_tenant_mismatch']);
  }
  if (sources.some((source) => source.organization_id !== agentRef.organization_id)) {
    return blockedResult(request, 'ORGANIZATION_BLOCKED', ['source_reference_organization_mismatch']);
  }
  if (sources.some((source) => source.agent_id !== agentRef.agent_id && source.shareable !== true)) {
    return blockedResult(request, 'SOURCE_BLOCKED', ['source_reference_agent_mismatch_not_shareable']);
  }
  if (sources.some((source) => source.session_reference_id !== sessionRef.session_id && source.shareable !== true)) {
    return blockedResult(request, 'SESSION_BLOCKED', ['source_reference_session_mismatch_not_shareable']);
  }
  if (
    request.memory_retrieval_reference.memory_contract_id !== request.memory_contract_reference.memory_contract_id ||
    request.memory_retrieval_reference.agent_id !== agentRef.agent_id ||
    request.memory_retrieval_reference.session_reference_id !== sessionRef.session_id
  ) {
    return blockedResult(request, 'MEMORY_BLOCKED', ['memory_retrieval_reference_binding_mismatch']);
  }
  if (sources.some((source) => source.classification === 'RESTRICTED')) {
    return blockedResult(request, 'CLASSIFICATION_BLOCKED', ['restricted_classification_always_blocked']);
  }
  if (sources.some((source) => source.classification === 'CONFIDENTIAL') && assemblyPolicy.allow_confidential !== true) {
    return blockedResult(request, 'CLASSIFICATION_BLOCKED', ['confidential_classification_requires_explicit_policy']);
  }

  if (policyRef.policy_status === 'DENY' || policyRef.allowed_in_simulation !== true) {
    return blockedResult(request, 'POLICY_BLOCKED', ['policy_denies_assembly']);
  }

  if (!ACCEPTABLE_MODEL_SELECTION_DECISION_STATUSES.includes(modelSelectionRef.decision_status)) {
    return blockedResult(request, 'MODEL_SELECTION_BLOCKED', ['model_selection_decision_not_acceptable']);
  }
  if (
    Number.isInteger(context.expected_task_profile_reference_version) &&
    context.expected_task_profile_reference_version !== request.task_profile_reference.reference_version
  ) {
    return blockedResult(request, 'VERSION_BLOCKED', ['task_profile_reference_version_conflict']);
  }

  const conflictCheck = deduplicateSourceReferences(sources, { deduplicate: false });
  if (conflictCheck.conflict) {
    return blockedResult(request, 'CONFLICT_BLOCKED', [`required_source_conflict::${conflictCheck.conflictReferenceId}`]);
  }

  const groups = new Map();
  const preExclusions = [];
  for (const source of sources) {
    const sectionType = SOURCE_TYPE_TO_SECTION_TYPE[source.source_type];
    const reason = isSourceEligibleForPolicy(source, assemblyPolicy);
    if (reason) {
      preExclusions.push({ source, reason });
      continue;
    }
    if (!groups.has(sectionType)) groups.set(sectionType, []);
    groups.get(sectionType).push(source);
  }

  if (
    assemblyPolicy.fail_on_required_source_exclusion === true &&
    preExclusions.some((entry) => entry.source.required === true)
  ) {
    return blockedResult(request, 'SOURCE_BLOCKED', ['required_source_excluded_by_policy']);
  }

  for (const [flag, sectionType] of Object.entries(REQUIRE_FLAG_TO_SECTION_TYPE)) {
    if (assemblyPolicy[flag] === true && !(groups.get(sectionType) || []).length) {
      return blockedResult(request, 'SOURCE_BLOCKED', [`required_section_missing::${sectionType}`]);
    }
  }

  const sections = [];
  const includedSourceIds = [];
  const excludedSourceIds = [];
  const deduplicatedSourceIds = [];
  let overflowDetected = false;
  let blockStatus = null;
  let blockReasonCodes = [];

  for (const [sectionType, groupSources] of groups.entries()) {
    const dedupResult = deduplicateSourceReferences(groupSources, { deduplicate: assemblyPolicy.deduplicate_sources === true });
    if (dedupResult.conflict) {
      return blockedResult(request, 'CONFLICT_BLOCKED', [`required_source_conflict::${dedupResult.conflictReferenceId}`]);
    }
    for (const id of dedupResult.deduplicatedIds) deduplicatedSourceIds.push(id);
    for (const id of dedupResult.excludedIds) excludedSourceIds.push(id);

    const reservedField = SECTION_TYPE_TO_RESERVED_FIELD[sectionType];
    const reservedTokens = contextBudget[reservedField];
    const allocation = dedupResult.kept.length > 0
      ? allocateSectionBudget(dedupResult.kept, reservedTokens, contextBudget.overflow_strategy)
      : {
        included: false, trimmed: false, excluded: true, allocatedTokens: 0, keptSourceIds: [], excludedSourceIds: [],
        exclusionReasonCodes: ['no_eligible_source_for_section'], overflowDetected: false, blocksAssembly: false, blockReasonCodes: []
      };
    if (allocation.overflowDetected) overflowDetected = true;
    if (allocation.blocksAssembly && !blockStatus) {
      blockStatus = 'BUDGET_BLOCKED';
      blockReasonCodes = allocation.blockReasonCodes;
    }

    for (const id of allocation.keptSourceIds) includedSourceIds.push(id);
    for (const id of allocation.excludedSourceIds) excludedSourceIds.push(id);

    const sectionRequired = dedupResult.kept.some((source) => source.required === true);
    if (sectionRequired && allocation.excluded && assemblyPolicy.fail_on_required_source_exclusion === true && !blockStatus) {
      blockStatus = allocation.exclusionReasonCodes.some((code) => code.startsWith('budget_overflow') || code.startsWith('overflow_requires_reassembly'))
        ? 'BUDGET_BLOCKED'
        : 'SOURCE_BLOCKED';
      blockReasonCodes = allocation.exclusionReasonCodes;
    }

    const sourceIds = [...allocation.keptSourceIds].sort();
    const sectionEstimatedTokens = dedupResult.kept.reduce((sum, source) => sum + source.estimated_tokens, 0);
    const section = {
      section_id: `section-${sectionType.toLowerCase()}`,
      section_version: 1,
      section_type: sectionType,
      source_reference_ids: sourceIds,
      source_count: sourceIds.length,
      priority: dedupResult.kept.reduce((max, source) => Math.max(max, source.priority || 0), 0),
      required: sectionRequired,
      estimated_tokens: Math.min(sectionEstimatedTokens, MAX_SECTION_TOKENS),
      allocated_tokens: allocation.allocatedTokens,
      included: allocation.included,
      trimmed: allocation.trimmed,
      excluded: allocation.excluded,
      exclusion_reason_codes: allocation.exclusionReasonCodes,
      section_fingerprint: safeFingerprint({ sectionType, sourceIds }),
      validator_version: CONTEXT_ASSEMBLY_SECTION_VALIDATOR_VERSION
    };
    const sectionValidation = validateContextAssemblySection(section);
    if (!sectionValidation.valid) {
      return blockedResult(request, 'VALIDATION_FAILED', sectionValidation.errors);
    }
    sections.push(section);
  }

  if (blockStatus) {
    return blockedResult(request, blockStatus, blockReasonCodes);
  }

  const plan = buildContextAssemblyPlan({
    planId: `plan-${request.assembly_request_id}`,
    assemblyRequestId: request.assembly_request_id,
    tenantId: agentRef.tenant_id,
    organizationId: agentRef.organization_id,
    sections,
    includedSourceIds,
    excludedSourceIds: [...excludedSourceIds, ...preExclusions.map((entry) => entry.source.source_reference_id)],
    deduplicatedSourceIds,
    reservedOutputTokens: contextBudget.reserved_output_tokens,
    overflowDetected,
    overflowStrategy: contextBudget.overflow_strategy,
    maximumTotalTokens: contextBudget.maximum_total_tokens
  });

  const isModelSelected = modelSelectionRef.decision_status === 'MODEL_SELECTED_SIMULATION';
  const result = buildContextAssemblyResult({
    result_id: `context_assembly_result_${request.assembly_request_id}`,
    assembly_request_id: request.assembly_request_id,
    agent_id: agentRef.agent_id,
    tenant_id: agentRef.tenant_id,
    organization_id: agentRef.organization_id,
    status: 'ASSEMBLY_PLANNED_SIMULATION',
    context_package_reference_id: `context_package_${plan.plan_id}`,
    selected_model_reference_id: isModelSelected ? modelSelectionRef.selected_model_id : null,
    selected_provider_reference_id: isModelSelected ? modelSelectionRef.selected_provider_id : null,
    section_fingerprints: sections.map((section) => section.section_fingerprint),
    source_fingerprints: sources.map((source) => source.source_fingerprint),
    plan_fingerprint: plan.plan_fingerprint,
    request_fingerprint: safeFingerprint(request),
    policy_fingerprint: safeFingerprint(assemblyPolicy),
    budget_fingerprint: safeFingerprint(contextBudget),
    model_selection_decision_fingerprint: safeFingerprint(modelSelectionRef),
    total_estimated_tokens: plan.total_estimated_tokens,
    total_allocated_tokens: plan.total_allocated_tokens,
    remaining_context_tokens: plan.remaining_context_tokens,
    included_section_count: plan.included_section_ids.length,
    excluded_section_count: plan.excluded_section_ids.length,
    trimmed_section_count: plan.trimmed_section_ids.length,
    included_source_count: plan.included_source_reference_ids.length,
    excluded_source_count: plan.excluded_source_reference_ids.length,
    request_validated: true,
    policy_validated: true,
    budget_validated: true,
    sources_validated: true,
    selection_validated: true,
    reason_codes: ['context_assembly_reviewed_simulation_only']
  });

  return { result, plan, sections };
}

module.exports = {
  REQUIRE_FLAG_TO_SECTION_TYPE,
  SECTION_TYPE_TO_RESERVED_FIELD,
  SOURCE_TYPE_TO_ALLOW_FLAG,
  SOURCE_TYPE_TO_SECTION_TYPE,
  allocateSectionBudget,
  evaluateContextAssemblyRequest
};
