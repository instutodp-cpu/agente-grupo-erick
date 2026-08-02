'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
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

// pr108: "Seleção da Queue Class" -- filters queue classes down to those genuinely compatible with
// this stage's declarative composition (scope, stage type, capabilities/modalities, model/tool/
// workflow/optional/parallel/state-change support), then sorts the survivors deterministically.
function selectQueueClass(stage, ctx) {
  const { queueClassRefs, canonical, capacitySnapshotByClassId, quotaRefsByClassId } = ctx;
  const hasModel = stage.model_selection_reference_id !== null;
  const hasTools = Array.isArray(stage.tool_reference_ids) && stage.tool_reference_ids.length > 0;
  const hasWorkflow = stage.workflow_reference_id !== null;
  const isStateChange = stage.side_effect_classification === 'STATE_CHANGE_REFERENCE';
  const isExternalOrIrreversible = stage.side_effect_classification === 'EXTERNAL_EFFECT_REFERENCE' || stage.side_effect_classification === 'IRREVERSIBLE_REFERENCE';

  const compatible = queueClassRefs.filter((qc) => {
    if (qc.queue_class_active !== true) return false;
    if (isExternalOrIrreversible) return false;
    const scopeOk = (qc.tenant_scope_id === null || qc.tenant_scope_id === canonical.tenantId)
      && (qc.organization_scope_id === null || qc.organization_scope_id === canonical.organizationId)
      && (qc.project_scope_id === null || qc.project_scope_id === canonical.projectId)
      && (qc.agent_scope_ids.length === 0 || qc.agent_scope_ids.includes(canonical.agentId));
    if (!scopeOk) return false;
    if (!qc.supported_stage_types.includes(stage.stage_type)) return false;
    if (!stage.required_capabilities.every((id) => qc.supported_capability_ids.includes(id))) return false;
    if (!stage.required_modalities.every((id) => qc.supported_modality_ids.includes(id))) return false;
    if (hasModel && qc.supports_model !== true) return false;
    if (hasTools && qc.supports_tool !== true) return false;
    if (hasWorkflow && qc.supports_workflow !== true) return false;
    if (stage.optional === true && qc.supports_optional !== true) return false;
    if (stage.parallelizable === true && qc.supports_parallel !== true) return false;
    if (isStateChange && qc.supports_state_change !== true) return false;
    if (!capacitySnapshotByClassId.has(qc.runtime_queue_class_reference_id)) return false;
    if (!quotaRefsByClassId.has(qc.runtime_queue_class_reference_id)) return false;
    return true;
  });

  compatible.sort((a, b) => {
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

  return compatible.length > 0 ? compatible[0] : null;
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

  // 22. Registry Snapshot -- same snapshot the Dispatch Package already proved bound (or a
  // consistent absence in both layers).
  const dispatchHadSnapshot = isNonEmptyString(dispatchPackageRef.registry_snapshot_fingerprint) && dispatchPackageRef.registry_snapshot_fingerprint !== 'fingerprint_not_available';
  if (dispatchHadSnapshot) {
    if (
      !isPlainObject(registrySnapshotRef)
      || computeSnapshotFingerprint(registrySnapshotRef) !== registrySnapshotRef.snapshot_fingerprint
      || registrySnapshotRef.snapshot_fingerprint !== dispatchPackageRef.registry_snapshot_fingerprint
    ) {
      return finalize('QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED', ['registry_snapshot_not_same_as_dispatch_layer']);
    }
  } else if (registrySnapshotRef !== null) {
    return finalize('QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED', ['registry_snapshot_present_but_dispatch_layer_had_none']);
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
  const quotaRefsByClassId = new Map();
  for (const quota of queueQuotaRefsRaw) {
    const list = quotaRefsByClassId.get(quota.runtime_queue_class_reference_id) || [];
    list.push(quota);
    quotaRefsByClassId.set(quota.runtime_queue_class_reference_id, list);
  }
  for (const qc of queueClassRefsRaw) {
    const cap = capacitySnapshotByClassId.get(qc.runtime_queue_class_reference_id);
    if (cap && cap.capacity_validated !== true) {
      return finalize('QUEUE_ADMISSION_CAPACITY_BLOCKED', ['queue_capacity_snapshot_not_validated']);
    }
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
    const selectedClass = selectQueueClass(stage, { queueClassRefs: queueClassRefsRaw, canonical, capacitySnapshotByClassId, quotaRefsByClassId });
    withQueueClass.push({ intent, stage, selectedClass });
  }

  const sortKey = (entry) => [
    entry.selectedClass ? PRIORITY_RANK[entry.selectedClass.queue_priority_class] : PRIORITY_RANK.BACKGROUND_REFERENCE,
    entry.intent.dispatch_sequence
  ];
  const fairnessOrder = [...withQueueClass].sort((a, b) => {
    const [pa, sa] = sortKey(a);
    const [pb, sb] = sortKey(b);
    if (pa !== pb) return pa - pb;
    return sa - sb;
  });

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

  function relevantQuotas(classId) {
    return (quotaRefsByClassId.get(classId) || []).filter((q) => (
      (q.tenant_id !== null && q.tenant_id === canonical.tenantId)
      || (q.organization_id !== null && q.organization_id === canonical.organizationId)
      || (q.project_id !== null && q.project_id === canonical.projectId)
      || (q.agent_id !== null && q.agent_id === canonical.agentId)
    ));
  }

  const partitionRefs = [];
  const fairnessRefs = [];
  const intentBindingRefs = [];
  const admissionEntryRefs = [];
  let admissionSequence = 0;

  for (const entry of fairnessOrder) {
    const { intent, stage, selectedClass } = entry;
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

    let partitionRef = null;
    let admissionStatus;
    const reasonCodes = [];

    if (!selectedClass) {
      admissionStatus = 'QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED';
      reasonCodes.push('no_compatible_queue_class_reference');
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

        const requestedBacklog = 1;
        const requestedInflight = 1;
        const requestedParallel = stage.parallelizable === true ? 1 : 0;
        const requestedModel = stage.model_selection_reference_id !== null ? 1 : 0;
        const requestedTool = Array.isArray(stage.tool_reference_ids) && stage.tool_reference_ids.length > 0 ? 1 : 0;
        const requestedWorkflow = stage.workflow_reference_id !== null ? 1 : 0;
        const requestedTokens = stage.estimated_total_tokens;
        const requestedCost = stage.estimated_cost_minor_units;

        const classId = selectedClass.runtime_queue_class_reference_id;
        const working = workingCapacity.get(classId);
        const capacityFits = working.backlog >= requestedBacklog && working.inflight >= requestedInflight
          && (requestedParallel === 0 || working.parallel >= requestedParallel)
          && (requestedModel === 0 || working.model >= requestedModel)
          && (requestedTool === 0 || working.tool >= requestedTool)
          && (requestedWorkflow === 0 || working.workflow >= requestedWorkflow)
          && working.tokens >= requestedTokens && working.cost >= requestedCost;

        const relevant = relevantQuotas(classId);
        const quotaFits = relevant.every((q) => {
          const w = workingQuota.get(q.runtime_queue_quota_reference_id);
          return w.admission >= 1 && w.backlog >= requestedBacklog
            && (requestedParallel === 0 || w.parallel >= requestedParallel)
            && (requestedModel === 0 || w.model >= requestedModel)
            && (requestedTool === 0 || w.tool >= requestedTool)
            && (requestedWorkflow === 0 || w.workflow >= requestedWorkflow)
            && w.tokens >= requestedTokens && w.cost >= requestedCost;
        });

        if (!quotaFits) {
          admissionStatus = 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE';
          reasonCodes.push('queue_quota_insufficient_for_intent');
        } else if (!capacityFits) {
          admissionStatus = 'QUEUE_ADMISSION_DEFERRED_BACKLOG_REFERENCE';
          reasonCodes.push('queue_capacity_insufficient_for_intent');
        } else {
          admissionStatus = 'QUEUE_ADMISSION_ACCEPTED_SIMULATION';
          working.backlog -= requestedBacklog;
          working.inflight -= requestedInflight;
          working.parallel -= requestedParallel;
          working.model -= requestedModel;
          working.tool -= requestedTool;
          working.workflow -= requestedWorkflow;
          working.tokens -= requestedTokens;
          working.cost -= requestedCost;
          for (const q of relevant) {
            const w = workingQuota.get(q.runtime_queue_quota_reference_id);
            w.admission -= 1;
            w.backlog -= requestedBacklog;
            w.parallel -= requestedParallel;
            w.model -= requestedModel;
            w.tool -= requestedTool;
            w.workflow -= requestedWorkflow;
            w.tokens -= requestedTokens;
            w.cost -= requestedCost;
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
      runtime_queue_quota_reference_id: selectedClass ? ((quotaRefsByClassId.get(selectedClass.runtime_queue_class_reference_id) || [])[0]?.runtime_queue_quota_reference_id || 'runtime_queue_quota_not_available') : 'runtime_queue_quota_not_available',
      runtime_queue_capacity_snapshot_reference_id: selectedClass ? capacitySnapshotByClassId.get(selectedClass.runtime_queue_class_reference_id).runtime_queue_capacity_snapshot_reference_id : 'runtime_queue_capacity_snapshot_not_available',
      dispatch_intent_status: intent.dispatch_intent_status,
      queue_class_match: selectedClass !== null,
      partition_match: partitionRef !== null,
      quota_match: admissionStatus !== 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE' && selectedClass !== null && partitionRef !== null,
      capacity_match: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
      fairness_match: true,
      freshness_match: true,
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
      admission_sequence: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION' ? admissionSequence++ : admissionSequence,
      queue_priority_class: priorityClass,
      admission_status: admissionStatus,
      queue_class_gate_passed: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION' ? intentBindingRef.queue_class_match : false,
      partition_gate_passed: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION' ? intentBindingRef.partition_match : false,
      quota_gate_passed: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
      capacity_gate_passed: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
      fairness_gate_passed: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
      freshness_gate_passed: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
      replay_gate_passed: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
      idempotency_gate_passed: admissionStatus === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION',
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
      runtime_queue_quota_reference_id: 'runtime_queue_quota_not_available',
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
    dispatch_order_preserved: true,
    priority_order_preserved: true,
    fairness_order_preserved: true,
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
  const perTenantCount = acceptedIds.length; // single-tenant evaluation per request in this layer
  if (Number.isInteger(policy.maximum_per_tenant_admission_count) && perTenantCount > policy.maximum_per_tenant_admission_count) {
    return finalize('QUEUE_ADMISSION_POLICY_BLOCKED', ['queue_admission_per_tenant_count_exceeds_policy_limit']);
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
    freshnessRef, idempotencyReference, registrySnapshotRef,
    modelAdmissionCount, toolAdmissionCount, workflowAdmissionCount, parallelAdmissionCount,
    estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens, estimatedTotalCost
  });
}

function buildQueueAdmissionOutcome(status, reasonCodes, ctx, validatedFlags) {
  const {
    request, requestFingerprint, canonical, dispatchDecisionRef, dispatchResultRef, dispatchPackageRef,
    queueClassRefs = [], queueCapacityRefs = [], queueQuotaRefs = [], partitionRefs = [], fairnessRefs = [],
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
  NON_PREPARED_STATUS_MAP,
  PRIORITY_RANK,
  QUEUE_CLASS_SPECIFICITY_RANK,
  derivePartitionKeyValue,
  evaluateRuntimeQueueAdmissionRequest,
  fingerprintSetMatches,
  idSetMatches,
  selectQueueClass
};
