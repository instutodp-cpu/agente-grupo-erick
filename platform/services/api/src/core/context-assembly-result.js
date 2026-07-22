'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const CONTEXT_ASSEMBLY_RESULT_VALIDATOR_VERSION = 'context_assembly_result_validator_v1';
const CONTEXT_ASSEMBLY_RESULT_FIELDS = Object.freeze([
  'result_id', 'assembly_request_id', 'agent_id', 'tenant_id', 'organization_id', 'status', 'decision',
  'context_package_reference_id', 'selected_model_reference_id', 'selected_provider_reference_id',
  'section_fingerprints', 'source_fingerprints', 'plan_fingerprint', 'request_fingerprint', 'policy_fingerprint',
  'budget_fingerprint', 'model_selection_decision_fingerprint', 'total_estimated_tokens', 'total_allocated_tokens',
  'remaining_context_tokens', 'included_section_count', 'excluded_section_count', 'trimmed_section_count',
  'included_source_count', 'excluded_source_count', 'blockers', 'reason_codes', 'request_validated',
  'policy_validated', 'budget_validated', 'sources_validated', 'selection_validated', 'assembly_planned',
  'context_assembled', 'content_loaded', 'history_loaded', 'memory_loaded', 'document_loaded', 'tool_result_loaded',
  'prompt_generated', 'provider_called', 'model_called', 'network_used', 'tokens_consumed', 'cost_consumed',
  'executed', 'runtime_enabled', 'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);
const RESULT_STATUSES = Object.freeze([
  'ASSEMBLY_PLANNED_SIMULATION', 'DENY', 'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED',
  'POLICY_BLOCKED', 'SESSION_BLOCKED', 'MEMORY_BLOCKED', 'SOURCE_BLOCKED', 'CLASSIFICATION_BLOCKED',
  'BUDGET_BLOCKED', 'MODEL_SELECTION_BLOCKED', 'CONFLICT_BLOCKED', 'VERSION_BLOCKED'
]);
const DECISION_VALUES = Object.freeze(['PLAN_CONTEXT_REFERENCE', 'BLOCKED']);
const CONTEXT_ASSEMBLY_RESULT_SAFE_FLAGS = Object.freeze({
  context_assembled: false,
  content_loaded: false,
  history_loaded: false,
  memory_loaded: false,
  document_loaded: false,
  tool_result_loaded: false,
  prompt_generated: false,
  provider_called: false,
  model_called: false,
  network_used: false,
  tokens_consumed: false,
  cost_consumed: false,
  executed: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const BLOCKED_CONTEXT_PACKAGE_SENTINEL = 'CONTEXT_PACKAGE_NOT_AVAILABLE';
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_COUNT = 500;
const MAX_LIST_ITEMS = 500;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateContextAssemblyResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['result_must_be_object'] };
  exactFields(result, CONTEXT_ASSEMBLY_RESULT_FIELDS, 'result', errors);
  for (const field of [
    'result_id', 'assembly_request_id', 'agent_id', 'tenant_id', 'organization_id', 'context_package_reference_id',
    'plan_fingerprint', 'request_fingerprint', 'policy_fingerprint', 'budget_fingerprint',
    'model_selection_decision_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!RESULT_STATUSES.includes(result.status)) errors.push(`status_not_allowed::${result.status}`);
  if (!DECISION_VALUES.includes(result.decision)) errors.push(`decision_not_allowed::${result.decision}`);
  if (result.selected_model_reference_id !== null && !isNonEmptyString(result.selected_model_reference_id)) errors.push('selected_model_reference_id_must_be_null_or_string');
  if (result.selected_provider_reference_id !== null && !isNonEmptyString(result.selected_provider_reference_id)) errors.push('selected_provider_reference_id_must_be_null_or_string');
  if (!isOrderedUniqueStringList(result.section_fingerprints)) errors.push('section_fingerprints_invalid');
  if (!isOrderedUniqueStringList(result.source_fingerprints)) errors.push('source_fingerprints_invalid');
  for (const field of ['total_estimated_tokens', 'total_allocated_tokens']) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(result.remaining_context_tokens) || result.remaining_context_tokens < -MAX_TOKENS_REFERENCE || result.remaining_context_tokens > MAX_TOKENS_REFERENCE) {
    errors.push('remaining_context_tokens_invalid');
  }
  for (const field of ['included_section_count', 'excluded_section_count', 'trimmed_section_count', 'included_source_count', 'excluded_source_count']) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueStringList(result.blockers)) errors.push('blockers_invalid');
  if (!isOrderedUniqueStringList(result.reason_codes)) errors.push('reason_codes_invalid');
  for (const field of ['request_validated', 'policy_validated', 'budget_validated', 'sources_validated', 'selection_validated']) {
    if (typeof result[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof result.assembly_planned !== 'boolean') errors.push('assembly_planned_must_be_boolean');
  if (result.assembly_planned === true && result.status !== 'ASSEMBLY_PLANNED_SIMULATION') errors.push('assembly_planned_inconsistent_with_status');
  if (result.assembly_planned === false && result.status === 'ASSEMBLY_PLANNED_SIMULATION') errors.push('assembly_planned_must_be_true_for_planned_status');
  for (const [field, expected] of Object.entries(CONTEXT_ASSEMBLY_RESULT_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (result.status === 'ASSEMBLY_PLANNED_SIMULATION') {
    if (result.decision !== 'PLAN_CONTEXT_REFERENCE') errors.push('decision_must_be_plan_context_reference');
  } else {
    if (result.decision !== 'BLOCKED') errors.push('decision_must_be_blocked');
    if (result.context_package_reference_id !== BLOCKED_CONTEXT_PACKAGE_SENTINEL) errors.push('context_package_reference_id_must_be_sentinel_when_blocked');
    if (result.selected_model_reference_id !== null) errors.push('selected_model_reference_id_must_be_null_when_blocked');
    if (result.selected_provider_reference_id !== null) errors.push('selected_provider_reference_id_must_be_null_when_blocked');
  }

  if (result.validator_version !== CONTEXT_ASSEMBLY_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildContextAssemblyResult(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const isPlanned = status === 'ASSEMBLY_PLANNED_SIMULATION';
  const result = {
    result_id: overrides.result_id || 'context_assembly_result_not_available',
    assembly_request_id: overrides.assembly_request_id || 'assembly_request_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    organization_id: overrides.organization_id || 'organization_not_available',
    status,
    decision: isPlanned ? 'PLAN_CONTEXT_REFERENCE' : 'BLOCKED',
    context_package_reference_id: isPlanned ? (overrides.context_package_reference_id || 'context_package_not_available') : BLOCKED_CONTEXT_PACKAGE_SENTINEL,
    selected_model_reference_id: isPlanned ? (overrides.selected_model_reference_id || null) : null,
    selected_provider_reference_id: isPlanned ? (overrides.selected_provider_reference_id || null) : null,
    section_fingerprints: Array.isArray(overrides.section_fingerprints) ? uniqueSorted(overrides.section_fingerprints) : [],
    source_fingerprints: Array.isArray(overrides.source_fingerprints) ? uniqueSorted(overrides.source_fingerprints) : [],
    plan_fingerprint: overrides.plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    request_fingerprint: overrides.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    policy_fingerprint: overrides.policy_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    budget_fingerprint: overrides.budget_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    model_selection_decision_fingerprint: overrides.model_selection_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    total_estimated_tokens: Number.isInteger(overrides.total_estimated_tokens) ? overrides.total_estimated_tokens : 0,
    total_allocated_tokens: Number.isInteger(overrides.total_allocated_tokens) ? overrides.total_allocated_tokens : 0,
    remaining_context_tokens: Number.isInteger(overrides.remaining_context_tokens) ? overrides.remaining_context_tokens : 0,
    included_section_count: Number.isInteger(overrides.included_section_count) ? overrides.included_section_count : 0,
    excluded_section_count: Number.isInteger(overrides.excluded_section_count) ? overrides.excluded_section_count : 0,
    trimmed_section_count: Number.isInteger(overrides.trimmed_section_count) ? overrides.trimmed_section_count : 0,
    included_source_count: Number.isInteger(overrides.included_source_count) ? overrides.included_source_count : 0,
    excluded_source_count: Number.isInteger(overrides.excluded_source_count) ? overrides.excluded_source_count : 0,
    blockers: Array.isArray(overrides.blockers) ? uniqueSorted(overrides.blockers) : [],
    reason_codes: Array.isArray(overrides.reason_codes) ? uniqueSorted(overrides.reason_codes) : [],
    request_validated: overrides.request_validated === true,
    policy_validated: overrides.policy_validated === true,
    budget_validated: overrides.budget_validated === true,
    sources_validated: overrides.sources_validated === true,
    selection_validated: overrides.selection_validated === true,
    assembly_planned: isPlanned,
    validator_version: CONTEXT_ASSEMBLY_RESULT_VALIDATOR_VERSION,
    ...CONTEXT_ASSEMBLY_RESULT_SAFE_FLAGS
  };
  const validation = validateContextAssemblyResult(result);
  if (!validation.valid) {
    return cloneFrozen({
      ...result,
      status: 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      context_package_reference_id: BLOCKED_CONTEXT_PACKAGE_SENTINEL,
      selected_model_reference_id: null,
      selected_provider_reference_id: null,
      assembly_planned: false,
      blockers: uniqueSorted([...(result.blockers || []), ...validation.errors]),
      reason_codes: uniqueSorted([...(result.reason_codes || []), validation.errors[0] || 'context_assembly_result_invalid']),
      ...CONTEXT_ASSEMBLY_RESULT_SAFE_FLAGS
    });
  }
  return cloneFrozen(result);
}

module.exports = {
  BLOCKED_CONTEXT_PACKAGE_SENTINEL,
  CONTEXT_ASSEMBLY_RESULT_FIELDS,
  CONTEXT_ASSEMBLY_RESULT_SAFE_FLAGS,
  CONTEXT_ASSEMBLY_RESULT_VALIDATOR_VERSION,
  DECISION_VALUES,
  NOT_AVAILABLE_FINGERPRINT,
  RESULT_STATUSES,
  buildContextAssemblyResult,
  validateContextAssemblyResult
};
