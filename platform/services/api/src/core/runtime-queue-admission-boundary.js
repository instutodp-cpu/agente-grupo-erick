'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { findAgentCoreOperationalMaterial } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { checkIdentity } = require('./runtime-execution-package');
const { stablePayload, stablePayload: computeOfficialPolicyFingerprint } = require('./transcription-provider-contract-registry');
const { computeSnapshotFingerprint } = require('./execution-registry-snapshot-reference');
const { FRESHNESS_DIMENSIONS } = require('./runtime-readiness-freshness-reference');
const { computeIdempotencyFingerprint } = require('./execution-plan-idempotency');
const { validateRuntimeQueueAdmissionRequest, omitQueueAdmissionReplayReference } = require('./runtime-queue-admission-request');
const { QUEUE_CLASS_TYPES, QUEUE_PRIORITY_CLASSES } = require('./runtime-queue-class-reference');
const { buildRuntimeQueuePartitionReference, STRATEGY_TO_KEY_TYPE } = require('./runtime-queue-partition-reference');
const { buildRuntimeQueueFairnessReference } = require('./runtime-queue-fairness-reference');
const { buildRuntimeQueueIntentBindingReference } = require('./runtime-queue-intent-binding-reference');
const { buildRuntimeQueueAdmissionEntryReference } = require('./runtime-queue-admission-entry-reference');
const { buildRuntimeQueueAdmissionOrderReference } = require('./runtime-queue-admission-order-reference');
const { buildRuntimeQueueAdmissionPackage } = require('./runtime-queue-admission-package');
const { buildRuntimeQueueAdmissionDecision } = require('./runtime-queue-admission-decision');
const { buildRuntimeQueueAdmissionResult } = require('./runtime-queue-admission-result');
const { buildRuntimeQueueAdmissionAudit } = require('./runtime-queue-admission-audit');

// pr108: the single evaluator this PR exists to build. Receives only an already
// DISPATCH_PACKAGE_PREPARED_SIMULATION package (plus the full Worker Assignment/Scheduler/Runtime
// chain underneath it) and produces a purely declarative envelope describing which Dispatch Intents
// would be admissible into a future logical queue, with what queue class/partition/fairness rank --
// nothing here creates a queue, an item, an enqueue, a reservation, or a dispatch. Every one of
// those flags is forced false in every outcome this boundary can ever produce.

const PRIORITY_RANK = Object.freeze({
  CRITICAL_REFERENCE: 0, HIGH_REFERENCE: 1, NORMAL_REFERENCE: 2, LOW_REFERENCE: 3, BACKGROUND_REFERENCE: 4
});

// "dedicated/project/agent antes de organization/tenant/shared" -- tier 0 is more specific than
// tier 1, which is more specific than tier 2 (shared).
const QUEUE_CLASS_SPECIFICITY_RANK = Object.freeze({
  DEDICATED_QUEUE_REFERENCE: 0, PROJECT_QUEUE_REFERENCE: 1, AGENT_QUEUE_REFERENCE: 1,
  ORGANIZATION_QUEUE_REFERENCE: 2, TENANT_QUEUE_REFERENCE: 2, SHARED_QUEUE_REFERENCE: 3
});

// pr108fix FIX 3: "Nesta PR, suportar operacionalmente somente FIFO_WITHIN_PRIORITY_REFERENCE."
// STRICT_PRIORITY_WITH_TENANT_FAIRNESS/WEIGHTED_ROUND_ROBIN_REFERENCE/DETERMINISTIC_FAIR_SHARE_REFERENCE
// remain declared on RuntimeQueueClassReference's own enum for a future version, but any Queue Class
// that declares one of them is never selected -- fail-closed, never simulated as FIFO.
const FAIRNESS_STRATEGIES_IMPLEMENTED = Object.freeze(['FIFO_WITHIN_PRIORITY_REFERENCE']);

// pr108fix FIX 2: the four scopes every Queue Class candidate must carry a complete, genuinely
// identity-bound quota collection for -- "A policy e a spec exigem avaliação por: tenant;
// organização; projeto; agente."
const QUOTA_SCOPE_TYPES = Object.freeze(['TENANT', 'ORGANIZATION', 'PROJECT', 'AGENT']);

function classifyQuotaScope(quota) {
  if (quota.tenant_id !== null) return 'TENANT';
  if (quota.organization_id !== null) return 'ORGANIZATION';
  if (quota.project_id !== null) return 'PROJECT';
  if (quota.agent_id !== null) return 'AGENT';
  return null;
}

const NON_PREPARED_STATUS_MAP = Object.freeze({
  DISPATCH_INTENT_WAITING_DEPENDENCY_REFERENCE: 'QUEUE_ADMISSION_WAITING_DEPENDENCY_REFERENCE',
  DISPATCH_INTENT_WAITING_APPROVAL_REFERENCE: 'QUEUE_ADMISSION_WAITING_APPROVAL_REFERENCE',
  DISPATCH_INTENT_OPTIONAL_REFERENCE: 'QUEUE_ADMISSION_OPTIONAL_REFERENCE',
  DISPATCH_INTENT_NO_WORKER_BLOCKED: 'QUEUE_ADMISSION_NO_WORKER_BLOCKED',
  DISPATCH_INTENT_CAPACITY_BLOCKED: 'QUEUE_ADMISSION_CAPACITY_BLOCKED',
  DISPATCH_INTENT_BUDGET_BLOCKED: 'QUEUE_ADMISSION_BUDGET_BLOCKED',
  DISPATCH_INTENT_POLICY_BLOCKED: 'QUEUE_ADMISSION_POLICY_BLOCKED',
  DISPATCH_INTENT_BLOCKED: 'QUEUE_ADMISSION_BLOCKED'
});

// pr108: "Dispatch não pode ser apenas stage ID + worker ID" -- reused verbatim from
// runtime-dispatch-boundary.js's own non-substitution discipline, applied here to every raw
// Dispatch reference list the Queue Admission Request carries.
function idSetMatches(rawList, idField, expectedIds) {
  if (!Array.isArray(rawList) || !Array.isArray(expectedIds)) return false;
  const actual = [...new Set(rawList.map((item) => item[idField]))].sort();
  const expected = [...new Set(expectedIds)].sort();
  if (actual.length !== expected.length) return false;
  return actual.every((id, index) => id === expected[index]);
}

function fingerprintSetMatches(rawList, computeFingerprint, expectedFingerprints) {
  if (!Array.isArray(rawList) || !Array.isArray(expectedFingerprints)) return false;
  const actual = [...new Set(rawList.map((item) => computeFingerprint(item)))].sort();
  const expected = [...new Set(expectedFingerprints)].sort();
  if (actual.length !== expected.length) return false;
  return actual.every((fp, index) => fp === expected[index]);
}

// pr108: "A partition key deve ser derivada da strategy... Não usar conteúdo de prompt ou mensagem."
function derivePartitionKeyValue(strategy, ctx) {
  const { canonical, stage } = ctx;
  switch (strategy) {
    case 'TENANT_PARTITION_REFERENCE': return canonical.tenantId;
    case 'ORGANIZATION_PARTITION_REFERENCE': return canonical.organizationId;
    case 'PROJECT_PARTITION_REFERENCE': return canonical.projectId;
    case 'AGENT_PARTITION_REFERENCE': return canonical.agentId;
    case 'CAPABILITY_PARTITION_REFERENCE': return [...stage.required_capabilities].sort().join(',') || 'no_capability_reference';
    case 'STAGE_TYPE_PARTITION_REFERENCE': return stage.stage_type;
    case 'COMPOSITE_PARTITION_REFERENCE':
      return stablePayload({
        tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
        agent_id: canonical.agentId, stage_type: stage.stage_type, capability_ids: [...stage.required_capabilities].sort()
      });
    default: return null;
  }
}

// pr108fix FIX 1/FIX 2/FIX 3/FIX 4: every reason a single Queue Class candidate is genuinely
// incompatible with a stage -- structural compatibility (scope/stage-type/capability/modality/
// supports_* flags), real provider/model/tool/workflow ID membership (never just supports_*),
// capacity snapshot freshness at this admission's own sequence, complete tenant+organization+
// project+agent quota collection, and fairness strategy actually implemented. Returns an empty list
// when genuinely compatible -- never a boolean alone, so the boundary can surface the specific
// reason(s) an entry with no compatible class was rejected for.
function evaluateQueueClassCompatibility(qc, stage, ctx) {
  const {
    canonical, stagePolicyRequirementsByStageId, modelSelectionDecisionsById, validCapacityClassIds,
    capacitySnapshotByClassId, quotaCollectionByClassId
  } = ctx;
  const reasons = [];
  const classId = qc.runtime_queue_class_reference_id;

  const isExternalOrIrreversible = stage.side_effect_classification === 'EXTERNAL_EFFECT_REFERENCE' || stage.side_effect_classification === 'IRREVERSIBLE_REFERENCE';
  if (qc.queue_class_active !== true || isExternalOrIrreversible) {
    reasons.push('queue_class_inactive_or_never_external_or_irreversible');
  }
  const scopeOk = (qc.tenant_scope_id === null || qc.tenant_scope_id === canonical.tenantId)
    && (qc.organization_scope_id === null || qc.organization_scope_id === canonical.organizationId)
    && (qc.project_scope_id === null || qc.project_scope_id === canonical.projectId)
    && (qc.agent_scope_ids.length === 0 || qc.agent_scope_ids.includes(canonical.agentId));
  if (!scopeOk) reasons.push('queue_class_scope_mismatch');
  if (!qc.supported_stage_types.includes(stage.stage_type)) reasons.push('queue_class_stage_type_mismatch');
  if (!stage.required_capabilities.every((id) => qc.supported_capability_ids.includes(id))) reasons.push('queue_class_capability_mismatch');
  if (!stage.required_modalities.every((id) => qc.supported_modality_ids.includes(id))) reasons.push('queue_class_modality_mismatch');

  const hasModel = stage.model_selection_reference_id !== null;
  const hasTools = Array.isArray(stage.tool_reference_ids) && stage.tool_reference_ids.length > 0;
  const hasWorkflow = stage.workflow_reference_id !== null;
  const isStateChange = stage.side_effect_classification === 'STATE_CHANGE_REFERENCE';

  if (hasModel && qc.supports_model !== true) reasons.push('queue_class_model_support_missing');
  if (hasTools && qc.supports_tool !== true) reasons.push('queue_class_tool_support_missing');
  if (hasWorkflow && qc.supports_workflow !== true) reasons.push('queue_class_workflow_support_missing');
  if (stage.optional === true && qc.supports_optional !== true) reasons.push('queue_class_optional_support_missing');
  if (stage.parallelizable === true && qc.supports_parallel !== true) reasons.push('queue_class_parallel_support_missing');
  if (isStateChange && qc.supports_state_change !== true) reasons.push('queue_class_state_change_support_missing');

  // pr108fix FIX 1: "Uma fila pode aceitar um provider, model, tool ou workflow que não está em sua
  // allowlist." Derived from the stage's own genuinely RESOLVED Stage Policy Requirements -- never
  // trusting an UNRESOLVED claim, never treating an empty supported_*_ids list as a wildcard.
  const stageReqs = stagePolicyRequirementsByStageId.get(stage.scheduler_stage_reference_id) || [];
  if (hasModel) {
    const modelReq = stageReqs.find((r) => r.requirement_element === 'MODEL');
    if (!modelReq || modelReq.source_resolution_status !== 'RESOLVED_FROM_OFFICIAL_REFERENCE') {
      reasons.push('queue_class_stage_requirement_unresolvable');
    } else {
      const decision = modelSelectionDecisionsById.get(modelReq.source_reference_id);
      if (!decision || stablePayload(decision) !== modelReq.source_reference_fingerprint) {
        reasons.push('queue_class_stage_requirement_unresolvable');
      } else {
        if (!qc.supported_model_provider_ids.includes(decision.selected_provider_id)) reasons.push('queue_class_model_provider_mismatch');
        if (!qc.supported_model_ids.includes(decision.selected_model_id)) reasons.push('queue_class_model_id_mismatch');
      }
    }
  }
  if (hasTools) {
    // "Não aceitar interseção parcial de tools" -- every tool the stage requires must independently
    // resolve and independently appear in supported_tool_ids.
    for (const toolId of stage.tool_reference_ids) {
      const toolReq = stageReqs.find((r) => r.requirement_element === 'TOOL' && r.source_reference_id === toolId);
      if (!toolReq || toolReq.source_resolution_status !== 'RESOLVED_FROM_OFFICIAL_REFERENCE') {
        reasons.push('queue_class_stage_requirement_unresolvable');
      } else if (!qc.supported_tool_ids.includes(toolId)) {
        reasons.push(`queue_class_tool_id_mismatch::${toolId}`);
      }
    }
  }
  if (hasWorkflow) {
    const workflowReq = stageReqs.find((r) => r.requirement_element === 'WORKFLOW' && r.source_reference_id === stage.workflow_reference_id);
    if (!workflowReq || workflowReq.source_resolution_status !== 'RESOLVED_FROM_OFFICIAL_REFERENCE') {
      reasons.push('queue_class_stage_requirement_unresolvable');
    } else if (!qc.supported_workflow_ids.includes(stage.workflow_reference_id)) {
      reasons.push('queue_class_workflow_id_mismatch');
    }
  }

  // pr108fix FIX 4: capacity snapshot must be present and genuinely fresh at this admission's own
  // logical_sequence -- never trusted merely because it exists for this class.
  if (!capacitySnapshotByClassId.has(classId)) reasons.push('queue_capacity_snapshot_missing_for_class');
  else if (!validCapacityClassIds.has(classId)) reasons.push('queue_capacity_snapshot_not_valid_at_admission');

  // pr108fix FIX 2: "Uma classe com apenas quota de tenant pode passar" -- no longer. Requires the
  // complete, genuinely identity-bound tenant+organization+project+agent quota collection.
  if (!quotaCollectionByClassId.has(classId)) reasons.push('queue_quota_collection_incomplete');

  // pr108fix FIX 3: only FIFO_WITHIN_PRIORITY_REFERENCE is operationally implemented this version.
  if (!FAIRNESS_STRATEGIES_IMPLEMENTED.includes(qc.queue_fairness_strategy)) {
    reasons.push(`queue_fairness_strategy_not_implemented::${qc.queue_fairness_strategy}`);
  }

  return reasons;
}

