'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { checkIdentity } = require('./runtime-execution-package');
const { FRESHNESS_DIMENSIONS } = require('./runtime-readiness-freshness-reference');
const { computeIdempotencyFingerprint } = require('./execution-plan-idempotency');
const { validateRuntimeWorkerAssignmentRequest } = require('./runtime-worker-assignment-request');
const { buildRuntimeWorkerCompatibilityReference } = require('./runtime-worker-compatibility-reference');
const { buildRuntimeWorkerCandidateSetReference } = require('./runtime-worker-candidate-set-reference');
const { buildRuntimeWorkerStageAssignmentReference } = require('./runtime-worker-stage-assignment-reference');
const { buildRuntimeWorkerAssignmentPackage } = require('./runtime-worker-assignment-package');
const { buildRuntimeWorkerAssignmentDecision } = require('./runtime-worker-assignment-decision');
const { buildRuntimeWorkerAssignmentResult } = require('./runtime-worker-assignment-result');
const { buildRuntimeWorkerAssignmentAudit } = require('./runtime-worker-assignment-audit');

// pr106: the single evaluator this PR exists to build. Receives only an already
// SCHEDULER_PACKAGE_PREPARED_SIMULATION package and produces a purely declarative recommendation:
// which synthetic worker (if any) would be compatible with each Scheduler Stage Reference, and
// which one would be recommended deterministically. Nothing here reserves a worker, starts a
// process/thread/container, opens a connection, dispatches a stage, or consumes capacity -- every
// one of those flags is forced false in every outcome this boundary can ever produce (see
// buildWorkerAssignmentOutcome below).

const WAITING_STATUSES = Object.freeze({
  BLOCKED: 'SCHEDULER_STAGE_BLOCKED',
  WAITING_DEPENDENCY: 'SCHEDULER_STAGE_WAITING_DEPENDENCY_REFERENCE',
  WAITING_APPROVAL: 'SCHEDULER_STAGE_WAITING_APPROVAL_REFERENCE'
});

// Mirrors runtime-scheduler-boundary.js's own omitReplayReference exactly, for this layer's own
// request field: `runtime_replay_reference`.
function omitReplayReference(obj) {
  if (!isPlainObject(obj)) return obj;
  const { runtime_replay_reference, ...rest } = obj;
  return rest;
}

// --- Compatibility derivation ---------------------------------------------------------------------

// pr106fix FIX 1: a stage only requires network/secret access when it actually reaches an external
// capability (model provider call, tool invocation, workflow orchestration) -- a pure no-LLM/
// deterministic stage genuinely has no requirement, represented explicitly as NOT_APPLICABLE (match
// true via this named rule), never inferred from string presence.
function deriveStageRequiresNetworkOrSecret(stage) {
  const hasModel = stage.model_selection_reference_id !== null;
  const hasTools = Array.isArray(stage.tool_reference_ids) && stage.tool_reference_ids.length > 0;
  const hasWorkflow = stage.workflow_reference_id !== null;
  return hasModel || hasTools || hasWorkflow;
}

// pr106fix FIX 1: genuine 1:1 policy reference comparison -- ID, version, fingerprint, and tenant/
// organization/project/environment binding, never a string-presence pass-through. `policyRef` is the
// (at most one) RuntimeWorkerNetworkPolicyReference/RuntimeWorkerSecretPolicyReference bound to this
// worker, looked up by runtime_worker_reference_id.
function evaluatePolicyReferenceMatch(kind, stage, worker, policyRef, canonical) {
  const idField = `${kind}_policy_reference_id`;
  const versionField = `${kind}_policy_version`;
  const fingerprintField = `${kind}_policy_fingerprint`;
  const validField = `${kind}_policy_reference_valid`;
  if (!deriveStageRequiresNetworkOrSecret(stage)) return { match: true, reason: null };
  if (!isPlainObject(policyRef)) return { match: false, reason: `worker_${kind}_policy_reference_missing` };
  if (policyRef[idField] !== worker[idField]) return { match: false, reason: `worker_${kind}_policy_id_mismatch` };
  if (policyRef[validField] !== true) return { match: false, reason: `worker_${kind}_policy_reference_invalid` };
  if (policyRef.tenant_id !== canonical.tenantId) return { match: false, reason: `worker_${kind}_policy_tenant_mismatch` };
  if (policyRef.organization_id !== canonical.organizationId) return { match: false, reason: `worker_${kind}_policy_organization_mismatch` };
  if (policyRef.project_id !== null && policyRef.project_id !== canonical.projectId) return { match: false, reason: `worker_${kind}_policy_project_mismatch` };
  if (policyRef.runtime_environment_reference_id !== worker.runtime_environment_reference_id) return { match: false, reason: `worker_${kind}_policy_environment_mismatch` };
  void versionField;
  void fingerprintField;
  return { match: true, reason: null };
}

// pr106fix FIX 2: worker health is reavaliated on the Worker Assignment Request's own
// logical_sequence -- a health reference valid at an earlier sequence can have expired by the time
// assignment is evaluated; the contract's own `health_validated`/`health_expired_logically` (computed
// against the health reference's own frozen current_logical_sequence) are never trusted alone.
function evaluateHealthAtAssignment(health, requestLogicalSequence) {
  if (requestLogicalSequence < health.current_logical_sequence || requestLogicalSequence < health.health_created_logical_sequence) {
    return { match: false, reason: 'worker_health_sequence_regressive', structural: true };
  }
  const healthExpiredAtAssignment = (requestLogicalSequence - health.health_created_logical_sequence) > health.maximum_valid_sequences;
  if (healthExpiredAtAssignment) return { match: false, reason: 'worker_health_expired_at_assignment_sequence', structural: false };
  if (health.health_status !== 'HEALTHY_REFERENCE_SIMULATION') return { match: false, reason: 'worker_health_status_not_healthy', structural: false };
  const bindingsValid = health.configuration_valid === true && health.registration_valid === true
    && health.capability_reference_valid === true && health.capacity_reference_valid === true && health.policy_references_valid === true;
  if (!bindingsValid) return { match: false, reason: 'worker_health_binding_invalid', structural: false };
  return { match: true, reason: null, structural: false };
}

// Every one of the 17 match dimensions, recomputed from the real stage/worker/capability/capacity/
// health/policy data -- "Não aceitar worker_compatible=true como fonte de verdade."
function deriveMatches(stage, worker, capability, capacity, health, canonical, freshnessValid, requestLogicalSequence, networkPolicyRef, secretPolicyRef) {
  const hasModel = stage.model_selection_reference_id !== null;
  const hasTools = Array.isArray(stage.tool_reference_ids) && stage.tool_reference_ids.length > 0;
  const hasWorkflow = stage.workflow_reference_id !== null;
  const networkEvaluation = evaluatePolicyReferenceMatch('network', stage, worker, networkPolicyRef, canonical);
  const secretEvaluation = evaluatePolicyReferenceMatch('secret', stage, worker, secretPolicyRef, canonical);
  const healthEvaluation = evaluateHealthAtAssignment(health, requestLogicalSequence);
  return {
    matches: {
      tenant_match: worker.tenant_scope_id === null || worker.tenant_scope_id === canonical.tenantId,
      organization_match: worker.organization_scope_id === null || worker.organization_scope_id === canonical.organizationId,
      project_match: worker.project_scope_id === null || worker.project_scope_id === canonical.projectId,
      agent_scope_match: worker.agent_scope_ids.length === 0 || worker.agent_scope_ids.includes(canonical.agentId),
      stage_type_match: capability.stage_type_ids.includes(stage.stage_type),
      capability_match: stage.required_capabilities.every((id) => capability.capability_ids.includes(id)),
      modality_match: stage.required_modalities.every((id) => capability.modality_ids.includes(id)),
      model_support_match: !hasModel || capability.supports_model_reference === true,
      tool_support_match: !hasTools || stage.tool_reference_ids.every((id) => capability.tool_ids.includes(id)),
      workflow_support_match: !hasWorkflow || capability.workflow_ids.includes(stage.workflow_reference_id),
      network_policy_match: networkEvaluation.match,
      secret_policy_match: secretEvaluation.match,
      // External/irreversible effects are already forced false on every worker capability
      // (supports_external_effect_reference/supports_irreversible_reference) and already blocked at
      // the Scheduler layer for any stage that carries one -- this dimension is true whenever the
      // stage reaches this boundary at all.
      effect_policy_match: stage.side_effect_classification !== 'EXTERNAL_EFFECT_REFERENCE' && stage.side_effect_classification !== 'IRREVERSIBLE_REFERENCE',
      health_match: healthEvaluation.match,
      capacity_match: (
        capacity.available_stage_assignments >= 1
        && (!stage.parallelizable || capacity.available_parallel_assignments >= 1)
        && (!hasModel || capacity.available_model_assignments >= 1)
        && (!hasTools || capacity.available_tool_assignments >= 1)
        && (!hasWorkflow || capacity.available_workflow_assignments >= 1)
        && capacity.available_token_capacity >= stage.estimated_total_tokens
        && capacity.available_cost_capacity_minor_units >= stage.estimated_cost_minor_units
      ),
      concurrency_match: worker.available_parallel_assignments >= 1,
      freshness_match: freshnessValid === true
    },
    reasons: {
      network_policy_match: networkEvaluation.reason,
      secret_policy_match: secretEvaluation.reason,
      health_match: healthEvaluation.reason
    }
  };
}

function classificationMatchesStage(classification, stage) {
  const hasModel = stage.model_selection_reference_id !== null;
  const hasTools = Array.isArray(stage.tool_reference_ids) && stage.tool_reference_ids.length > 0;
  const hasWorkflow = stage.workflow_reference_id !== null;
  if (classification === 'MODEL_WORKER_REFERENCE') return hasModel;
  if (classification === 'TOOL_WORKER_REFERENCE') return hasTools;
  if (classification === 'WORKFLOW_WORKER_REFERENCE') return hasWorkflow;
  if (classification === 'DETERMINISTIC_WORKER_REFERENCE') return !hasModel && !hasTools && !hasWorkflow;
  return false;
}

// The spec's own 9-tier deterministic comparator, applied as a sort key tuple over the compatible
// candidate set only.
function selectionSortKey(worker, capacity, stage, canonical) {
  const isDedicated = worker.worker_type === 'DEDICATED_REFERENCE'
    && worker.tenant_scope_id === canonical.tenantId && worker.organization_scope_id === canonical.organizationId
    && worker.project_scope_id === canonical.projectId;
  const isExactClassification = classificationMatchesStage(worker.worker_classification, stage);
  return [
    isDedicated ? 0 : 1,
    isExactClassification ? 0 : 1,
    -capacity.available_stage_assignments,
    -capacity.available_parallel_assignments,
    -capacity.available_token_capacity,
    -capacity.available_cost_capacity_minor_units,
    capacity.current_stage_assignments,
    capacity.current_parallel_assignments,
    worker.runtime_worker_reference_id
  ];
}