// pr108: "Seleção da Queue Class" -- filters queue classes down to those genuinely compatible with
// this stage, then sorts the survivors deterministically. Also returns every rejection reason
// collected across every candidate, so the boundary can distinguish "blocked only because no
// implemented fairness strategy was available" from every other blocking reason.
function sortQueueClassCandidates(candidates, capacitySnapshotByClassId) {
  return [...candidates].sort((a, b) => {
    const specificityDiff = QUEUE_CLASS_SPECIFICITY_RANK[a.queue_class_type] - QUEUE_CLASS_SPECIFICITY_RANK[b.queue_class_type];
    if (specificityDiff !== 0) return specificityDiff;
    const priorityDiff = PRIORITY_RANK[a.queue_priority_class] - PRIORITY_RANK[b.queue_priority_class];
    if (priorityDiff !== 0) return priorityDiff;
    const capA = capacitySnapshotByClassId.get(a.runtime_queue_class_reference_id);
    const capB = capacitySnapshotByClassId.get(b.runtime_queue_class_reference_id);
    if (capB.available_backlog_count !== capA.available_backlog_count) return capB.available_backlog_count - capA.available_backlog_count;
    if (capB.available_inflight_count !== capA.available_inflight_count) return capB.available_inflight_count - capA.available_inflight_count;
    if (capB.available_parallel_count !== capA.available_parallel_count) return capB.available_parallel_count - capA.available_parallel_count;
    if (capB.available_tokens !== capA.available_tokens) return capB.available_tokens - capA.available_tokens;
    if (capB.available_cost_minor_units !== capA.available_cost_minor_units) return capB.available_cost_minor_units - capA.available_cost_minor_units;
    if (capA.current_backlog_count !== capB.current_backlog_count) return capA.current_backlog_count - capB.current_backlog_count;
    return a.runtime_queue_class_reference_id < b.runtime_queue_class_reference_id ? -1 : 1;
  });
}

// pr108fix4: reasons `evaluateQueueClassCompatibility` can produce that describe a RESOURCE-STATE
// disqualification (capacity/freshness, fairness strategy) rather than a genuine STRUCTURAL
// incompatibility (scope, stage type, capabilities, modalities, real provider/model/tool/workflow
// IDs, quota collection completeness). Capacity/freshness/fairness each have their own dedicated
// gate (`capacity_gate_passed`/`freshness_gate_passed`/`fairness_gate_passed`), so a candidate
// disqualified ONLY by these must still count as structurally compatible for
// `queue_class_gate_passed` -- "queue_class_gate_passed pode permanecer true quanto à
// compatibilidade estrutural" even when capacity/freshness/fairness independently fail. Quota
// collection completeness has no equivalent independence from the class itself (a class without a
// complete tenant+organization+project+agent quota collection is never a usable candidate for
// anything), so it stays structural -- matching the spec's own QUEUE_CLASS_BLOCKED example where
// every gate, including quota, is false.
const RESOURCE_STATE_REASON_EXACT = Object.freeze([
  'queue_capacity_snapshot_missing_for_class', 'queue_capacity_snapshot_not_valid_at_admission'
]);
function isResourceStateReason(reason) {
  return RESOURCE_STATE_REASON_EXACT.includes(reason) || reason.startsWith('queue_fairness_strategy_not_implemented');
}

// pr108fix4: "Gate flags devem representar avaliações independentes." Besides the strict
// `selectedClass` (genuinely usable for admission -- every dimension, structural and resource-state
// alike), also derive `structurallyCompatibleClass`: the best candidate disqualified only by
// resource-state reasons (fairness/capacity/freshness/quota), never a structural one. Used purely as
// evidence for `queue_class_gate_passed`/`partition_gate_passed` when no class was genuinely
// selected -- never for actual admission, which always requires the strict `selectedClass`.
function selectQueueClass(stage, ctx) {
  const { queueClassRefs, capacitySnapshotByClassId } = ctx;
  const evaluated = queueClassRefs.map((qc) => ({ qc, reasons: evaluateQueueClassCompatibility(qc, stage, ctx) }));
  const compatible = evaluated.filter((entry) => entry.reasons.length === 0).map((entry) => entry.qc);
  const structurallyCompatible = evaluated
    .filter((entry) => entry.reasons.every(isResourceStateReason))
    .map((entry) => entry.qc);
  const rejectionReasons = uniqueSorted(evaluated.flatMap((entry) => entry.reasons));

  const sortedCompatible = sortQueueClassCandidates(compatible, capacitySnapshotByClassId);
  const sortedStructurallyCompatible = sortQueueClassCandidates(structurallyCompatible, capacitySnapshotByClassId);

  return {
    selectedClass: sortedCompatible.length > 0 ? sortedCompatible[0] : null,
    structurallyCompatibleClass: sortedStructurallyCompatible.length > 0 ? sortedStructurallyCompatible[0] : null,
    rejectionReasons
  };
}

// pr108fix2 FIX 2: "Nunca reordenar e depois afirmar que o Dispatch Order foi preservado." Given a
// list of `{ intent, selectedClass }` entries already in canonical Dispatch order (never re-sorted),
// verifies the priority ranks induced by that order are non-decreasing -- i.e. that honoring
// canonical order never silently places a lower-priority intent ahead of a higher-priority one.
function checkPriorityOrderPreserved(orderedEntries) {
  const ranks = orderedEntries.map((entry) => (
    entry.selectedClass ? PRIORITY_RANK[entry.selectedClass.queue_priority_class] : PRIORITY_RANK.BACKGROUND_REFERENCE
  ));
  return ranks.every((rank, index) => index === 0 || rank >= ranks[index - 1]);
}

// "Para FIFO_WITHIN_PRIORITY_REFERENCE, provar que a posição relativa das intents da mesma priority
// class segue dispatch_sequence." Within each priority-rank group (scattered or contiguous across
// the canonical order), dispatch_sequence must strictly increase in the order encountered.
function checkFairnessOrderPreserved(orderedEntries) {
  const lastSequenceSeenByRank = new Map();
  for (const entry of orderedEntries) {
    const rank = entry.selectedClass ? PRIORITY_RANK[entry.selectedClass.queue_priority_class] : PRIORITY_RANK.BACKGROUND_REFERENCE;
    const sequence = entry.intent.dispatch_sequence;
    const lastSequence = lastSequenceSeenByRank.get(rank);
    if (lastSequence !== undefined && sequence <= lastSequence) return false;
    lastSequenceSeenByRank.set(rank, sequence);
  }
  return true;
}