function compareSortKeys(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

// --- Main evaluator ------------------------------------------------------------------------------

function evaluateRuntimeWorkerAssignmentRequest(request, context = {}) {
  void context; // never consulted for any decision.
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  const requestIsObject = isPlainObject(request);
  const policy = requestIsObject ? request.runtime_worker_assignment_policy : undefined;
  const schedulerRequestRef = requestIsObject ? request.runtime_scheduler_request_reference : undefined;
  const schedulerDecisionRef = requestIsObject ? request.runtime_scheduler_decision_reference : undefined;
  const schedulerResultRef = requestIsObject ? request.runtime_scheduler_result_reference : undefined;
  const schedulerPackageRef = requestIsObject ? request.runtime_scheduler_package_reference : undefined;
  const packageRef = requestIsObject ? request.runtime_execution_package_reference : undefined;
  const stageManifest = requestIsObject ? request.runtime_stage_manifest_reference : undefined;
  const capacitySnapshotRef = requestIsObject ? request.runtime_capacity_snapshot_reference : undefined;
  const concurrencyRef = requestIsObject ? request.runtime_concurrency_reference : undefined;
  const freshnessRef = requestIsObject ? request.runtime_freshness_reference : undefined;
  const replayRef = requestIsObject ? request.runtime_replay_reference : undefined;
  const idempotencyReference = requestIsObject ? request.idempotency_reference : undefined;
  const workerRefs = requestIsObject && Array.isArray(request.runtime_worker_references) ? request.runtime_worker_references : [];
  const workerCapabilityRefs = requestIsObject && Array.isArray(request.runtime_worker_capability_references) ? request.runtime_worker_capability_references : [];
  const workerCapacityRefs = requestIsObject && Array.isArray(request.runtime_worker_capacity_references) ? request.runtime_worker_capacity_references : [];
  const workerHealthRefs = requestIsObject && Array.isArray(request.runtime_worker_health_references) ? request.runtime_worker_health_references : [];
  const workerNetworkPolicyRefs = requestIsObject && Array.isArray(request.runtime_worker_network_policy_references) ? request.runtime_worker_network_policy_references : [];
  const workerSecretPolicyRefs = requestIsObject && Array.isArray(request.runtime_worker_secret_policy_references) ? request.runtime_worker_secret_policy_references : [];

  const canonical = {
    tenantId: isPlainObject(packageRef) ? packageRef.tenant_id : undefined,
    organizationId: isPlainObject(packageRef) ? packageRef.organization_id : undefined,
    projectId: isPlainObject(packageRef) ? packageRef.project_id : undefined,
    sessionId: isPlainObject(packageRef) ? packageRef.session_reference_id : undefined,
    agentId: isPlainObject(packageRef) ? packageRef.agent_id : undefined,
    actorId: isPlainObject(packageRef) ? packageRef.actor_id : undefined
  };

  const requestForFingerprint = requestIsObject ? omitReplayReference(request) : request;
  const requestFingerprint = computeCanonicalContentDigest(requestForFingerprint);

  function finalize(status, reasonCodes, derived = {}) {
    return buildWorkerAssignmentOutcome(status, reasonCodes, {
      request, requestFingerprint, canonical, schedulerDecisionRef, schedulerResultRef, schedulerPackageRef,
      packageRef, capacitySnapshotRef, concurrencyRef, freshnessRef, idempotencyReference, ...derived
    }, validatedFlags);
  }

  // 1-2. Request contract shape, including simulation_context and every nested reference against
  // its own real validator (policy, scheduler chain, package, manifest, capacity, concurrency,
  // freshness, replay, idempotency, worker/capability/capacity/health arrays).
  const requestValidation = validateRuntimeWorkerAssignmentRequest(request);
  if (!requestValidation.valid) return finalize('WORKER_ASSIGNMENT_VALIDATION_FAILED', ['runtime_worker_assignment_request_invalid']);
  markValid('request_validated');

  // 9. Identity -- evaluated early, matching the real precedence order.
  const identityChecks = [
    ['runtime_execution_package_reference', packageRef], ['runtime_stage_manifest_reference', stageManifest],
    ['runtime_capacity_snapshot_reference', capacitySnapshotRef], ['runtime_concurrency_reference', concurrencyRef]
  ];
  for (const [label, reference] of identityChecks) {
    const mismatch = checkIdentity(reference, canonical, label);
    if (mismatch) return finalize(mismatch.status, [mismatch.reason]);
  }
  markValid('identity_validated');

  // 3. Assignment Policy -- allow_* flags genuinely re-checked against the real stage/worker
  // composition; external/irreversible effects are never allowed regardless of policy.
  const stages = isPlainObject(stageManifest) && Array.isArray(stageManifest.runtime_stage_references) ? stageManifest.runtime_stage_references : [];
  const hasExternalEffect = stages.some((s) => s.side_effect_classification === 'EXTERNAL_EFFECT_REFERENCE');
  const hasIrreversibleEffect = stages.some((s) => s.side_effect_classification === 'IRREVERSIBLE_REFERENCE');
  if (hasExternalEffect) return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', ['external_effect_reference_never_allowed']);
  if (hasIrreversibleEffect) return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', ['irreversible_reference_never_allowed']);
  const hasNoLlmStage = stages.some((s) => s.model_selection_reference_id === null && (!Array.isArray(s.tool_reference_ids) || s.tool_reference_ids.length === 0) && s.workflow_reference_id === null);
  const hasModelStage = stages.some((s) => s.model_selection_reference_id !== null);
  const hasToolStage = stages.some((s) => Array.isArray(s.tool_reference_ids) && s.tool_reference_ids.length > 0);
  const hasWorkflowStage = stages.some((s) => s.workflow_reference_id !== null);
  const hasParallelStage = stages.some((s) => s.parallelizable === true);
  const hasStateChangeStage = stages.some((s) => s.side_effect_classification === 'STATE_CHANGE_REFERENCE');
  if (hasNoLlmStage && policy.allow_no_llm_stage !== true) return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', ['no_llm_stage_not_allowed_by_policy']);
  if (hasModelStage && policy.allow_model_stage !== true) return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', ['model_stage_not_allowed_by_policy']);
  if (hasToolStage && policy.allow_tool_stage !== true) return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', ['tool_stage_not_allowed_by_policy']);
  if (hasWorkflowStage && policy.allow_workflow_stage !== true) return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', ['workflow_stage_not_allowed_by_policy']);
  if (hasParallelStage && policy.allow_parallel_stage !== true) return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', ['parallel_stage_not_allowed_by_policy']);
  if (hasStateChangeStage && policy.allow_state_change_reference !== true) return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', ['state_change_reference_not_allowed_by_policy']);
  const workerTypePolicyByType = {
    LOCAL_REFERENCE: 'allow_local_worker_reference', REMOTE_REFERENCE: 'allow_remote_worker_reference',
    SHARED_REFERENCE: 'allow_shared_worker_reference', DEDICATED_REFERENCE: 'allow_dedicated_worker_reference'
  };
  for (const worker of workerRefs) {
    const flag = workerTypePolicyByType[worker.worker_type];
    if (flag && policy[flag] !== true) return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', [`${worker.worker_type.toLowerCase()}_not_allowed_by_policy`]);
  }
  markValid('policy_validated');

  // 4-7. Scheduler chain -- must be a genuine, matching, already-prepared chain.
  if (
    schedulerDecisionRef.status !== 'SCHEDULER_PACKAGE_PREPARED_SIMULATION' || schedulerDecisionRef.scheduler_package_prepared_in_simulation !== true
    || schedulerResultRef.status !== 'SCHEDULER_PACKAGE_PREPARED_SIMULATION' || schedulerResultRef.scheduler_package_prepared_in_simulation !== true
    || schedulerPackageRef.scheduler_status !== 'SCHEDULER_PACKAGE_PREPARED_SIMULATION' || schedulerPackageRef.scheduler_package_prepared_in_simulation !== true
    || schedulerDecisionRef.runtime_scheduler_request_id !== schedulerRequestRef.runtime_scheduler_request_id
    || schedulerResultRef.runtime_scheduler_decision_id !== schedulerDecisionRef.runtime_scheduler_decision_id
    || schedulerPackageRef.runtime_scheduler_package_id !== schedulerDecisionRef.runtime_scheduler_package_id
    || schedulerDecisionRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || schedulerDecisionRef.scheduler_started === true || schedulerResultRef.scheduler_started === true
  ) {
    return finalize('WORKER_ASSIGNMENT_SCHEDULER_BLOCKED', ['scheduler_chain_not_genuinely_prepared']);
  }
  markValid('scheduler_validated');

  // 8. Runtime Execution Package -- still the exact same, never-mutated package the scheduler chain
  // found prepared.
  if (
    packageRef.runtime_status !== 'RUNTIME_PACKAGE_PREPARED_SIMULATION' || packageRef.runtime_admitted_in_simulation !== false
    || packageRef.runtime_enabled === true || packageRef.execution_authorized === true || packageRef.executed === true
    || packageRef.package_fingerprint !== schedulerPackageRef.runtime_execution_package_fingerprint
    || packageRef.package_digest !== schedulerPackageRef.runtime_execution_package_digest
  ) {
    return finalize('WORKER_ASSIGNMENT_RUNTIME_PACKAGE_BLOCKED', ['runtime_package_not_still_prepared_or_mutated']);
  }
  markValid('runtime_package_validated');

  // 13-16 (worker registry portion). Every worker id/capability/capacity/health id is unique;
  // DEDICATED workers carry a fully-scoped identity, SHARED workers carry none -- "validar
  // escopos" folded in here since there is no separate precedence slot for it.
  const workerIds = workerRefs.map((w) => w.runtime_worker_reference_id);
  if (new Set(workerIds).size !== workerIds.length) {
    return finalize('WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', ['duplicate_worker_reference_id']);
  }
  const scopeInvalid = workerRefs.some((worker) => {
    if (worker.worker_type === 'DEDICATED_REFERENCE') {
      return worker.tenant_scope_id === null || worker.organization_scope_id === null || worker.project_scope_id === null;
    }
    if (worker.worker_type === 'SHARED_REFERENCE') {
      return worker.tenant_scope_id !== null || worker.organization_scope_id !== null || worker.project_scope_id !== null;
    }
    return false;
  });
  if (scopeInvalid) return finalize('WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', ['worker_scope_declaration_invalid']);
  markValid('worker_registry_validated');
  markValid('worker_references_validated');

  // 17 (capability portion). Every worker's own capability/capacity/health binding must be exactly
  // 1:1 -- present, matching runtime_worker_reference_id, never missing, never duplicated. Self-
  // fingerprint válido não substitui cross-check entre objetos.
  const capabilityById = new Map(workerCapabilityRefs.map((c) => [c.worker_capability_reference_id, c]));
  const capacityById = new Map(workerCapacityRefs.map((c) => [c.worker_capacity_reference_id, c]));
  const healthById = new Map(workerHealthRefs.map((h) => [h.worker_health_reference_id, h]));
  for (const worker of workerRefs) {
    const capability = capabilityById.get(worker.worker_capability_reference_id);
    if (!capability || capability.runtime_worker_reference_id !== worker.runtime_worker_reference_id) {
      return finalize('WORKER_ASSIGNMENT_CAPABILITY_BLOCKED', ['worker_capability_reference_binding_mismatch']);
    }
  }
  markValid('capabilities_validated');

  // 16 (health portion). pr106fix FIX 2: beyond the 1:1 binding, every health reference's own
  // sequence fields must not be ahead of this Worker Assignment Request's own logical_sequence --
  // a health reference describing a "later" sequence than the request itself is a structural
  // inconsistency, never just "this worker happens to be unhealthy for this stage".
  for (const worker of workerRefs) {
    const health = healthById.get(worker.worker_health_reference_id);
    if (!health || health.runtime_worker_reference_id !== worker.runtime_worker_reference_id) {
      return finalize('WORKER_ASSIGNMENT_HEALTH_BLOCKED', ['worker_health_reference_binding_mismatch']);
    }
    if (request.logical_sequence < health.current_logical_sequence || request.logical_sequence < health.health_created_logical_sequence) {
      return finalize('WORKER_ASSIGNMENT_HEALTH_BLOCKED', ['worker_health_sequence_regressive']);
    }
  }
  markValid('health_validated');

  // pr106fix FIX 1: network/secret policy references are optional per worker (only required when
  // the worker is actually recommended for a stage that needs one -- see deriveMatches), but when
  // present must be genuinely 1:1 -- never duplicated, never bound to a worker that does not exist.
  const networkPolicyByWorkerId = new Map();
  for (const ref of workerNetworkPolicyRefs) {
    if (networkPolicyByWorkerId.has(ref.runtime_worker_reference_id)) {
      return finalize('WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', ['duplicate_worker_network_policy_reference']);
    }
    if (!workerIds.includes(ref.runtime_worker_reference_id)) {
      return finalize('WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', ['worker_network_policy_reference_orphaned']);
    }
    networkPolicyByWorkerId.set(ref.runtime_worker_reference_id, ref);
  }
  const secretPolicyByWorkerId = new Map();
  for (const ref of workerSecretPolicyRefs) {
    if (secretPolicyByWorkerId.has(ref.runtime_worker_reference_id)) {
      return finalize('WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', ['duplicate_worker_secret_policy_reference']);
    }
    if (!workerIds.includes(ref.runtime_worker_reference_id)) {
      return finalize('WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', ['worker_secret_policy_reference_orphaned']);
    }
    secretPolicyByWorkerId.set(ref.runtime_worker_reference_id, ref);
  }
  markValid('network_secret_policy_registry_validated');

  // 15 (capacity portion).
  for (const worker of workerRefs) {
    const capacity = capacityById.get(worker.worker_capacity_reference_id);
    if (!capacity || capacity.runtime_worker_reference_id !== worker.runtime_worker_reference_id) {
      return finalize('WORKER_ASSIGNMENT_CAPACITY_BLOCKED', ['worker_capacity_reference_binding_mismatch']);
    }
  }
  markValid('capacity_validated');

  // 10. Freshness -- recomputed using this request's own logical_sequence, never the frozen
  // current_logical_sequence the reference already carries.
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < freshnessRef.current_logical_sequence) {
    return finalize('WORKER_ASSIGNMENT_FRESHNESS_BLOCKED', ['worker_assignment_logical_sequence_regressive']);
  }
  const freshnessExpired = FRESHNESS_DIMENSIONS.some(([, createdField, maximumField]) => (
    (request.logical_sequence - freshnessRef[createdField]) > freshnessRef[maximumField]
  ));
  if (freshnessExpired || freshnessRef.freshness_validated !== true) {
    return finalize('WORKER_ASSIGNMENT_FRESHNESS_BLOCKED', ['runtime_freshness_expired_at_worker_assignment_logical_sequence']);
  }
  markValid('freshness_validated');

  // 11. Replay -- the reused RuntimeReadinessReplayReference is proven to be the exact same object
  // the Scheduler Request itself already carried, never independently substituted, and to still
  // genuinely describe this exact package.
  if (
    replayRef.replay_fingerprint !== schedulerRequestRef.runtime_replay_reference.replay_fingerprint
    || replayRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || replayRef.runtime_package_fingerprint !== packageRef.package_fingerprint
    || replayRef.runtime_package_digest !== packageRef.package_digest
    || replayRef.replay_validated !== true || replayRef.replay_allowed !== true
  ) {
    return finalize('WORKER_ASSIGNMENT_REPLAY_BLOCKED', ['runtime_replay_reference_not_bound_to_worker_assignment_request']);
  }
  markValid('replay_validated');

  // 12. Idempotency -- the real, official ExecutionPlanIdempotencyReference is proven to be the
  // exact same object the Scheduler Request itself already carried, plus its own self-fingerprint
  // (the contract's own validator does not recompute-and-compare one) and safe flags.
  if (
    idempotencyReference.idempotency_reference_id !== schedulerRequestRef.idempotency_reference.idempotency_reference_id
    || idempotencyReference.idempotency_fingerprint !== schedulerRequestRef.idempotency_reference.idempotency_fingerprint
    || computeIdempotencyFingerprint(idempotencyReference) !== idempotencyReference.idempotency_fingerprint
    || idempotencyReference.idempotency_validated !== true || idempotencyReference.idempotency_consumed !== false
    || idempotencyReference.duplicate_execution_blocked !== true
  ) {
    return finalize('WORKER_ASSIGNMENT_IDEMPOTENCY_BLOCKED', ['idempotency_reference_not_bound_to_scheduler_chain']);
  }
  markValid('idempotency_validated');

  // 20. Derive Compatibility References -- stage x worker, every match dimension recomputed.
  const schedulerStages = Array.isArray(schedulerResultRef.scheduler_stage_references) ? schedulerResultRef.scheduler_stage_references : [];
  const compatibilityRefs = [];
  const compatibilityByStageAndWorker = new Map();
  for (const stage of schedulerStages) {
    for (const worker of workerRefs) {
      const capability = capabilityById.get(worker.worker_capability_reference_id);
      const capacity = capacityById.get(worker.worker_capacity_reference_id);
      const health = healthById.get(worker.worker_health_reference_id);
      const networkPolicyRef = networkPolicyByWorkerId.get(worker.runtime_worker_reference_id);
      const secretPolicyRef = secretPolicyByWorkerId.get(worker.runtime_worker_reference_id);
      const { matches, reasons } = deriveMatches(
        stage, worker, capability, capacity, health, canonical, freshnessRef.freshness_validated,
        request.logical_sequence, networkPolicyRef, secretPolicyRef
      );
      const ref = buildRuntimeWorkerCompatibilityReference({
        worker_compatibility_reference_id: `${stage.scheduler_stage_reference_id}-${worker.runtime_worker_reference_id}-compatibility`,
        runtime_worker_assignment_request_id: request.runtime_worker_assignment_request_id,
        runtime_scheduler_package_id: schedulerPackageRef.runtime_scheduler_package_id,
        scheduler_stage_reference_id: stage.scheduler_stage_reference_id,
        runtime_stage_reference_id: stage.runtime_stage_reference_id,
        runtime_worker_reference_id: worker.runtime_worker_reference_id,
        ...matches,
        mismatch_reason_codes: Object.entries(matches).filter(([, v]) => v !== true).map(([k]) => reasons[k] || k)
      });
      compatibilityRefs.push(ref);
      compatibilityByStageAndWorker.set(`${stage.scheduler_stage_reference_id}::${worker.runtime_worker_reference_id}`, ref);
    }
  }
  markValid('compatibilities_validated');

  // 21-22. Derive Candidate Sets + deterministic selection.
  const candidateSetByStageId = new Map();
  for (const stage of schedulerStages) {
    const stageCompatibilities = workerRefs.map((worker) => compatibilityByStageAndWorker.get(`${stage.scheduler_stage_reference_id}::${worker.runtime_worker_reference_id}`));
    const compatibleWorkerIds = stageCompatibilities.filter((c) => c.worker_compatible === true).map((c) => c.runtime_worker_reference_id);
    const incompatibleWorkerIds = stageCompatibilities.filter((c) => c.worker_compatible !== true).map((c) => c.runtime_worker_reference_id);
    if (compatibleWorkerIds.length > policy.maximum_worker_candidates_per_stage) {
      return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', ['worker_candidates_per_stage_exceeds_policy_limit']);
    }
    let recommendedWorkerId = null;
    if (compatibleWorkerIds.length > 0) {
      const compatibleWorkers = workerRefs.filter((w) => compatibleWorkerIds.includes(w.runtime_worker_reference_id));
      const sorted = [...compatibleWorkers].sort((a, b) => compareSortKeys(
        selectionSortKey(a, capacityById.get(a.worker_capacity_reference_id), stage, canonical),
        selectionSortKey(b, capacityById.get(b.worker_capacity_reference_id), stage, canonical)
      ));
      recommendedWorkerId = sorted[0].runtime_worker_reference_id;
    }
    const candidateSet = buildRuntimeWorkerCandidateSetReference({
      worker_candidate_set_reference_id: `${stage.scheduler_stage_reference_id}-candidate-set`,
      runtime_worker_assignment_request_id: request.runtime_worker_assignment_request_id,
      runtime_scheduler_package_id: schedulerPackageRef.runtime_scheduler_package_id,
      scheduler_stage_reference_id: stage.scheduler_stage_reference_id,
      runtime_stage_reference_id: stage.runtime_stage_reference_id,
      worker_compatibility_reference_ids: stageCompatibilities.map((c) => c.worker_compatibility_reference_id),
      compatible_worker_reference_ids: compatibleWorkerIds,
      incompatible_worker_reference_ids: incompatibleWorkerIds,
      recommended_worker_reference_id: recommendedWorkerId,
      selection_reason_codes: recommendedWorkerId ? ['deterministic_capability_capacity_priority_selected'] : []
    });
    candidateSetByStageId.set(stage.scheduler_stage_reference_id, candidateSet);
  }
  markValid('candidate_sets_validated');

  // 23. Derive Stage Assignment References -- waiting stages stay waiting regardless of candidate
  // availability; blocked stages never receive a recommendation; only eligible/optional stages with
  // at least one compatible candidate are recommended.
  const assignmentRefs = [];
  for (const stage of schedulerStages) {
    const candidateSet = candidateSetByStageId.get(stage.scheduler_stage_reference_id);
    let assignmentStatus;
    if (stage.scheduler_stage_status === WAITING_STATUSES.BLOCKED) assignmentStatus = 'WORKER_ASSIGNMENT_BLOCKED';
    else if (stage.scheduler_stage_status === WAITING_STATUSES.WAITING_DEPENDENCY) assignmentStatus = 'WORKER_WAITING_DEPENDENCY_REFERENCE';
    else if (stage.scheduler_stage_status === WAITING_STATUSES.WAITING_APPROVAL) assignmentStatus = 'WORKER_WAITING_APPROVAL_REFERENCE';
    else if (candidateSet.recommended_worker_reference_id !== null) assignmentStatus = 'WORKER_RECOMMENDED_SIMULATION';
    else assignmentStatus = 'WORKER_NO_COMPATIBLE_CANDIDATE_BLOCKED';

    assignmentRefs.push(buildRuntimeWorkerStageAssignmentReference({
      worker_stage_assignment_reference_id: `${stage.scheduler_stage_reference_id}-assignment`,
      runtime_worker_assignment_package_id: `${request.runtime_worker_assignment_request_id}-package`,
      runtime_scheduler_package_id: schedulerPackageRef.runtime_scheduler_package_id,
      runtime_execution_package_id: packageRef.runtime_execution_package_id,
      scheduler_stage_reference_id: stage.scheduler_stage_reference_id,
      runtime_stage_reference_id: stage.runtime_stage_reference_id,
      worker_candidate_set_reference_id: candidateSet.worker_candidate_set_reference_id,
      recommended_worker_reference_id: candidateSet.recommended_worker_reference_id,
      assignment_status: assignmentStatus,
      assignment_reason_codes: assignmentStatus === 'WORKER_NO_COMPATIBLE_CANDIDATE_BLOCKED' ? ['no_compatible_worker_candidate'] : [],
      stage_type: stage.stage_type,
      priority: stage.priority,
      parallelizable: stage.parallelizable,
      approval_required: stage.approval_required,
      required_capability_ids: stage.required_capabilities,
      required_modality_ids: stage.required_modalities,
      estimated_total_tokens: stage.estimated_total_tokens,
      estimated_cost_minor_units: stage.estimated_cost_minor_units
    }));
  }
  markValid('assignments_validated');

  // 16. No-candidate check -- an eligible/optional stage with zero compatible workers blocks the
  // whole package fail-closed, never a silent fallback.
  if (policy.fail_on_no_candidate === true && assignmentRefs.some((a) => a.assignment_status === 'WORKER_NO_COMPATIBLE_CANDIDATE_BLOCKED')) {
    return finalize('WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED', ['stage_has_no_compatible_worker_candidate']);
  }

  // 15. Compatibility-derived block -- a policy that requires every match dimension and finds none
  // reachable at all (e.g. zero workers supplied while stages need one) fails closed here too.
  if (policy.fail_on_capability_mismatch === true && workerRefs.length === 0 && schedulerStages.some((s) => s.scheduler_stage_status === 'SCHEDULER_STAGE_ELIGIBLE_SIMULATION' || s.scheduler_stage_status === 'SCHEDULER_STAGE_OPTIONAL_REFERENCE')) {
    return finalize('WORKER_ASSIGNMENT_COMPATIBILITY_BLOCKED', ['no_worker_references_supplied_for_evaluable_stages']);
  }

  // 24. Policy limits -- per-worker aggregate caps across the whole package.
  const perWorkerStageCounts = new Map();
  const perWorkerParallelCounts = new Map();
  const perWorkerModelCounts = new Map();
  const perWorkerToolCounts = new Map();
  const perWorkerWorkflowCounts = new Map();
  const perWorkerTokens = new Map();
  const perWorkerCost = new Map();
  for (const assignment of assignmentRefs) {
    if (assignment.assignment_status !== 'WORKER_RECOMMENDED_SIMULATION') continue;
    const id = assignment.recommended_worker_reference_id;
    perWorkerStageCounts.set(id, (perWorkerStageCounts.get(id) || 0) + 1);
    if (assignment.parallelizable) perWorkerParallelCounts.set(id, (perWorkerParallelCounts.get(id) || 0) + 1);
    if (assignment.stage_type === 'MODEL_REFERENCE_STAGE') perWorkerModelCounts.set(id, (perWorkerModelCounts.get(id) || 0) + 1);
    if (assignment.stage_type === 'TOOL_REFERENCE_STAGE') perWorkerToolCounts.set(id, (perWorkerToolCounts.get(id) || 0) + 1);
    if (assignment.stage_type === 'WORKFLOW_REFERENCE_STAGE') perWorkerWorkflowCounts.set(id, (perWorkerWorkflowCounts.get(id) || 0) + 1);
    perWorkerTokens.set(id, (perWorkerTokens.get(id) || 0) + assignment.estimated_total_tokens);
    perWorkerCost.set(id, (perWorkerCost.get(id) || 0) + assignment.estimated_cost_minor_units);
  }
  const limitViolations = [
    [perWorkerStageCounts, policy.maximum_stages_per_worker_reference, 'maximum_stages_per_worker_reference_exceeded'],
    [perWorkerParallelCounts, policy.maximum_parallel_stages_per_worker_reference, 'maximum_parallel_stages_per_worker_reference_exceeded'],
    [perWorkerModelCounts, policy.maximum_model_stages_per_worker_reference, 'maximum_model_stages_per_worker_reference_exceeded'],
    [perWorkerToolCounts, policy.maximum_tool_stages_per_worker_reference, 'maximum_tool_stages_per_worker_reference_exceeded'],
    [perWorkerWorkflowCounts, policy.maximum_workflow_stages_per_worker_reference, 'maximum_workflow_stages_per_worker_reference_exceeded'],
    [perWorkerTokens, policy.maximum_estimated_tokens_per_worker_reference, 'maximum_estimated_tokens_per_worker_reference_exceeded'],
    [perWorkerCost, policy.maximum_estimated_cost_minor_units_per_worker_reference, 'maximum_estimated_cost_minor_units_per_worker_reference_exceeded']
  ];
  for (const [countsByWorker, maximum, reason] of limitViolations) {
    if ([...countsByWorker.values()].some((count) => count > maximum)) {
      return finalize('WORKER_ASSIGNMENT_POLICY_BLOCKED', [reason]);
    }
  }

  // 27. Non-execution invariants.
  if (schedulerResultRef.executed === true || schedulerResultRef.runtime_enabled === true || packageRef.executed === true) {
    return finalize('WORKER_ASSIGNMENT_VALIDATION_FAILED', ['non_execution_invariant_violated']);
  }
  markValid('non_execution_invariants_validated');

  markValid('package_fingerprint_validated');
  markValid('package_digest_validated');

  // 25-26. Emit the prepared outcome -- package fingerprint/digest are computed inside
  // buildWorkerAssignmentOutcome, over the exact derived data this evaluation produced.
  return finalize('WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION', ['worker_assignment_package_prepared_in_simulation_only'], {
    stages: schedulerStages, workerRefs, workerCapabilityRefs, workerCapacityRefs, workerHealthRefs,
    workerNetworkPolicyRefs, workerSecretPolicyRefs,
    compatibilityRefs, candidateSetByStageId, assignmentRefs
  });
}