function evaluateRuntimeQueueAdmissionRequest(request, context = {}) {
  void context; // never consulted for any decision.
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  const requestIsObject = isPlainObject(request);
  const policy = requestIsObject ? request.runtime_queue_admission_policy : undefined;
  const dispatchRequestRef = requestIsObject ? request.runtime_dispatch_request_reference : undefined;
  const dispatchDecisionRef = requestIsObject ? request.runtime_dispatch_decision_reference : undefined;
  const dispatchResultRef = requestIsObject ? request.runtime_dispatch_result_reference : undefined;
  const dispatchPackageRef = requestIsObject ? request.runtime_dispatch_package_reference : undefined;
  const dispatchStageRefs = requestIsObject && Array.isArray(request.runtime_dispatch_stage_references) ? request.runtime_dispatch_stage_references : [];
  const workerBindingRefs = requestIsObject && Array.isArray(request.runtime_dispatch_worker_binding_references) ? request.runtime_dispatch_worker_binding_references : [];
  const dependencyGateRefs = requestIsObject && Array.isArray(request.runtime_dispatch_dependency_gate_references) ? request.runtime_dispatch_dependency_gate_references : [];
  const approvalGateRefs = requestIsObject && Array.isArray(request.runtime_dispatch_approval_gate_references) ? request.runtime_dispatch_approval_gate_references : [];
  const capacityRefs = requestIsObject && Array.isArray(request.runtime_dispatch_capacity_references) ? request.runtime_dispatch_capacity_references : [];
  const budgetRefs = requestIsObject && Array.isArray(request.runtime_dispatch_budget_references) ? request.runtime_dispatch_budget_references : [];
  const payloadRefs = requestIsObject && Array.isArray(request.runtime_dispatch_payload_references) ? request.runtime_dispatch_payload_references : [];
  const intentRefs = requestIsObject && Array.isArray(request.runtime_dispatch_intent_references) ? request.runtime_dispatch_intent_references : [];
  const dispatchOrderRef = requestIsObject ? request.runtime_dispatch_order_reference : undefined;
  const dispatchReplayRef = requestIsObject ? request.runtime_dispatch_replay_reference : undefined;
  const queueClassRefsRaw = requestIsObject && Array.isArray(request.runtime_queue_class_references) ? request.runtime_queue_class_references : [];
  const queueCapacityRefsRaw = requestIsObject && Array.isArray(request.runtime_queue_capacity_snapshot_references) ? request.runtime_queue_capacity_snapshot_references : [];
  const queueQuotaRefsRaw = requestIsObject && Array.isArray(request.runtime_queue_quota_references) ? request.runtime_queue_quota_references : [];
  const queuePartitionRefsRaw = requestIsObject && Array.isArray(request.runtime_queue_partition_references) ? request.runtime_queue_partition_references : [];
  const capacitySnapshotRef = requestIsObject ? request.runtime_capacity_snapshot_reference : undefined;
  const concurrencyRef = requestIsObject ? request.runtime_concurrency_reference : undefined;
  const budgetRef = requestIsObject ? request.runtime_budget_reference : undefined;
  const freshnessRef = requestIsObject ? request.runtime_freshness_reference : undefined;
  const idempotencyReference = requestIsObject ? request.idempotency_reference : undefined;
  const registrySnapshotRef = requestIsObject ? request.registry_snapshot_reference : undefined;
  const networkPermissionPolicyRefs = requestIsObject && Array.isArray(request.network_permission_policy_references) ? request.network_permission_policy_references : [];
  const secretResolutionPolicyRefs = requestIsObject && Array.isArray(request.secret_resolution_policy_references) ? request.secret_resolution_policy_references : [];
  const stagePolicyRequirementRefs = requestIsObject && Array.isArray(request.runtime_worker_stage_policy_requirement_references) ? request.runtime_worker_stage_policy_requirement_references : [];
  const schedulerDependencyRefs = requestIsObject && Array.isArray(request.runtime_scheduler_dependency_references) ? request.runtime_scheduler_dependency_references : [];
  const officialModelSelectionDecisionRefs = requestIsObject && Array.isArray(request.official_model_selection_decision_references) ? request.official_model_selection_decision_references : [];
  const queueAdmissionReplayRef = requestIsObject ? request.runtime_queue_admission_replay_reference : undefined;

  const canonical = {
    tenantId: isPlainObject(dispatchPackageRef) ? dispatchPackageRef.tenant_id : undefined,
    organizationId: isPlainObject(dispatchPackageRef) ? dispatchPackageRef.organization_id : undefined,
    projectId: isPlainObject(dispatchPackageRef) ? dispatchPackageRef.project_id : undefined,
    sessionId: isPlainObject(dispatchPackageRef) ? dispatchPackageRef.session_reference_id : undefined,
    agentId: isPlainObject(dispatchPackageRef) ? dispatchPackageRef.agent_id : undefined,
    actorId: isPlainObject(dispatchPackageRef) ? dispatchPackageRef.actor_id : undefined
  };

  const requestFingerprint = computeCanonicalContentDigest(requestIsObject ? omitQueueAdmissionReplayReference(request) : {});

  function finalize(status, reasonCodes, derived = {}) {
    return buildQueueAdmissionOutcome(status, reasonCodes, {
      request, requestFingerprint, canonical,
      dispatchDecisionRef, dispatchResultRef, dispatchPackageRef,
      ...derived
    }, validatedFlags);
  }

  // 1-2. Request contract shape, including simulation_context and every nested reference against
  // its own real validator.
  const requestValidation = validateRuntimeQueueAdmissionRequest(request);
  if (!requestValidation.valid) return finalize('QUEUE_ADMISSION_VALIDATION_FAILED', ['runtime_queue_admission_request_invalid']);
  markValid('request_validated');

  // 3. Queue Admission Policy marked (limits applied later).
  markValid('policy_validated');

  // Identity, evaluated early to match the same precedence discipline established at every prior
  // layer of this lineage.
  const mismatch = checkIdentity(dispatchPackageRef, canonical, 'runtime_dispatch_package_reference');
  if (mismatch) return finalize(mismatch.status, [mismatch.reason]);
  markValid('identity_validated');

  // 4-7. Dispatch chain -- must be a genuine, matching, already-prepared chain, plus the
  // non-substitution proof for every raw Dispatch reference list this request carries.
  if (
    dispatchDecisionRef.status !== 'DISPATCH_PACKAGE_PREPARED_SIMULATION' || dispatchDecisionRef.dispatch_package_prepared_in_simulation !== true
    || dispatchResultRef.status !== 'DISPATCH_PACKAGE_PREPARED_SIMULATION' || dispatchResultRef.dispatch_package_prepared_in_simulation !== true
    || dispatchPackageRef.dispatch_status !== 'DISPATCH_PACKAGE_PREPARED_SIMULATION' || dispatchPackageRef.dispatch_package_prepared_in_simulation !== true
    || dispatchDecisionRef.runtime_dispatch_request_id !== dispatchRequestRef.runtime_dispatch_request_id
    || dispatchResultRef.runtime_dispatch_decision_id !== dispatchDecisionRef.runtime_dispatch_decision_id
    || dispatchPackageRef.runtime_dispatch_request_id !== dispatchDecisionRef.runtime_dispatch_request_id
    || dispatchDecisionRef.dispatch_authorized === true || dispatchResultRef.dispatch_authorized === true
    || dispatchResultRef.worker_reserved === true || dispatchResultRef.stage_dispatched === true
  ) {
    return finalize('QUEUE_ADMISSION_DISPATCH_BLOCKED', ['dispatch_chain_not_genuinely_prepared']);
  }
  if (
    !idSetMatches(dispatchStageRefs, 'runtime_dispatch_stage_reference_id', dispatchPackageRef.dispatch_stage_reference_ids)
    || !idSetMatches(workerBindingRefs, 'dispatch_worker_binding_reference_id', dispatchPackageRef.dispatch_worker_binding_reference_ids)
    || !idSetMatches(dependencyGateRefs, 'dispatch_dependency_gate_reference_id', dispatchPackageRef.dispatch_dependency_gate_reference_ids)
    || !idSetMatches(approvalGateRefs, 'dispatch_approval_gate_reference_id', dispatchPackageRef.dispatch_approval_gate_reference_ids)
    || !idSetMatches(capacityRefs, 'dispatch_capacity_reference_id', dispatchPackageRef.dispatch_capacity_reference_ids)
    || !idSetMatches(budgetRefs, 'dispatch_budget_reference_id', dispatchPackageRef.dispatch_budget_reference_ids)
    || !idSetMatches(payloadRefs, 'dispatch_payload_reference_id', dispatchPackageRef.dispatch_payload_reference_ids)
    || !idSetMatches(intentRefs, 'dispatch_intent_reference_id', dispatchPackageRef.dispatch_intent_reference_ids)
    || dispatchOrderRef.dispatch_order_reference_id !== dispatchPackageRef.dispatch_order_reference_id
    || dispatchReplayRef.runtime_dispatch_replay_reference_id !== dispatchPackageRef.runtime_dispatch_replay_reference_id
    || !fingerprintSetMatches(schedulerDependencyRefs, (d) => d.dependency_fingerprint, dispatchPackageRef.scheduler_dependency_fingerprints)
    || !fingerprintSetMatches(stagePolicyRequirementRefs, (h) => h.requirement_reference_fingerprint, dispatchPackageRef.stage_policy_requirement_fingerprints)
    || !fingerprintSetMatches(networkPermissionPolicyRefs, computeOfficialPolicyFingerprint, dispatchPackageRef.official_network_policy_fingerprints)
    || !fingerprintSetMatches(secretResolutionPolicyRefs, computeOfficialPolicyFingerprint, dispatchPackageRef.official_secret_policy_fingerprints)
  ) {
    return finalize('QUEUE_ADMISSION_DISPATCH_BLOCKED', ['dispatch_output_substituted_or_incomplete']);
  }
  markValid('dispatch_validated');

  // 18-19. Reaffirmation of official Network/Secret policies never PRODUCTION; Stage Policy
  // Requirements already proven non-substituted above.
  if (networkPermissionPolicyRefs.some((official) => official.environment === 'PRODUCTION')) {
    return finalize('QUEUE_ADMISSION_NETWORK_POLICY_BLOCKED', ['network_official_policy_production_not_allowed']);
  }
  if (secretResolutionPolicyRefs.some((official) => official.environment === 'PRODUCTION')) {
    return finalize('QUEUE_ADMISSION_SECRET_POLICY_BLOCKED', ['secret_official_policy_production_not_allowed']);
  }
  markValid('network_policies_validated');
  markValid('secret_policies_validated');
  markValid('stage_policy_requirements_validated');

  // 19. Freshness recomputed at this request's own logical_sequence -- same math already
  // established at every prior layer in this lineage.
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < freshnessRef.current_logical_sequence) {
    return finalize('QUEUE_ADMISSION_FRESHNESS_BLOCKED', ['queue_admission_logical_sequence_regressive']);
  }
  const freshnessExpired = FRESHNESS_DIMENSIONS.some(([, createdField, maximumField]) => (
    (request.logical_sequence - freshnessRef[createdField]) > freshnessRef[maximumField]
  ));
  if (freshnessExpired || freshnessRef.freshness_validated !== true) {
    return finalize('QUEUE_ADMISSION_FRESHNESS_BLOCKED', ['runtime_freshness_expired_at_queue_admission_logical_sequence']);
  }
  markValid('freshness_validated');

  // 20. Queue Admission Replay -- this layer's own Replay Reference, never Dispatch Replay reused
  // "como se fosse" Queue Admission Replay. Proven bound to the exact Dispatch Package/Dispatch
  // Replay fingerprints this evaluation is about to use.
  if (
    !isPlainObject(queueAdmissionReplayRef)
    || queueAdmissionReplayRef.runtime_dispatch_package_id !== dispatchPackageRef.runtime_dispatch_package_id
    || queueAdmissionReplayRef.runtime_dispatch_package_fingerprint !== dispatchPackageRef.dispatch_package_fingerprint
    || queueAdmissionReplayRef.runtime_dispatch_package_digest !== dispatchPackageRef.dispatch_package_digest
    || queueAdmissionReplayRef.runtime_dispatch_replay_reference_id !== dispatchReplayRef.runtime_dispatch_replay_reference_id
    || queueAdmissionReplayRef.runtime_dispatch_replay_fingerprint !== dispatchReplayRef.replay_fingerprint
    || queueAdmissionReplayRef.idempotency_reference_id !== idempotencyReference.idempotency_reference_id
    || queueAdmissionReplayRef.idempotency_fingerprint !== idempotencyReference.idempotency_fingerprint
    || queueAdmissionReplayRef.replay_allowed !== true || queueAdmissionReplayRef.replay_consumed !== false
  ) {
    return finalize('QUEUE_ADMISSION_REPLAY_BLOCKED', ['runtime_queue_admission_replay_reference_not_bound_to_request']);
  }
  markValid('replay_validated');

  // 21. Idempotency -- reused verbatim from the Dispatch Request's own reference.
  if (
    idempotencyReference.idempotency_reference_id !== dispatchRequestRef.idempotency_reference.idempotency_reference_id
    || idempotencyReference.idempotency_fingerprint !== dispatchRequestRef.idempotency_reference.idempotency_fingerprint
    || computeIdempotencyFingerprint(idempotencyReference) !== idempotencyReference.idempotency_fingerprint
    || idempotencyReference.idempotency_validated !== true || idempotencyReference.idempotency_consumed !== false
    || idempotencyReference.duplicate_execution_blocked !== true
  ) {
    return finalize('QUEUE_ADMISSION_IDEMPOTENCY_BLOCKED', ['idempotency_reference_not_bound_to_dispatch_chain']);
  }
  markValid('idempotency_validated');

  // 22. Registry Snapshot -- pr108fix3 FIX 2: "Para qualquer resultado preparado, exigir Registry
  // Snapshot oficial presente." Unlike the Dispatch layer one below (which still treats it as
  // "quando existentes"), this terminal simulation gate makes a genuine, fully cross-validated
  // Registry Snapshot mandatory -- matching `require_registry_snapshot_valid=true`, permanently
  // forced on the Queue Admission Policy itself. "Não marcar registry_snapshot_validated=true em
  // ausência."
  const dispatchHadSnapshot = isNonEmptyString(dispatchPackageRef.registry_snapshot_fingerprint) && dispatchPackageRef.registry_snapshot_fingerprint !== 'fingerprint_not_available';
  if (!dispatchHadSnapshot || !isPlainObject(registrySnapshotRef)) {
    return finalize('QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED', ['queue_admission_registry_snapshot_missing']);
  }
  if (computeSnapshotFingerprint(registrySnapshotRef) !== registrySnapshotRef.snapshot_fingerprint) {
    return finalize('QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED', ['queue_admission_registry_snapshot_fingerprint_mismatch']);
  }
  if (registrySnapshotRef.snapshot_fingerprint !== dispatchPackageRef.registry_snapshot_fingerprint) {
    return finalize('QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED', ['queue_admission_registry_snapshot_not_bound_to_dispatch']);
  }
  if (
    registrySnapshotRef.tenant_id !== canonical.tenantId
    || registrySnapshotRef.organization_id !== canonical.organizationId
    || registrySnapshotRef.project_id !== canonical.projectId
  ) {
    return finalize('QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED', ['queue_admission_registry_snapshot_scope_mismatch']);
  }
  if (request.logical_sequence < registrySnapshotRef.logical_sequence) {
    return finalize('QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED', ['queue_admission_registry_snapshot_stale']);
  }
  if (registrySnapshotRef.snapshot_validated !== true || registrySnapshotRef.snapshot_consistent !== true) {
    return finalize('QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED', ['queue_admission_registry_snapshot_not_validated']);
  }
  markValid('registry_snapshot_validated');

  // 26-28. Queue Class / Capacity Snapshot / Quota References -- already structurally validated at
  // step 1-2; cross-validate 1:1 bindings here.
  const capacitySnapshotByClassId = new Map();
  for (const cap of queueCapacityRefsRaw) {
    if (capacitySnapshotByClassId.has(cap.runtime_queue_class_reference_id)) {
      return finalize('QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED', ['queue_capacity_snapshot_duplicate_for_class']);
    }
    capacitySnapshotByClassId.set(cap.runtime_queue_class_reference_id, cap);
  }

  // pr108fix FIX 4: "Queue Capacity Snapshot é reavaliada na sequência lógica do Queue Admission
  // Request." Never trusts `capacity_validated`/`snapshot_expired_logically` in isolation --
  // genuinely recomputed here from `request.logical_sequence` against this snapshot's own
  // `logical_sequence`/`snapshot_valid_sequences`.
  const validCapacityClassIds = new Set();
  for (const cap of queueCapacityRefsRaw) {
    const sequenceRegressive = request.logical_sequence < cap.logical_sequence;
    const snapshotExpiredAtAdmission = (request.logical_sequence - cap.logical_sequence) > cap.snapshot_valid_sequences;
    if (!sequenceRegressive && !snapshotExpiredAtAdmission && cap.capacity_available === true) {
      validCapacityClassIds.add(cap.runtime_queue_class_reference_id);
    }
  }

  // pr108fix FIX 2: "Uma classe com apenas quota de tenant pode passar" -- no longer. A Queue Class
  // only ever becomes a valid candidate once it carries a complete, non-duplicate, genuinely
  // identity-bound tenant+organization+project+agent quota collection.
  const quotaGroupsByClassId = new Map();
  for (const quota of queueQuotaRefsRaw) {
    const list = quotaGroupsByClassId.get(quota.runtime_queue_class_reference_id) || [];
    list.push(quota);
    quotaGroupsByClassId.set(quota.runtime_queue_class_reference_id, list);
  }
  const CANONICAL_BY_SCOPE = Object.freeze({
    TENANT: canonical.tenantId, ORGANIZATION: canonical.organizationId, PROJECT: canonical.projectId, AGENT: canonical.agentId
  });
  const QUOTA_ID_FIELD_BY_SCOPE = Object.freeze({
    TENANT: 'tenant_id', ORGANIZATION: 'organization_id', PROJECT: 'project_id', AGENT: 'agent_id'
  });
  const quotaCollectionByClassId = new Map();
  for (const [classId, quotas] of quotaGroupsByClassId) {
    const collection = { TENANT: null, ORGANIZATION: null, PROJECT: null, AGENT: null };
    let genuinelyComplete = true;
    for (const quota of quotas) {
      const scopeType = classifyQuotaScope(quota);
      const identityMatches = scopeType !== null && quota[QUOTA_ID_FIELD_BY_SCOPE[scopeType]] === CANONICAL_BY_SCOPE[scopeType];
      if (!identityMatches || collection[scopeType] !== null) {
        genuinelyComplete = false;
        continue;
      }
      collection[scopeType] = quota;
    }
    if (genuinelyComplete && QUOTA_SCOPE_TYPES.every((scopeType) => collection[scopeType] !== null)) {
      quotaCollectionByClassId.set(classId, collection);
    }
  }

  // pr108fix: officially reused Model Selection Decisions this evaluation's own MODEL Stage Policy
  // Requirements are genuinely bound to (never a second self-declared source).
  const modelSelectionDecisionsById = new Map(officialModelSelectionDecisionRefs.map((d) => [d.decision_id, d]));
  const stagePolicyRequirementsByStageId = new Map();
  for (const req of stagePolicyRequirementRefs) {
    const list = stagePolicyRequirementsByStageId.get(req.scheduler_stage_reference_id) || [];
    list.push(req);
    stagePolicyRequirementsByStageId.set(req.scheduler_stage_reference_id, list);
  }

  markValid('queue_classes_validated');
  markValid('queue_capacity_snapshots_validated');
  markValid('queue_quotas_validated');
  markValid('queue_partitions_validated');

  // 29-35. Derive, per genuinely DISPATCH_INTENT_PREPARED_SIMULATION intent (never
  // waiting/optional/blocked), Queue Class -> Partition -> Fairness -> Intent Binding -> Admission
  // Entry, in the SAME order the Dispatch Package's own ordered_dispatch_intent_reference_ids
  // already carries -- "A Queue Admission Order deve ser derivada da ordered_dispatch_intent_
  // reference_ids do Dispatch Package. Não confiar na ordem do array recebido."
  const stageById = new Map(dispatchStageRefs.map((s) => [s.runtime_dispatch_stage_reference_id, s]));
  const intentById = new Map(intentRefs.map((i) => [i.dispatch_intent_reference_id, i]));
  const workerBindingById = new Map(workerBindingRefs.map((w) => [w.dispatch_worker_binding_reference_id, w]));
  const dispatchDependencyRefsByStageId = new Map(schedulerDependencyRefs.map((d) => [d.to_scheduler_stage_reference_id, d]));
  void dispatchDependencyRefsByStageId;

  const canonicalIntentOrder = Array.isArray(dispatchPackageRef.ordered_dispatch_intent_reference_ids) ? dispatchPackageRef.ordered_dispatch_intent_reference_ids : [];
  if (new Set(canonicalIntentOrder).size !== canonicalIntentOrder.length || canonicalIntentOrder.length !== intentRefs.length) {
    return finalize('QUEUE_ADMISSION_ORDER_BLOCKED', ['dispatch_intent_order_not_in_dispatch_package']);
  }

  const preparedIntentsInOrder = [];
  for (const intentId of canonicalIntentOrder) {
    const intent = intentById.get(intentId);
    if (!intent) return finalize('QUEUE_ADMISSION_ORDER_BLOCKED', ['dispatch_intent_not_in_request']);
    if (intent.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION') preparedIntentsInOrder.push(intent);
  }

  // Fairness ranks: computed once, over every prepared intent together, using only priority class
  // + dispatch sequence + canonical identity -- "Nenhum score aleatório." Rank order is the fairness
  // ordering itself; entries are later greedily admitted in exactly this order.
  const withQueueClass = [];
  for (const intent of preparedIntentsInOrder) {
    const stage = stageById.get(intent.runtime_dispatch_stage_reference_id);
    if (!stage) return finalize('QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED', ['dispatch_stage_missing_for_prepared_intent']);
    const { selectedClass, structurallyCompatibleClass, rejectionReasons } = selectQueueClass(stage, {
      queueClassRefs: queueClassRefsRaw, canonical, capacitySnapshotByClassId, quotaCollectionByClassId,
      validCapacityClassIds, stagePolicyRequirementsByStageId, modelSelectionDecisionsById
    });
    withQueueClass.push({ intent, stage, selectedClass, structurallyCompatibleClass, rejectionReasons });
  }

  // pr108fix2 FIX 2: "Usar canonicalIntentOrder como ordem soberana da admissão. Não reordenar
  // intents silenciosamente por Queue Class priority." `withQueueClass` is already in canonical
  // Dispatch order (built by iterating `preparedIntentsInOrder`, itself built by iterating
  // `canonicalIntentOrder`) -- the greedy admission loop below consumes it exactly as-is, never
  // re-sorted by priority or dispatch_sequence.
  const fairnessOrder = withQueueClass;

  // pr108fix3 FIX 1: "Não incluir intents sem selectedClass nas provas de priority/FIFO." An intent
  // with no compatible Queue Class has no genuine priority to compare -- BACKGROUND_REFERENCE was
  // only ever a synthetic fallback, never the class's real decisional priority. Including it in the
  // priority/FIFO proofs could produce QUEUE_ADMISSION_ORDER_BLOCKED ahead of the entry's own real
  // QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED/CAPACITY_BLOCKED/FAIRNESS_BLOCKED status, masking the true
  // blocker and violating the declared precedence order. Only entries with a genuinely selected
  // class participate; `dispatch_order_preserved` (already proven independently below, over every
  // entry) and `required_predecessor_order_preserved` (already proven independently above, from
  // canonical positions, not from `fairnessOrder`) are unaffected by this restriction.
  const orderEligibleEntries = fairnessOrder.filter((entry) => entry.selectedClass !== null);

  // "Se uma Queue Class exige uma prioridade incompatível com a ordem e isso não pode ser
  // preservado, bloquear com QUEUE_ADMISSION_ORDER_BLOCKED. Nunca reordenar e depois afirmar que o
  // Dispatch Order foi preservado." Genuinely verified, never asserted.
  const priorityOrderPreserved = checkPriorityOrderPreserved(orderEligibleEntries);
  if (!priorityOrderPreserved) {
    return finalize('QUEUE_ADMISSION_ORDER_BLOCKED', ['queue_admission_priority_order_not_preserved']);
  }

  // "Para FIFO_WITHIN_PRIORITY_REFERENCE, provar que a posição relativa das intents da mesma
  // priority class segue dispatch_sequence." Genuinely verified, never asserted.
  const fairnessOrderPreserved = checkFairnessOrderPreserved(orderEligibleEntries);
  if (!fairnessOrderPreserved) {
    return finalize('QUEUE_ADMISSION_ORDER_BLOCKED', ['queue_admission_fifo_order_not_preserved']);
  }

  // "Recalcular required_predecessor_order_preserved. Reutilizar as Scheduler Dependency References
  // oficiais já carregadas e cross-validadas." For every required dependency, the predecessor's own
  // admission entry must occupy an earlier position than the target's in the SAME canonical order the
  // Queue Admission Order will register -- genuinely re-derived here, never assumed inherited from the
  // Dispatch layer's own equivalent proof one layer below.
  const dispatchStageIdBySchedulerStageId = new Map(dispatchStageRefs.map((s) => [s.scheduler_stage_reference_id, s.runtime_dispatch_stage_reference_id]));
  const intentIdByDispatchStageId = new Map(intentRefs.map((i) => [i.runtime_dispatch_stage_reference_id, i.dispatch_intent_reference_id]));
  const positionByIntentId = new Map(canonicalIntentOrder.map((id, index) => [id, index]));
  for (const dependency of schedulerDependencyRefs) {
    if (dependency.required !== true) continue;
    const fromDispatchStageId = dispatchStageIdBySchedulerStageId.get(dependency.from_scheduler_stage_reference_id);
    const toDispatchStageId = dispatchStageIdBySchedulerStageId.get(dependency.to_scheduler_stage_reference_id);
    const fromIntentId = fromDispatchStageId && intentIdByDispatchStageId.get(fromDispatchStageId);
    const toIntentId = toDispatchStageId && intentIdByDispatchStageId.get(toDispatchStageId);
    if (!fromIntentId || !toIntentId) continue; // neither participates in this Queue Admission Order.
    const fromPosition = positionByIntentId.get(fromIntentId);
    const toPosition = positionByIntentId.get(toIntentId);
    if (fromPosition === undefined || toPosition === undefined || !(fromPosition < toPosition)) {
      return finalize('QUEUE_ADMISSION_ORDER_BLOCKED', [`queue_admission_required_predecessor_order_violation::${dependency.scheduler_dependency_reference_id}`]);
    }
  }

  function rankWithinGroup(list, keyFn) {
    const ranks = new Map();
    const groups = new Map();
    for (const item of list) {
      const key = keyFn(item);
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      group.forEach((item, index) => ranks.set(item, index));
    }
    return ranks;
  }
  const globalRanks = new Map(fairnessOrder.map((item, index) => [item, index]));
  const tenantRanks = rankWithinGroup(fairnessOrder, () => canonical.tenantId);
  const organizationRanks = rankWithinGroup(fairnessOrder, () => canonical.organizationId);
  const projectRanks = rankWithinGroup(fairnessOrder, () => canonical.projectId);
  const agentRanks = rankWithinGroup(fairnessOrder, () => canonical.agentId);

  const requestId = request.runtime_queue_admission_request_id;
  const packageId = `${requestId}-package`;

  // Greedy sequential admission -- working copies of every queue class's capacity, decremented as
  // entries are genuinely accepted (never persisted, never applied to the real snapshot object).
  const workingCapacity = new Map();
  for (const [classId, cap] of capacitySnapshotByClassId) {
    workingCapacity.set(classId, {
      backlog: cap.available_backlog_count, inflight: cap.available_inflight_count, parallel: cap.available_parallel_count,
      model: cap.available_model_count, tool: cap.available_tool_count, workflow: cap.available_workflow_count,
      tokens: cap.available_tokens, cost: cap.available_cost_minor_units
    });
  }
  const workingQuota = new Map();
  for (const quota of queueQuotaRefsRaw) {
    workingQuota.set(quota.runtime_queue_quota_reference_id, {
      admission: quota.available_admission_count, backlog: quota.available_backlog_count, parallel: quota.available_parallel_count,
      model: quota.available_model_count, tool: quota.available_tool_count, workflow: quota.available_workflow_count,
      tokens: quota.available_tokens, cost: quota.available_cost_minor_units
    });
  }

  // pr108fix FIX 2: the complete, already identity-validated 4-quota collection for this class --
  // never a partial or arbitrarily-picked subset.
  function relevantQuotas(classId) {
    const collection = quotaCollectionByClassId.get(classId);
    return collection ? QUOTA_SCOPE_TYPES.map((scopeType) => collection[scopeType]) : [];
  }

  // pr108fix4: pure, read-only fit checks against the CURRENT working state -- shared between the
  // real (mutating) admission attempt against `selectedClass` and the (never-mutating) gate-evidence
  // peek against `structurallyCompatibleClass`, so both use the exact same arithmetic.
  function peekCapacityFits(classId, requested) {
    const working = workingCapacity.get(classId);
    if (!working) return false;
    return working.backlog >= requested.backlog && working.inflight >= requested.inflight
      && (requested.parallel === 0 || working.parallel >= requested.parallel)
      && (requested.model === 0 || working.model >= requested.model)
      && (requested.tool === 0 || working.tool >= requested.tool)
      && (requested.workflow === 0 || working.workflow >= requested.workflow)
      && working.tokens >= requested.tokens && working.cost >= requested.cost;
  }
  function peekQuotaFits(classId, requested) {
    const relevant = relevantQuotas(classId);
    if (relevant.length === 0) return quotaCollectionByClassId.has(classId);
    return relevant.every((q) => {
      const w = workingQuota.get(q.runtime_queue_quota_reference_id);
      if (!w) return false;
      return w.admission >= 1 && w.backlog >= requested.backlog
        && (requested.parallel === 0 || w.parallel >= requested.parallel)
        && (requested.model === 0 || w.model >= requested.model)
        && (requested.tool === 0 || w.tool >= requested.tool)
        && (requested.workflow === 0 || w.workflow >= requested.workflow)
        && w.tokens >= requested.tokens && w.cost >= requested.cost;
    });
  }

  const partitionRefs = [];
  const fairnessRefs = [];
  const intentBindingRefs = [];
  const admissionEntryRefs = [];
  let admissionSequence = 0;

  for (const entry of fairnessOrder) {
    const { intent, stage, selectedClass, structurallyCompatibleClass, rejectionReasons } = entry;
    const dispatchStageId = intent.runtime_dispatch_stage_reference_id;
    const priorityClass = selectedClass ? selectedClass.queue_priority_class : 'BACKGROUND_REFERENCE';

    const fairnessId = `${dispatchStageId}-queue-fairness`;
    const fairnessRef = buildRuntimeQueueFairnessReference({
      runtime_queue_fairness_reference_id: fairnessId,
      runtime_queue_admission_request_id: requestId,
      runtime_queue_class_reference_id: selectedClass ? selectedClass.runtime_queue_class_reference_id : 'runtime_queue_class_not_available',
      fairness_strategy: selectedClass ? selectedClass.queue_fairness_strategy : 'FIFO_WITHIN_PRIORITY_REFERENCE',
      tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId, agent_id: canonical.agentId,
      priority_class: priorityClass,
      dispatch_sequence: intent.dispatch_sequence,
      logical_sequence: request.logical_sequence,
      tenant_admission_rank: tenantRanks.get(entry),
      organization_admission_rank: organizationRanks.get(entry),
      project_admission_rank: projectRanks.get(entry),
      agent_admission_rank: agentRanks.get(entry),
      global_admission_rank: globalRanks.get(entry)
    });
    fairnessRefs.push(fairnessRef);

    // pr108fix4: "Gate flags devem representar avaliações independentes." Computed once per intent,
    // against `structurallyCompatibleClass` (every dimension except possibly fairness strategy) --
    // never derived from the final `admissionStatus`, so a DEFERRED/BLOCKED entry still shows
    // genuine evidence of what actually passed.
    const requested = {
      backlog: 1, inflight: 1,
      parallel: stage.parallelizable === true ? 1 : 0,
      model: stage.model_selection_reference_id !== null ? 1 : 0,
      tool: Array.isArray(stage.tool_reference_ids) && stage.tool_reference_ids.length > 0 ? 1 : 0,
      workflow: stage.workflow_reference_id !== null ? 1 : 0,
      tokens: stage.estimated_total_tokens, cost: stage.estimated_cost_minor_units
    };
    // When a class was genuinely selected (fairness-compliant and every other dimension), gate
    // evidence is computed against THAT SAME class -- never a differently-ranked
    // `structurallyCompatibleClass` that could disagree with what admission actually used. Only when
    // no class was genuinely selected does the fairness-agnostic candidate stand in, purely as
    // evidence for the entry that never got a real one.
    const gateClass = selectedClass || structurallyCompatibleClass;
    const queueClassGatePassed = gateClass !== null;
    const gatePartitionKeyValue = queueClassGatePassed
      ? derivePartitionKeyValue(gateClass.queue_partition_strategy, { canonical, stage })
      : null;
    const partitionGatePassed = queueClassGatePassed && isNonEmptyString(gatePartitionKeyValue);
    const gateClassId = queueClassGatePassed ? gateClass.runtime_queue_class_reference_id : null;
    const freshnessGatePassed = queueClassGatePassed && validCapacityClassIds.has(gateClassId);
    // An expired Capacity Snapshot can never be trusted for a capacity determination, however
    // generous its raw numbers still look -- capacity_gate_passed requires freshness_gate_passed too.
    const capacityGatePassed = partitionGatePassed && freshnessGatePassed && peekCapacityFits(gateClassId, requested);
    const quotaGatePassed = partitionGatePassed && peekQuotaFits(gateClassId, requested);
    // "Não marcar fairness true quando nenhuma Queue Class foi selecionada." `gateClass` may carry
    // ANY fairness strategy when it falls back to `structurallyCompatibleClass` (the one dimension
    // that candidate's own selection deliberately ignored) -- this is the one genuine place that
    // strategy is actually consulted for gate evidence.
    const fairnessGatePassed = queueClassGatePassed && FAIRNESS_STRATEGIES_IMPLEMENTED.includes(gateClass.queue_fairness_strategy);
    // Replay/Idempotency are global gates already validated (and returned early on failure) before
    // any per-intent derivation begins -- genuinely true here, never fabricated.
    const replayGatePassed = validatedFlags.replay_validated === true;
    const idempotencyGatePassed = validatedFlags.idempotency_validated === true;

    let partitionRef = null;
    let admissionStatus;
    const reasonCodes = [];

    if (!selectedClass) {
      // pr108fix FIX 3/FIX 4: when every candidate was rejected for EXCLUSIVELY one reason category,
      // surface the specific status the fix requires instead of the generic "no compatible class"
      // bucket -- never masking an unimplemented fairness strategy or a stale capacity snapshot as
      // an ordinary incompatibility.
      const onlyFairnessReasons = rejectionReasons.length > 0 && rejectionReasons.every((r) => r.startsWith('queue_fairness_strategy_not_implemented'));
      const onlyCapacityReasons = rejectionReasons.length > 0 && rejectionReasons.every((r) => r === 'queue_capacity_snapshot_not_valid_at_admission' || r === 'queue_capacity_snapshot_missing_for_class');
      admissionStatus = onlyFairnessReasons ? 'QUEUE_ADMISSION_FAIRNESS_BLOCKED'
        : onlyCapacityReasons ? 'QUEUE_ADMISSION_CAPACITY_BLOCKED'
        : 'QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED';
      reasonCodes.push('no_compatible_queue_class_reference', ...rejectionReasons);
    } else {
      const keyValue = derivePartitionKeyValue(selectedClass.queue_partition_strategy, { canonical, stage });
      if (!isNonEmptyString(keyValue)) {
        admissionStatus = 'QUEUE_ADMISSION_PARTITION_BLOCKED';
        reasonCodes.push('partition_key_derivation_failed');
      } else {
        const partitionId = `${dispatchStageId}-queue-partition`;
        partitionRef = buildRuntimeQueuePartitionReference({
          runtime_queue_partition_reference_id: partitionId,
          runtime_queue_class_reference_id: selectedClass.runtime_queue_class_reference_id,
          partition_strategy: selectedClass.queue_partition_strategy,
          partition_key_value: keyValue,
          tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId,
          agent_id: canonical.agentId, stage_type: stage.stage_type, capability_ids: stage.required_capabilities
        });
        partitionRefs.push(partitionRef);

        const classId = selectedClass.runtime_queue_class_reference_id;
        const capacityFits = peekCapacityFits(classId, requested);
        const quotaFits = peekQuotaFits(classId, requested);
        const relevant = relevantQuotas(classId);

        if (!quotaFits) {
          admissionStatus = 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE';
          reasonCodes.push('queue_quota_insufficient_for_intent');
        } else if (!capacityFits) {
          admissionStatus = 'QUEUE_ADMISSION_DEFERRED_BACKLOG_REFERENCE';
          reasonCodes.push('queue_capacity_insufficient_for_intent');
        } else {
          admissionStatus = 'QUEUE_ADMISSION_ACCEPTED_SIMULATION';
          const working = workingCapacity.get(classId);
          working.backlog -= requested.backlog;
          working.inflight -= requested.inflight;
          working.parallel -= requested.parallel;
          working.model -= requested.model;
          working.tool -= requested.tool;
          working.workflow -= requested.workflow;
          working.tokens -= requested.tokens;
          working.cost -= requested.cost;
          for (const q of relevant) {
            const w = workingQuota.get(q.runtime_queue_quota_reference_id);
            w.admission -= 1;
            w.backlog -= requested.backlog;
            w.parallel -= requested.parallel;
            w.model -= requested.model;
            w.tool -= requested.tool;
            w.workflow -= requested.workflow;
            w.tokens -= requested.tokens;
            w.cost -= requested.cost;
          }
        }
      }
    }

    const workerBindingRef = workerBindingById.get(intent.dispatch_worker_binding_reference_id);
    const bindingId = `${dispatchStageId}-queue-intent-binding`;
    const intentBindingRef = buildRuntimeQueueIntentBindingReference({
      queue_intent_binding_reference_id: bindingId,
      runtime_queue_admission_request_id: requestId,
      runtime_queue_admission_package_id: packageId,
      runtime_dispatch_package_id: dispatchPackageRef.runtime_dispatch_package_id,
      dispatch_intent_reference_id: intent.dispatch_intent_reference_id,
      runtime_dispatch_stage_reference_id: dispatchStageId,
      dispatch_worker_binding_reference_id: intent.dispatch_worker_binding_reference_id,
      scheduler_stage_reference_id: stage.scheduler_stage_reference_id,
      runtime_stage_reference_id: stage.runtime_stage_reference_id,
      runtime_worker_reference_id: intent.runtime_worker_reference_id,
      runtime_queue_class_reference_id: selectedClass ? selectedClass.runtime_queue_class_reference_id : 'runtime_queue_class_not_available',
      runtime_queue_partition_reference_id: partitionRef ? partitionRef.runtime_queue_partition_reference_id : 'runtime_queue_partition_not_available',
      runtime_queue_quota_reference_ids: selectedClass ? relevantQuotas(selectedClass.runtime_queue_class_reference_id).map((q) => q.runtime_queue_quota_reference_id) : [],
      runtime_queue_capacity_snapshot_reference_id: selectedClass ? capacitySnapshotByClassId.get(selectedClass.runtime_queue_class_reference_id).runtime_queue_capacity_snapshot_reference_id : 'runtime_queue_capacity_snapshot_not_available',
      dispatch_intent_status: intent.dispatch_intent_status,
      queue_class_match: queueClassGatePassed,
      partition_match: partitionGatePassed,
      quota_match: quotaGatePassed,
      capacity_match: capacityGatePassed,
      fairness_match: fairnessGatePassed,
      freshness_match: freshnessGatePassed,
      reason_codes: reasonCodes
    });
    intentBindingRefs.push(intentBindingRef);

    const entryId = `${dispatchStageId}-queue-admission-entry`;
    const admissionEntryRef = buildRuntimeQueueAdmissionEntryReference({
      runtime_queue_admission_entry_reference_id: entryId,
      runtime_queue_admission_package_id: packageId,
      runtime_queue_admission_request_id: requestId,
      queue_intent_binding_reference_id: bindingId,
      runtime_queue_fairness_reference_id: fairnessId,
      dispatch_intent_reference_id: intent.dispatch_intent_reference_id,
      runtime_dispatch_stage_reference_id: dispatchStageId,
      runtime_worker_reference_id: workerBindingRef ? workerBindingRef.runtime_worker_reference_id : null,
      runtime_queue_class_reference_id: selectedClass ? selectedClass.runtime_queue_class_reference_id : null,
      runtime_queue_partition_reference_id: partitionRef ? partitionRef.runtime_queue_partition_reference_id : null,
      runtime_queue_quota_reference_ids: intentBindingRef.runtime_queue_quota_reference_ids,
      admission_sequence: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION' ? admissionSequence++ : admissionSequence,
      queue_priority_class: priorityClass,
      admission_status: admissionStatus,
      queue_class_gate_passed: queueClassGatePassed,
      partition_gate_passed: partitionGatePassed,
      quota_gate_passed: quotaGatePassed,
      capacity_gate_passed: capacityGatePassed,
      fairness_gate_passed: fairnessGatePassed,
      freshness_gate_passed: freshnessGatePassed,
      replay_gate_passed: replayGatePassed,
      idempotency_gate_passed: idempotencyGatePassed,
      reason_codes: reasonCodes
    });
    admissionEntryRefs.push(admissionEntryRef);
  }

  // Non-prepared intents (waiting-dependency/waiting-approval/optional/no-worker/capacity/budget/
  // policy/blocked) get a direct, structurally-mapped admission entry -- "Nunca admitir" any of
  // them, but every Dispatch Intent still produces exactly one Queue Admission Entry.
  for (const intentId of canonicalIntentOrder) {
    const intent = intentById.get(intentId);
    if (intent.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION') continue;
    const dispatchStageId = intent.runtime_dispatch_stage_reference_id;
    const admissionStatus = NON_PREPARED_STATUS_MAP[intent.dispatch_intent_status] || 'QUEUE_ADMISSION_BLOCKED';
    const fairnessId = `${dispatchStageId}-queue-fairness`;
    const fairnessRef = buildRuntimeQueueFairnessReference({
      runtime_queue_fairness_reference_id: fairnessId,
      runtime_queue_admission_request_id: requestId,
      runtime_queue_class_reference_id: 'runtime_queue_class_not_available',
      fairness_strategy: 'FIFO_WITHIN_PRIORITY_REFERENCE',
      tenant_id: canonical.tenantId, organization_id: canonical.organizationId, project_id: canonical.projectId, agent_id: canonical.agentId,
      priority_class: 'BACKGROUND_REFERENCE',
      dispatch_sequence: intent.dispatch_sequence,
      logical_sequence: request.logical_sequence,
      tenant_admission_rank: 0, organization_admission_rank: 0, project_admission_rank: 0, agent_admission_rank: 0, global_admission_rank: 0
    });
    fairnessRefs.push(fairnessRef);

    const bindingId = `${dispatchStageId}-queue-intent-binding`;
    const intentBindingRef = buildRuntimeQueueIntentBindingReference({
      queue_intent_binding_reference_id: bindingId,
      runtime_queue_admission_request_id: requestId,
      runtime_queue_admission_package_id: packageId,
      runtime_dispatch_package_id: dispatchPackageRef.runtime_dispatch_package_id,
      dispatch_intent_reference_id: intent.dispatch_intent_reference_id,
      runtime_dispatch_stage_reference_id: dispatchStageId,
      dispatch_worker_binding_reference_id: intent.dispatch_worker_binding_reference_id,
      scheduler_stage_reference_id: stageById.get(dispatchStageId).scheduler_stage_reference_id,
      runtime_stage_reference_id: stageById.get(dispatchStageId).runtime_stage_reference_id,
      runtime_worker_reference_id: intent.runtime_worker_reference_id,
      runtime_queue_class_reference_id: 'runtime_queue_class_not_available',
      runtime_queue_partition_reference_id: 'runtime_queue_partition_not_available',
      runtime_queue_quota_reference_ids: [],
      runtime_queue_capacity_snapshot_reference_id: 'runtime_queue_capacity_snapshot_not_available',
      dispatch_intent_status: intent.dispatch_intent_status,
      queue_class_match: false, partition_match: false, quota_match: false, capacity_match: false,
      fairness_match: false, freshness_match: false,
      reason_codes: ['dispatch_intent_not_prepared']
    });
    intentBindingRefs.push(intentBindingRef);

    const entryId = `${dispatchStageId}-queue-admission-entry`;
    const admissionEntryRef = buildRuntimeQueueAdmissionEntryReference({
      runtime_queue_admission_entry_reference_id: entryId,
      runtime_queue_admission_package_id: packageId,
      runtime_queue_admission_request_id: requestId,
      queue_intent_binding_reference_id: bindingId,
      runtime_queue_fairness_reference_id: fairnessId,
      dispatch_intent_reference_id: intent.dispatch_intent_reference_id,
      runtime_dispatch_stage_reference_id: dispatchStageId,
      runtime_worker_reference_id: null,
      runtime_queue_class_reference_id: null,
      runtime_queue_partition_reference_id: null,
      runtime_queue_quota_reference_ids: [],
      admission_sequence: admissionSequence,
      queue_priority_class: 'BACKGROUND_REFERENCE',
      admission_status: admissionStatus,
      queue_class_gate_passed: false, partition_gate_passed: false, quota_gate_passed: false, capacity_gate_passed: false,
      fairness_gate_passed: false, freshness_gate_passed: false, replay_gate_passed: false, idempotency_gate_passed: false,
      reason_codes: ['dispatch_intent_not_prepared']
    });
    admissionEntryRefs.push(admissionEntryRef);
  }

  markValid('queue_fairness_validated');
  markValid('intent_bindings_validated');
  markValid('admission_entries_validated');

  // 35. Queue Admission Order -- genuine subsequence of the Dispatch Package's own canonical intent
  // order (never independently reordered), partitioned by final admission status.
  const admissionEntryByIntentId = new Map(admissionEntryRefs.map((e) => [e.dispatch_intent_reference_id, e]));
  const orderedEntryIds = canonicalIntentOrder.map((id) => admissionEntryByIntentId.get(id).runtime_queue_admission_entry_reference_id);

  // "Provar que a ordem de todas as Admission Entries corresponde 1:1 à ordem de dispatchPackage.
  // ordered_dispatch_intent_reference_ids." Genuinely re-verified against the entries as actually
  // built, never assumed correct merely because the loop above intended to follow canonical order.
  const dispatchOrderPreserved = canonicalIntentOrder.every((intentId, index) => (
    admissionEntryByIntentId.get(intentId).runtime_queue_admission_entry_reference_id === orderedEntryIds[index]
    && admissionEntryByIntentId.get(intentId).dispatch_intent_reference_id === intentId
  ));
  if (!dispatchOrderPreserved) {
    return finalize('QUEUE_ADMISSION_ORDER_BLOCKED', ['queue_admission_dispatch_order_not_preserved']);
  }

  const acceptedIds = admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION').map((e) => e.runtime_queue_admission_entry_reference_id);
  const deferredIds = admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE' || e.admission_status === 'QUEUE_ADMISSION_DEFERRED_BACKLOG_REFERENCE' || e.admission_status === 'QUEUE_ADMISSION_DEFERRED_FAIRNESS_REFERENCE').map((e) => e.runtime_queue_admission_entry_reference_id);
  const waitingIds = admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_WAITING_DEPENDENCY_REFERENCE' || e.admission_status === 'QUEUE_ADMISSION_WAITING_APPROVAL_REFERENCE').map((e) => e.runtime_queue_admission_entry_reference_id);
  const optionalIds = admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_OPTIONAL_REFERENCE').map((e) => e.runtime_queue_admission_entry_reference_id);
  const blockedIds = admissionEntryRefs.filter((e) => ![...acceptedIds, ...deferredIds, ...waitingIds, ...optionalIds].includes(e.runtime_queue_admission_entry_reference_id)).map((e) => e.runtime_queue_admission_entry_reference_id);

  const orderId = `${packageId}-order`;
  const orderRef = buildRuntimeQueueAdmissionOrderReference({
    runtime_queue_admission_order_reference_id: orderId,
    runtime_queue_admission_package_id: packageId,
    runtime_dispatch_package_id: dispatchPackageRef.runtime_dispatch_package_id,
    ordered_dispatch_intent_reference_ids: canonicalIntentOrder,
    ordered_queue_admission_entry_reference_ids: orderedEntryIds,
    accepted_queue_admission_entry_reference_ids: acceptedIds,
    deferred_queue_admission_entry_reference_ids: deferredIds,
    waiting_queue_admission_entry_reference_ids: waitingIds,
    optional_queue_admission_entry_reference_ids: optionalIds,
    blocked_queue_admission_entry_reference_ids: blockedIds,
    // pr108fix2 FIX 2: every one of these four flags was already genuinely re-verified as an
    // independent gate above (each one blocking QUEUE_ADMISSION_ORDER_BLOCKED on failure) --
    // reaching this line is itself the proof, never a construction-time assertion.
    dispatch_order_preserved: dispatchOrderPreserved,
    priority_order_preserved: priorityOrderPreserved,
    fairness_order_preserved: fairnessOrderPreserved,
    required_predecessor_order_preserved: true
  });
  markValid('admission_order_validated');

  // 36. Policy limits -- applied to accepted entries only.
  const acceptedStages = acceptedIds.map((id) => {
    const entry = admissionEntryRefs.find((e) => e.runtime_queue_admission_entry_reference_id === id);
    return stageById.get(entry.runtime_dispatch_stage_reference_id);
  });
  const modelAdmissionCount = acceptedStages.filter((s) => s.model_selection_reference_id !== null).length;
  const toolAdmissionCount = acceptedStages.filter((s) => Array.isArray(s.tool_reference_ids) && s.tool_reference_ids.length > 0).length;
  const workflowAdmissionCount = acceptedStages.filter((s) => s.workflow_reference_id !== null).length;
  const parallelAdmissionCount = acceptedStages.filter((s) => s.parallelizable === true).length;
  const estimatedInputTokens = acceptedStages.reduce((sum, s) => sum + s.estimated_input_tokens, 0);
  const estimatedOutputTokens = acceptedStages.reduce((sum, s) => sum + s.estimated_output_tokens, 0);
  const estimatedTotalTokens = acceptedStages.reduce((sum, s) => sum + s.estimated_total_tokens, 0);
  const estimatedTotalCost = acceptedStages.reduce((sum, s) => sum + s.estimated_cost_minor_units, 0);

  if (Number.isInteger(policy.maximum_admission_entry_count) && acceptedIds.length > policy.maximum_admission_entry_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_entry_count_exceeds_policy_limit']);
  }
  if (Number.isInteger(policy.maximum_model_admission_count) && modelAdmissionCount > policy.maximum_model_admission_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_model_count_exceeds_policy_limit']);
  }
  if (Number.isInteger(policy.maximum_tool_admission_count) && toolAdmissionCount > policy.maximum_tool_admission_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_tool_count_exceeds_policy_limit']);
  }
  if (Number.isInteger(policy.maximum_workflow_admission_count) && workflowAdmissionCount > policy.maximum_workflow_admission_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_workflow_count_exceeds_policy_limit']);
  }
  if (Number.isInteger(policy.maximum_parallel_admission_count) && parallelAdmissionCount > policy.maximum_parallel_admission_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_parallel_count_exceeds_policy_limit']);
  }
  if (Number.isInteger(policy.maximum_estimated_tokens) && estimatedTotalTokens > policy.maximum_estimated_tokens) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_estimated_tokens_exceed_policy_limit']);
  }
  if (Number.isInteger(policy.maximum_estimated_cost_minor_units) && estimatedTotalCost > policy.maximum_estimated_cost_minor_units) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_estimated_cost_exceeds_policy_limit']);
  }
  // pr108fix2 FIX 1: "Mesmo sendo uma avaliação single-identity, todos os campos declarados
  // precisam participar da decisão." All four identity-scoped ceilings are genuinely compared
  // against the same accepted count -- this boundary only ever evaluates one tenant/organization/
  // project/agent's intents per request, so all four share the same acceptedCount, but each still
  // gets its own independent comparison and its own specific reason code, never a shared generic one.
  const acceptedCount = acceptedIds.length;
  if (Number.isInteger(policy.maximum_per_tenant_admission_count) && acceptedCount > policy.maximum_per_tenant_admission_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_per_tenant_count_exceeds_policy_limit']);
  }
  if (Number.isInteger(policy.maximum_per_organization_admission_count) && acceptedCount > policy.maximum_per_organization_admission_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_per_organization_count_exceeds_policy_limit']);
  }
  if (Number.isInteger(policy.maximum_per_project_admission_count) && acceptedCount > policy.maximum_per_project_admission_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_per_project_count_exceeds_policy_limit']);
  }
  if (Number.isInteger(policy.maximum_per_agent_admission_count) && acceptedCount > policy.maximum_per_agent_admission_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_per_agent_count_exceeds_policy_limit']);
  }

  // 42. Non-execution invariants.
  if (dispatchResultRef.executed === true || dispatchPackageRef.executed === true) {
    return finalize('QUEUE_ADMISSION_VALIDATION_FAILED', ['non_execution_invariant_violated']);
  }
  markValid('non_execution_invariants_validated');
  markValid('package_fingerprint_validated');
  markValid('package_digest_validated');

  return finalize('QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION', ['queue_admission_package_prepared_in_simulation_only'], {
    queueClassRefs: queueClassRefsRaw, queueCapacityRefs: queueCapacityRefsRaw, queueQuotaRefs: queueQuotaRefsRaw,
    partitionRefs, fairnessRefs, intentBindingRefs, admissionEntryRefs, orderRef, queueAdmissionReplayRef,
    dispatchStageRefs, workerBindingRefs, dependencyGateRefs, approvalGateRefs, capacityRefs, budgetRefs, payloadRefs,
    intentRefs, dispatchOrderRef, dispatchReplayRef, schedulerDependencyRefs, stagePolicyRequirementRefs,
    networkPermissionPolicyRefs, secretResolutionPolicyRefs, capacitySnapshotRef, concurrencyRef, budgetRef,
    freshnessRef, idempotencyReference, registrySnapshotRef, officialModelSelectionDecisionRefs,
    modelAdmissionCount, toolAdmissionCount, workflowAdmissionCount, parallelAdmissionCount,
    estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens, estimatedTotalCost
  });
}