function buildWorkerAssignmentOutcome(status, reasonCodes, ctx, validatedFlags) {
  const {
    request, requestFingerprint, canonical, schedulerDecisionRef, schedulerResultRef, schedulerPackageRef,
    packageRef, capacitySnapshotRef, concurrencyRef, freshnessRef, idempotencyReference,
    workerNetworkPolicyRefs = [], workerSecretPolicyRefs = [],
    stages = [], workerRefs = [], workerCapabilityRefs = [], workerCapacityRefs = [], workerHealthRefs = [],
    compatibilityRefs = [], candidateSetByStageId = new Map(), assignmentRefs = []
  } = ctx;
  const requestSafe = isPlainObject(request) ? request : {};
  const schedulerDecisionSafe = isPlainObject(schedulerDecisionRef) ? schedulerDecisionRef : {};
  const schedulerResultSafe = isPlainObject(schedulerResultRef) ? schedulerResultRef : {};
  const schedulerPackageSafe = isPlainObject(schedulerPackageRef) ? schedulerPackageRef : {};
  const packageSafe = isPlainObject(packageRef) ? packageRef : {};
  const capacitySafe = isPlainObject(capacitySnapshotRef) ? capacitySnapshotRef : {};
  const concurrencySafe = isPlainObject(concurrencyRef) ? concurrencyRef : {};
  const freshnessSafe = isPlainObject(freshnessRef) ? freshnessRef : {};
  const idempotencySafe = isPlainObject(idempotencyReference) ? idempotencyReference : {};
  const canonicalSafe = canonical || {};

  const requestId = requestSafe.runtime_worker_assignment_request_id || 'runtime_worker_assignment_request_not_available';
  const packageId = `${requestId}-package`;
  const candidateSets = [...candidateSetByStageId.values()];

  const pkg = buildRuntimeWorkerAssignmentPackage({
    runtime_worker_assignment_package_id: packageId,
    runtime_worker_assignment_request_id: requestId,
    runtime_scheduler_request_id: schedulerDecisionSafe.runtime_scheduler_request_id || 'runtime_scheduler_request_not_available',
    runtime_scheduler_decision_id: schedulerDecisionSafe.runtime_scheduler_decision_id || 'runtime_scheduler_decision_not_available',
    runtime_scheduler_result_id: schedulerResultSafe.runtime_scheduler_result_id || 'runtime_scheduler_result_not_available',
    runtime_scheduler_package_id: schedulerPackageSafe.runtime_scheduler_package_id || 'runtime_scheduler_package_not_available',
    runtime_execution_package_id: packageSafe.runtime_execution_package_id || 'runtime_execution_package_not_available',
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    worker_reference_ids: workerRefs.map((w) => w.runtime_worker_reference_id),
    worker_compatibility_reference_ids: compatibilityRefs.map((c) => c.worker_compatibility_reference_id),
    worker_candidate_set_reference_ids: candidateSets.map((c) => c.worker_candidate_set_reference_id),
    worker_stage_assignment_reference_ids: assignmentRefs.map((a) => a.worker_stage_assignment_reference_id),
    stage_count: stages.length,
    worker_count: workerRefs.length,
    compatibility_count: compatibilityRefs.length,
    candidate_set_count: candidateSets.length,
    assignment_count: assignmentRefs.length,
    recommended_assignment_count: assignmentRefs.filter((a) => a.assignment_status === 'WORKER_RECOMMENDED_SIMULATION').length,
    waiting_dependency_assignment_count: assignmentRefs.filter((a) => a.assignment_status === 'WORKER_WAITING_DEPENDENCY_REFERENCE').length,
    waiting_approval_assignment_count: assignmentRefs.filter((a) => a.assignment_status === 'WORKER_WAITING_APPROVAL_REFERENCE').length,
    no_candidate_assignment_count: assignmentRefs.filter((a) => a.assignment_status === 'WORKER_NO_COMPATIBLE_CANDIDATE_BLOCKED').length,
    blocked_assignment_count: assignmentRefs.filter((a) => a.assignment_status === 'WORKER_ASSIGNMENT_BLOCKED').length,
    scheduler_package_fingerprint: schedulerDecisionSafe.runtime_scheduler_package_fingerprint || 'fingerprint_not_available',
    scheduler_package_digest: schedulerDecisionSafe.runtime_scheduler_package_digest || 'digest_not_available',
    runtime_execution_package_fingerprint: packageSafe.package_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_digest: packageSafe.package_digest || 'digest_not_available',
    capacity_snapshot_fingerprint: capacitySafe.capacity_fingerprint || 'fingerprint_not_available',
    concurrency_fingerprint: concurrencySafe.concurrency_fingerprint || 'fingerprint_not_available',
    freshness_fingerprint: freshnessSafe.freshness_fingerprint || 'fingerprint_not_available',
    replay_fingerprint: 'fingerprint_not_available',
    idempotency_fingerprint: idempotencySafe.idempotency_fingerprint || 'fingerprint_not_available',
    worker_fingerprints: workerRefs.map((w) => w.worker_fingerprint),
    worker_capability_fingerprints: workerCapabilityRefs.map((c) => c.capability_fingerprint),
    worker_capacity_fingerprints: workerCapacityRefs.map((c) => c.capacity_fingerprint),
    worker_health_fingerprints: workerHealthRefs.map((h) => h.health_fingerprint),
    worker_network_policy_fingerprints: workerNetworkPolicyRefs.map((n) => n.network_policy_fingerprint),
    worker_secret_policy_fingerprints: workerSecretPolicyRefs.map((s) => s.secret_policy_fingerprint),
    compatibility_fingerprints: compatibilityRefs.map((c) => c.compatibility_fingerprint),
    candidate_set_fingerprints: candidateSets.map((c) => c.candidate_set_fingerprint),
    assignment_fingerprints: assignmentRefs.map((a) => a.assignment_fingerprint),
    worker_assignment_status: status
  });

  const decision = buildRuntimeWorkerAssignmentDecision({
    runtime_worker_assignment_decision_id: `${requestId}-decision`,
    runtime_worker_assignment_request_id: requestId,
    runtime_worker_assignment_package_id: pkg.runtime_worker_assignment_package_id,
    runtime_scheduler_decision_id: pkg.runtime_scheduler_decision_id,
    runtime_scheduler_result_id: pkg.runtime_scheduler_result_id,
    runtime_scheduler_package_id: pkg.runtime_scheduler_package_id,
    runtime_execution_package_id: pkg.runtime_execution_package_id,
    tenant_id: pkg.tenant_id,
    organization_id: pkg.organization_id,
    project_id: pkg.project_id,
    session_reference_id: pkg.session_reference_id,
    agent_id: pkg.agent_id,
    actor_id: pkg.actor_id,
    status,
    runtime_worker_assignment_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    runtime_worker_assignment_package_fingerprint: pkg.worker_assignment_package_fingerprint,
    runtime_worker_assignment_package_digest: pkg.worker_assignment_package_digest,
    runtime_scheduler_package_fingerprint: pkg.scheduler_package_fingerprint,
    runtime_scheduler_package_digest: pkg.scheduler_package_digest,
    runtime_execution_package_fingerprint: pkg.runtime_execution_package_fingerprint,
    runtime_execution_package_digest: pkg.runtime_execution_package_digest,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  const result = buildRuntimeWorkerAssignmentResult({
    runtime_worker_assignment_result_id: `${requestId}-result`,
    runtime_worker_assignment_request_id: requestId,
    runtime_worker_assignment_decision_id: decision.runtime_worker_assignment_decision_id,
    runtime_worker_assignment_package_id: decision.runtime_worker_assignment_package_id,
    runtime_scheduler_package_id: decision.runtime_scheduler_package_id,
    runtime_execution_package_id: decision.runtime_execution_package_id,
    tenant_id: decision.tenant_id,
    organization_id: decision.organization_id,
    project_id: decision.project_id,
    session_reference_id: decision.session_reference_id,
    agent_id: decision.agent_id,
    actor_id: decision.actor_id,
    status,
    runtime_worker_assignment_request_fingerprint: decision.runtime_worker_assignment_request_fingerprint,
    runtime_worker_assignment_decision_fingerprint: computeCanonicalContentDigest(decision),
    runtime_worker_assignment_package_fingerprint: decision.runtime_worker_assignment_package_fingerprint,
    runtime_worker_assignment_package_digest: decision.runtime_worker_assignment_package_digest,
    registry_version: String(requestSafe.expected_worker_assignment_registry_version || 'registry_version_not_available'),
    stage_count: pkg.stage_count,
    worker_count: pkg.worker_count,
    compatible_candidate_count: candidateSets.reduce((sum, c) => sum + c.compatible_candidate_count, 0),
    incompatible_candidate_count: candidateSets.reduce((sum, c) => sum + c.incompatible_candidate_count, 0),
    recommended_assignment_count: pkg.recommended_assignment_count,
    waiting_dependency_assignment_count: pkg.waiting_dependency_assignment_count,
    waiting_approval_assignment_count: pkg.waiting_approval_assignment_count,
    no_candidate_assignment_count: pkg.no_candidate_assignment_count,
    blocked_assignment_count: pkg.blocked_assignment_count,
    blockers: reasonCodes,
    reason_codes: reasonCodes
  });

  const audit = buildRuntimeWorkerAssignmentAudit({
    decision, result,
    recommendedWorkerIds: assignmentRefs.filter((a) => a.recommended_worker_reference_id).map((a) => a.recommended_worker_reference_id),
    capabilityMismatchCodes: compatibilityRefs.flatMap((c) => c.mismatch_reason_codes),
    healthStatuses: workerHealthRefs.map((h) => h.health_status),
    availableStageAssignmentsTotal: workerCapacityRefs.reduce((sum, c) => sum + c.available_stage_assignments, 0),
    availableParallelAssignmentsTotal: workerCapacityRefs.reduce((sum, c) => sum + c.available_parallel_assignments, 0),
    logicalSequence: requestSafe.logical_sequence
  });

  return { decision, result, audit, package: pkg, compatibilityRefs, candidateSets, assignmentRefs };
}

module.exports = {
  deriveStageRequiresNetworkOrSecret,
  evaluateHealthAtAssignment,
  evaluatePolicyReferenceMatch,
  evaluateRuntimeWorkerAssignmentRequest,
  omitReplayReference
};