function buildQueueAdmissionOutcome(status, reasonCodes, ctx, validatedFlags) {
  const {
    request, requestFingerprint, canonical, dispatchDecisionRef, dispatchResultRef, dispatchPackageRef,
    queueClassRefs = [], queueCapacityRefs = [], queueQuotaRefs = [], partitionRefs = [], fairnessRefs = [],
    officialModelSelectionDecisionRefs = [],
    intentBindingRefs = [], admissionEntryRefs = [], orderRef, queueAdmissionReplayRef,
    dispatchStageRefs = [], workerBindingRefs = [], dependencyGateRefs = [], approvalGateRefs = [], capacityRefs = [],
    budgetRefs = [], payloadRefs = [], intentRefs = [], schedulerDependencyRefs = [], stagePolicyRequirementRefs = [],
    networkPermissionPolicyRefs = [], secretResolutionPolicyRefs = [], capacitySnapshotRef, concurrencyRef, budgetRef,
    freshnessRef, idempotencyReference, registrySnapshotRef,
    modelAdmissionCount = 0, toolAdmissionCount = 0, workflowAdmissionCount = 0, parallelAdmissionCount = 0,
    estimatedInputTokens = 0, estimatedOutputTokens = 0, estimatedTotalTokens = 0, estimatedTotalCost = 0
  } = ctx;

  const requestSafe = isPlainObject(request) ? request : {};
  const dispatchPackageSafe = isPlainObject(dispatchPackageRef) ? dispatchPackageRef : {};
  const dispatchDecisionSafe = isPlainObject(dispatchDecisionRef) ? dispatchDecisionRef : {};
  const capacitySnapshotSafe = isPlainObject(capacitySnapshotRef) ? capacitySnapshotRef : {};
  const concurrencySafe = isPlainObject(concurrencyRef) ? concurrencyRef : {};
  const budgetSafe = isPlainObject(budgetRef) ? budgetRef : {};
  const freshnessSafe = isPlainObject(freshnessRef) ? freshnessRef : {};
  const idempotencySafe = isPlainObject(idempotencyReference) ? idempotencyReference : {};
  const registrySnapshotSafe = isPlainObject(registrySnapshotRef) ? registrySnapshotRef : {};
  const queueReplaySafe = isPlainObject(queueAdmissionReplayRef) ? queueAdmissionReplayRef : {};
  const canonicalSafe = canonical || {};

  const requestId = requestSafe.runtime_queue_admission_request_id || 'runtime_queue_admission_request_not_available';
  const packageId = `${requestId}-package`;

  const entryCount = admissionEntryRefs.length;
  const acceptedCount = admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION').length;
  const deferredCount = admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE' || e.admission_status === 'QUEUE_ADMISSION_DEFERRED_BACKLOG_REFERENCE' || e.admission_status === 'QUEUE_ADMISSION_DEFERRED_FAIRNESS_REFERENCE').length;
  const waitingCount = admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_WAITING_DEPENDENCY_REFERENCE' || e.admission_status === 'QUEUE_ADMISSION_WAITING_APPROVAL_REFERENCE').length;
  const optionalCount = admissionEntryRefs.filter((e) => e.admission_status === 'QUEUE_ADMISSION_OPTIONAL_REFERENCE').length;
  const blockedCount = entryCount - acceptedCount - deferredCount - waitingCount - optionalCount;

  const pkg = buildRuntimeQueueAdmissionPackage({
    runtime_queue_admission_package_id: packageId,
    runtime_queue_admission_request_id: requestId,
    runtime_dispatch_request_id: dispatchDecisionSafe.runtime_dispatch_request_id || 'runtime_dispatch_request_not_available',
    runtime_dispatch_decision_id: dispatchPackageSafe.runtime_dispatch_decision_id || 'runtime_dispatch_decision_not_available',
    runtime_dispatch_result_id: dispatchPackageSafe.runtime_dispatch_result_id || 'runtime_dispatch_result_not_available',
    runtime_dispatch_package_id: dispatchPackageSafe.runtime_dispatch_package_id || 'runtime_dispatch_package_not_available',
    runtime_worker_assignment_package_id: dispatchPackageSafe.runtime_worker_assignment_package_id || 'runtime_worker_assignment_package_not_available',
    runtime_scheduler_package_id: dispatchPackageSafe.runtime_scheduler_package_id || 'runtime_scheduler_package_not_available',
    runtime_execution_package_id: dispatchPackageSafe.runtime_execution_package_id || 'runtime_execution_package_not_available',
    runtime_queue_admission_order_reference_id: orderRef ? orderRef.runtime_queue_admission_order_reference_id : `${packageId}-order-not-available`,
    runtime_queue_admission_replay_reference_id: queueReplaySafe.runtime_queue_admission_replay_reference_id || 'runtime_queue_admission_replay_reference_not_available',
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    queue_class_reference_ids: queueClassRefs.map((r) => r.runtime_queue_class_reference_id),
    queue_capacity_snapshot_reference_ids: queueCapacityRefs.map((r) => r.runtime_queue_capacity_snapshot_reference_id),
    queue_quota_reference_ids: queueQuotaRefs.map((r) => r.runtime_queue_quota_reference_id),
    queue_partition_reference_ids: partitionRefs.map((r) => r.runtime_queue_partition_reference_id),
    queue_fairness_reference_ids: fairnessRefs.map((r) => r.runtime_queue_fairness_reference_id),
    queue_intent_binding_reference_ids: intentBindingRefs.map((r) => r.queue_intent_binding_reference_id),
    queue_admission_entry_reference_ids: admissionEntryRefs.map((r) => r.runtime_queue_admission_entry_reference_id),
    ordered_dispatch_intent_reference_ids: orderRef ? orderRef.ordered_dispatch_intent_reference_ids : [],
    ordered_queue_admission_entry_reference_ids: orderRef ? orderRef.ordered_queue_admission_entry_reference_ids : [],
    accepted_queue_admission_entry_reference_ids: orderRef ? orderRef.accepted_queue_admission_entry_reference_ids : [],
    deferred_queue_admission_entry_reference_ids: orderRef ? orderRef.deferred_queue_admission_entry_reference_ids : [],
    waiting_queue_admission_entry_reference_ids: orderRef ? orderRef.waiting_queue_admission_entry_reference_ids : [],
    optional_queue_admission_entry_reference_ids: orderRef ? orderRef.optional_queue_admission_entry_reference_ids : [],
    blocked_queue_admission_entry_reference_ids: orderRef ? orderRef.blocked_queue_admission_entry_reference_ids : [],
    entry_count: entryCount, accepted_count: acceptedCount, deferred_count: deferredCount, waiting_count: waitingCount,
    optional_count: optionalCount, blocked_count: blockedCount,
    model_admission_count: modelAdmissionCount, tool_admission_count: toolAdmissionCount,
    workflow_admission_count: workflowAdmissionCount, parallel_admission_count: parallelAdmissionCount,
    estimated_input_tokens: estimatedInputTokens, estimated_output_tokens: estimatedOutputTokens,
    estimated_total_tokens: estimatedTotalTokens, estimated_total_cost_minor_units: estimatedTotalCost,
    dispatch_package_fingerprint: dispatchPackageSafe.dispatch_package_fingerprint || 'fingerprint_not_available',
    dispatch_package_digest: dispatchPackageSafe.dispatch_package_digest || 'digest_not_available',
    worker_assignment_package_fingerprint: dispatchPackageSafe.worker_assignment_package_fingerprint || 'fingerprint_not_available',
    scheduler_package_fingerprint: dispatchPackageSafe.scheduler_package_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_fingerprint: dispatchPackageSafe.runtime_execution_package_fingerprint || 'fingerprint_not_available',
    runtime_capacity_snapshot_fingerprint: capacitySnapshotSafe.capacity_fingerprint || 'fingerprint_not_available',
    runtime_concurrency_fingerprint: concurrencySafe.concurrency_fingerprint || 'fingerprint_not_available',
    runtime_budget_fingerprint: budgetSafe.budget_fingerprint || 'fingerprint_not_available',
    runtime_freshness_fingerprint: freshnessSafe.freshness_fingerprint || 'fingerprint_not_available',
    idempotency_fingerprint: idempotencySafe.idempotency_fingerprint || 'fingerprint_not_available',
    registry_snapshot_fingerprint: registrySnapshotSafe.snapshot_fingerprint || 'fingerprint_not_available',
    dispatch_intent_fingerprints: intentRefs.map((r) => r.dispatch_intent_fingerprint),
    dispatch_stage_fingerprints: dispatchStageRefs.map((r) => r.dispatch_stage_fingerprint),
    dispatch_worker_binding_fingerprints: workerBindingRefs.map((r) => r.worker_binding_fingerprint),
    dispatch_dependency_gate_fingerprints: dependencyGateRefs.map((r) => r.dependency_gate_fingerprint),
    dispatch_approval_gate_fingerprints: approvalGateRefs.map((r) => r.approval_gate_fingerprint),
    dispatch_capacity_fingerprints: capacityRefs.map((r) => r.capacity_fingerprint),
    dispatch_budget_fingerprints: budgetRefs.map((r) => r.budget_fingerprint),
    dispatch_payload_fingerprints: payloadRefs.map((r) => r.payload_fingerprint),
    scheduler_dependency_fingerprints: schedulerDependencyRefs.map((r) => r.dependency_fingerprint),
    stage_policy_requirement_fingerprints: stagePolicyRequirementRefs.map((r) => r.requirement_reference_fingerprint),
    official_network_policy_fingerprints: networkPermissionPolicyRefs.map((o) => computeOfficialPolicyFingerprint(o)),
    official_secret_policy_fingerprints: secretResolutionPolicyRefs.map((o) => computeOfficialPolicyFingerprint(o)),
    queue_class_fingerprints: queueClassRefs.map((r) => r.queue_class_fingerprint),
    queue_capacity_snapshot_fingerprints: queueCapacityRefs.map((r) => r.capacity_snapshot_fingerprint),
    queue_quota_fingerprints: queueQuotaRefs.map((r) => r.quota_fingerprint),
    queue_partition_fingerprints: partitionRefs.map((r) => r.partition_fingerprint),
    queue_fairness_fingerprints: fairnessRefs.map((r) => r.fairness_fingerprint),
    queue_intent_binding_fingerprints: intentBindingRefs.map((r) => r.intent_binding_fingerprint),
    queue_admission_entry_fingerprints: admissionEntryRefs.map((r) => r.admission_entry_fingerprint),
    official_model_selection_decision_fingerprints: officialModelSelectionDecisionRefs.map((d) => stablePayload(d)),
    queue_admission_order_fingerprint: orderRef ? orderRef.order_fingerprint : 'fingerprint_not_available',
    queue_admission_replay_fingerprint: queueReplaySafe.replay_fingerprint || 'fingerprint_not_available',
    queue_admission_status: status
  });

  const decision = buildRuntimeQueueAdmissionDecision({
    runtime_queue_admission_decision_id: `${requestId}-decision`,
    runtime_queue_admission_request_id: requestId,
    runtime_queue_admission_package_id: pkg.runtime_queue_admission_package_id,
    runtime_dispatch_decision_id: pkg.runtime_dispatch_decision_id,
    runtime_dispatch_result_id: pkg.runtime_dispatch_result_id,
    runtime_dispatch_package_id: pkg.runtime_dispatch_package_id,
    tenant_id: pkg.tenant_id, organization_id: pkg.organization_id, project_id: pkg.project_id,
    session_reference_id: pkg.session_reference_id, agent_id: pkg.agent_id, actor_id: pkg.actor_id,
    status,
    runtime_queue_admission_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    runtime_queue_admission_package_fingerprint: pkg.queue_admission_package_fingerprint,
    runtime_queue_admission_package_digest: pkg.queue_admission_package_digest,
    runtime_dispatch_package_fingerprint: pkg.dispatch_package_fingerprint,
    runtime_dispatch_package_digest: pkg.dispatch_package_digest,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  const result = buildRuntimeQueueAdmissionResult({
    runtime_queue_admission_result_id: `${requestId}-result`,
    runtime_queue_admission_request_id: requestId,
    runtime_queue_admission_decision_id: decision.runtime_queue_admission_decision_id,
    runtime_queue_admission_package_id: decision.runtime_queue_admission_package_id,
    runtime_dispatch_package_id: decision.runtime_dispatch_package_id,
    runtime_worker_assignment_package_id: pkg.runtime_worker_assignment_package_id,
    runtime_scheduler_package_id: pkg.runtime_scheduler_package_id,
    runtime_execution_package_id: pkg.runtime_execution_package_id,
    tenant_id: decision.tenant_id, organization_id: decision.organization_id, project_id: decision.project_id,
    session_reference_id: decision.session_reference_id, agent_id: decision.agent_id, actor_id: decision.actor_id,
    status,
    runtime_queue_admission_request_fingerprint: decision.runtime_queue_admission_request_fingerprint,
    runtime_queue_admission_decision_fingerprint: computeCanonicalContentDigest(decision),
    runtime_queue_admission_package_fingerprint: decision.runtime_queue_admission_package_fingerprint,
    runtime_queue_admission_package_digest: decision.runtime_queue_admission_package_digest,
    registry_version: String(requestSafe.expected_queue_admission_registry_version || 'registry_version_not_available'),
    entry_count: pkg.entry_count, accepted_count: pkg.accepted_count, deferred_count: pkg.deferred_count,
    waiting_count: pkg.waiting_count, optional_count: pkg.optional_count, blocked_count: pkg.blocked_count,
    estimated_input_tokens: pkg.estimated_input_tokens, estimated_output_tokens: pkg.estimated_output_tokens,
    estimated_total_tokens: pkg.estimated_total_tokens, estimated_total_cost_minor_units: pkg.estimated_total_cost_minor_units,
    blockers: reasonCodes, reason_codes: reasonCodes
  });

  const audit = buildRuntimeQueueAdmissionAudit({
    decision, result,
    queueClassReferenceIds: queueClassRefs.map((r) => r.runtime_queue_class_reference_id),
    queuePartitionReferenceIds: partitionRefs.map((r) => r.runtime_queue_partition_reference_id),
    queueQuotaReferenceIds: queueQuotaRefs.map((r) => r.runtime_queue_quota_reference_id),
    priorityClasses: admissionEntryRefs.map((e) => e.queue_priority_class),
    fairnessRankOutcomes: fairnessRefs.map((f) => `${f.runtime_queue_fairness_reference_id}#rank_${f.global_admission_rank}`),
    model_admission_count: modelAdmissionCount, tool_admission_count: toolAdmissionCount,
    workflow_admission_count: workflowAdmissionCount, parallel_admission_count: parallelAdmissionCount,
    logicalSequence: requestSafe.logical_sequence
  });

  return {
    decision, result, audit, package: pkg,
    queueClassRefs, queueCapacityRefs, queueQuotaRefs, partitionRefs, fairnessRefs, intentBindingRefs, admissionEntryRefs, orderRef
  };
}

module.exports = {
  FAIRNESS_STRATEGIES_IMPLEMENTED,
  NON_PREPARED_STATUS_MAP,
  PRIORITY_RANK,
  QUEUE_CLASS_SPECIFICITY_RANK,
  QUOTA_SCOPE_TYPES,
  checkFairnessOrderPreserved,
  checkPriorityOrderPreserved,
  classifyQuotaScope,
  derivePartitionKeyValue,
  evaluateQueueClassCompatibility,
  evaluateRuntimeQueueAdmissionRequest,
  fingerprintSetMatches,
  idSetMatches,
  selectQueueClass
};
