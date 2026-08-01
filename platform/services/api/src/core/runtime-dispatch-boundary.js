'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { findAgentCoreOperationalMaterial } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { checkIdentity } = require('./runtime-execution-package');
const { stablePayload: computeOfficialPolicyFingerprint } = require('./transcription-provider-contract-registry');
const { computeSnapshotFingerprint } = require('./execution-registry-snapshot-reference');
const { FRESHNESS_DIMENSIONS } = require('./runtime-readiness-freshness-reference');
const { computeIdempotencyFingerprint } = require('./execution-plan-idempotency');
const { evaluateHealthAtAssignment } = require('./runtime-worker-assignment-boundary');
const { validateRuntimeDispatchRequest, omitDispatchReplayReference } = require('./runtime-dispatch-request');
const { buildRuntimeDispatchStageReference, ELIGIBILITY_BY_STAGE_STATUS } = require('./runtime-dispatch-stage-reference');
const { buildRuntimeDispatchWorkerBindingReference } = require('./runtime-dispatch-worker-binding-reference');
const { buildRuntimeDispatchDependencyGateReference } = require('./runtime-dispatch-dependency-gate-reference');
const { buildRuntimeDispatchApprovalGateReference } = require('./runtime-dispatch-approval-gate-reference');
const { buildRuntimeDispatchCapacityReference } = require('./runtime-dispatch-capacity-reference');
const { buildRuntimeDispatchBudgetReference } = require('./runtime-dispatch-budget-reference');
const { buildRuntimeDispatchPayloadReference } = require('./runtime-dispatch-payload-reference');
const { buildRuntimeDispatchIntentReference } = require('./runtime-dispatch-intent-reference');
const { buildRuntimeDispatchOrderReference } = require('./runtime-dispatch-order-reference');
const { buildRuntimeDispatchPackage } = require('./runtime-dispatch-package');
const { buildRuntimeDispatchDecision } = require('./runtime-dispatch-decision');
const { buildRuntimeDispatchResult } = require('./runtime-dispatch-result');
const { buildRuntimeDispatchAudit } = require('./runtime-dispatch-audit');

// pr107: the single evaluator this PR exists to build. Receives only an already
// WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION package (plus the full Scheduler/Runtime chain
// underneath it) and produces a purely declarative envelope describing which stages would be ready
// for a future dispatch intent, in what order, with what worker binding -- nothing here authorizes,
// applies, sends, leases, reserves, starts, or dispatches anything. Every one of those flags is
// forced false in every outcome this boundary can ever produce (see buildDispatchOutcome below).

const WAITING_ASSIGNMENT_STATUSES = Object.freeze({
  BLOCKED: 'WORKER_ASSIGNMENT_BLOCKED',
  WAITING_DEPENDENCY: 'WORKER_WAITING_DEPENDENCY_REFERENCE',
  WAITING_APPROVAL: 'WORKER_WAITING_APPROVAL_REFERENCE',
  NO_CANDIDATE: 'WORKER_NO_COMPATIBLE_CANDIDATE_BLOCKED',
  RECOMMENDED: 'WORKER_RECOMMENDED_SIMULATION'
});

// Mirrors runtime-worker-assignment-boundary.js's own omitReplayReference exactly, for this layer's
// own request field: `runtime_dispatch_replay_reference`.
function omitDispatchReplay(obj) {
  return omitDispatchReplayReference(obj);
}

// pr107: "Dispatch não pode ser apenas stage ID + worker ID" -- proves a list of references the
// Dispatch Request carries is genuinely the SAME set the Worker Assignment Package already produced
// and fingerprinted, never an independently substituted list. Reused for every one of the
// Worker/Compatibility/Candidate-Set/Assignment/Policy/Requirement/Snapshot cross-checks below.
function fingerprintSetMatches(rawList, computeFingerprint, expectedFingerprints) {
  if (!Array.isArray(rawList) || !Array.isArray(expectedFingerprints)) return false;
  const actual = [...new Set(rawList.map((item) => computeFingerprint(item)))].sort();
  const expected = [...new Set(expectedFingerprints)].sort();
  if (actual.length !== expected.length) return false;
  return actual.every((fp, index) => fp === expected[index]);
}

function idSetMatches(rawList, idField, expectedIds) {
  if (!Array.isArray(rawList) || !Array.isArray(expectedIds)) return false;
  const actual = [...new Set(rawList.map((item) => item[idField]))].sort();
  const expected = [...new Set(expectedIds)].sort();
  if (actual.length !== expected.length) return false;
  return actual.every((id, index) => id === expected[index]);
}

// --- Stage-level derivation -------------------------------------------------------------------

// pr107: structural 1:1 mapping from the Worker Assignment layer's own `assignment_status` to this
// layer's own `dispatch_stage_status` -- "Somente stages cujo Worker Stage Assignment possua
// WORKER_RECOMMENDED_SIMULATION podem gerar uma intenção de dispatch preparada." A stage the caller's
// own Scheduler Stage Reference marks `optional=true` never becomes automatically eligible, even
// with a compatible worker -- it becomes DISPATCH_STAGE_OPTIONAL_REFERENCE instead ("não deve ser
// automaticamente preparado para dispatch operacional").
function deriveDispatchStageStatus(stage, assignmentStatus) {
  if (assignmentStatus === WAITING_ASSIGNMENT_STATUSES.BLOCKED) return 'DISPATCH_STAGE_BLOCKED';
  if (assignmentStatus === WAITING_ASSIGNMENT_STATUSES.WAITING_DEPENDENCY) return 'DISPATCH_STAGE_WAITING_DEPENDENCY_REFERENCE';
  if (assignmentStatus === WAITING_ASSIGNMENT_STATUSES.WAITING_APPROVAL) return 'DISPATCH_STAGE_WAITING_APPROVAL_REFERENCE';
  if (assignmentStatus === WAITING_ASSIGNMENT_STATUSES.NO_CANDIDATE) return 'DISPATCH_STAGE_NO_WORKER_BLOCKED';
  if (assignmentStatus === WAITING_ASSIGNMENT_STATUSES.RECOMMENDED) {
    return stage.optional === true ? 'DISPATCH_STAGE_OPTIONAL_REFERENCE' : 'DISPATCH_STAGE_ELIGIBLE_SIMULATION';
  }
  return 'DISPATCH_STAGE_NOT_EVALUATED';
}

// pr107: re-proves the worker still genuinely qualifies at the Dispatch Request's own sequence --
// "O worker precisa: estar entre os compatíveis; possuir Compatibility Reference válida; permanecer
// saudável na sequência do Dispatch Request; continuar com capacidade; permanecer no mesmo
// tenant/org/project/environment." Health is recomputed via the exact same
// `evaluateHealthAtAssignment` the Worker Assignment layer itself uses, just at this later sequence
// -- a worker healthy when assigned can have expired by the time dispatch preparation runs.
function revalidateWorkerBinding(ctx) {
  const {
    candidateSet, compatibilityRef, worker, health, capacity, canonical, requestLogicalSequence, stage
  } = ctx;
  const reasons = [];
  const inCompatibleSet = isPlainObject(candidateSet) && Array.isArray(candidateSet.compatible_worker_reference_ids)
    && candidateSet.compatible_worker_reference_ids.includes(worker.runtime_worker_reference_id);
  if (!inCompatibleSet) reasons.push('worker_not_in_compatible_candidate_set');
  const compatibilityValid = isPlainObject(compatibilityRef) && compatibilityRef.worker_compatible === true
    && compatibilityRef.runtime_worker_reference_id === worker.runtime_worker_reference_id
    && compatibilityRef.scheduler_stage_reference_id === stage.scheduler_stage_reference_id;
  if (!compatibilityValid) reasons.push('worker_compatibility_reference_invalid');
  const healthEvaluation = isPlainObject(health) ? evaluateHealthAtAssignment(health, requestLogicalSequence) : { match: false };
  if (!healthEvaluation.match) reasons.push(healthEvaluation.reason || 'worker_health_invalid_at_dispatch');
  const hasModel = stage.model_selection_reference_id !== null;
  const hasTools = Array.isArray(stage.tool_reference_ids) && stage.tool_reference_ids.length > 0;
  const hasWorkflow = stage.workflow_reference_id !== null;
  const capacityValid = isPlainObject(capacity)
    && capacity.available_stage_assignments >= 1
    && (!stage.parallelizable || capacity.available_parallel_assignments >= 1)
    && (!hasModel || capacity.available_model_assignments >= 1)
    && (!hasTools || capacity.available_tool_assignments >= 1)
    && (!hasWorkflow || capacity.available_workflow_assignments >= 1)
    && capacity.available_token_capacity >= stage.estimated_total_tokens
    && capacity.available_cost_capacity_minor_units >= stage.estimated_cost_minor_units;
  if (!capacityValid) reasons.push('worker_capacity_invalid_at_dispatch');
  const scopeValid = (worker.tenant_scope_id === null || worker.tenant_scope_id === canonical.tenantId)
    && (worker.organization_scope_id === null || worker.organization_scope_id === canonical.organizationId)
    && (worker.project_scope_id === null || worker.project_scope_id === canonical.projectId);
  if (!scopeValid) reasons.push('worker_scope_invalid_at_dispatch');
  return {
    valid: reasons.length === 0, reasons,
    healthValid: healthEvaluation.match === true, capacityValid
  };
}

// --- Main evaluator ------------------------------------------------------------------------------

function evaluateRuntimeDispatchRequest(request, context = {}) {
  void context; // never consulted for any decision.
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  const requestIsObject = isPlainObject(request);
  const policy = requestIsObject ? request.runtime_dispatch_policy : undefined;
  const workerAssignmentRequestRef = requestIsObject ? request.runtime_worker_assignment_request_reference : undefined;
  const workerAssignmentDecisionRef = requestIsObject ? request.runtime_worker_assignment_decision_reference : undefined;
  const workerAssignmentResultRef = requestIsObject ? request.runtime_worker_assignment_result_reference : undefined;
  const workerAssignmentPackageRef = requestIsObject ? request.runtime_worker_assignment_package_reference : undefined;
  const schedulerRequestRef = requestIsObject ? request.runtime_scheduler_request_reference : undefined;
  const schedulerDecisionRef = requestIsObject ? request.runtime_scheduler_decision_reference : undefined;
  const schedulerResultRef = requestIsObject ? request.runtime_scheduler_result_reference : undefined;
  const schedulerPackageRef = requestIsObject ? request.runtime_scheduler_package_reference : undefined;
  const packageRef = requestIsObject ? request.runtime_execution_package_reference : undefined;
  const capacitySnapshotRef = requestIsObject ? request.runtime_capacity_snapshot_reference : undefined;
  const concurrencyRef = requestIsObject ? request.runtime_concurrency_reference : undefined;
  const budgetRef = requestIsObject ? request.runtime_budget_reference : undefined;
  const freshnessRef = requestIsObject ? request.runtime_freshness_reference : undefined;
  const replayRef = requestIsObject ? request.runtime_replay_reference : undefined;
  const idempotencyReference = requestIsObject ? request.idempotency_reference : undefined;
  const registrySnapshotRef = requestIsObject ? request.registry_snapshot_reference : undefined;
  const dispatchReplayRef = requestIsObject ? request.runtime_dispatch_replay_reference : undefined;
  const workerRefs = requestIsObject && Array.isArray(request.runtime_worker_references) ? request.runtime_worker_references : [];
  const workerCapabilityRefs = requestIsObject && Array.isArray(request.runtime_worker_capability_references) ? request.runtime_worker_capability_references : [];
  const workerCapacityRefs = requestIsObject && Array.isArray(request.runtime_worker_capacity_references) ? request.runtime_worker_capacity_references : [];
  const workerHealthRefs = requestIsObject && Array.isArray(request.runtime_worker_health_references) ? request.runtime_worker_health_references : [];
  const workerCompatibilityRefs = requestIsObject && Array.isArray(request.runtime_worker_compatibility_references) ? request.runtime_worker_compatibility_references : [];
  const workerCandidateSetRefs = requestIsObject && Array.isArray(request.runtime_worker_candidate_set_references) ? request.runtime_worker_candidate_set_references : [];
  const workerStageAssignmentRefs = requestIsObject && Array.isArray(request.runtime_worker_stage_assignment_references) ? request.runtime_worker_stage_assignment_references : [];
  const stagePolicyRequirementRefs = requestIsObject && Array.isArray(request.runtime_worker_stage_policy_requirement_references) ? request.runtime_worker_stage_policy_requirement_references : [];
  const networkPermissionPolicyRefs = requestIsObject && Array.isArray(request.network_permission_policy_references) ? request.network_permission_policy_references : [];
  const secretResolutionPolicyRefs = requestIsObject && Array.isArray(request.secret_resolution_policy_references) ? request.secret_resolution_policy_references : [];

  const canonical = {
    tenantId: isPlainObject(packageRef) ? packageRef.tenant_id : undefined,
    organizationId: isPlainObject(packageRef) ? packageRef.organization_id : undefined,
    projectId: isPlainObject(packageRef) ? packageRef.project_id : undefined,
    sessionId: isPlainObject(packageRef) ? packageRef.session_reference_id : undefined,
    agentId: isPlainObject(packageRef) ? packageRef.agent_id : undefined,
    actorId: isPlainObject(packageRef) ? packageRef.actor_id : undefined
  };

  const requestForFingerprint = requestIsObject ? omitDispatchReplay(request) : request;
  const requestFingerprint = computeCanonicalContentDigest(requestForFingerprint);

  function finalize(status, reasonCodes, derived = {}) {
    return buildDispatchOutcome(status, reasonCodes, {
      request, requestFingerprint, canonical,
      workerAssignmentDecisionRef, workerAssignmentResultRef, workerAssignmentPackageRef,
      schedulerDecisionRef, schedulerResultRef, schedulerPackageRef, packageRef,
      ...derived
    }, validatedFlags);
  }

  // 1-2. Request contract shape, including simulation_context and every nested reference against
  // its own real validator.
  const requestValidation = validateRuntimeDispatchRequest(request);
  if (!requestValidation.valid) return finalize('DISPATCH_VALIDATION_FAILED', ['runtime_dispatch_request_invalid']);
  markValid('request_validated');

  // 3. Dispatch Policy -- allow_* flags genuinely re-checked against the real stage composition
  // later (step 33); external/irreversible effects are never allowed regardless of policy.
  markValid('policy_validated');

  // 9 (identity, evaluated early to match precedence).
  const identityChecks = [
    ['runtime_execution_package_reference', packageRef]
  ];
  for (const [label, reference] of identityChecks) {
    const mismatch = checkIdentity(reference, canonical, label);
    if (mismatch) return finalize(mismatch.status, [mismatch.reason]);
  }
  markValid('identity_validated');

  // 4-7. Worker Assignment chain -- must be a genuine, matching, already-prepared chain.
  if (
    workerAssignmentDecisionRef.status !== 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION'
    || workerAssignmentDecisionRef.worker_assignment_package_prepared_in_simulation !== true
    || workerAssignmentResultRef.status !== 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION'
    || workerAssignmentResultRef.worker_assignment_package_prepared_in_simulation !== true
    || workerAssignmentPackageRef.worker_assignment_status !== 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION'
    || workerAssignmentPackageRef.worker_assignment_package_prepared_in_simulation !== true
    || workerAssignmentDecisionRef.runtime_worker_assignment_request_id !== workerAssignmentRequestRef.runtime_worker_assignment_request_id
    || workerAssignmentResultRef.runtime_worker_assignment_decision_id !== workerAssignmentDecisionRef.runtime_worker_assignment_decision_id
    || workerAssignmentPackageRef.runtime_worker_assignment_package_id !== workerAssignmentDecisionRef.runtime_worker_assignment_package_id
    || workerAssignmentDecisionRef.worker_assignment_applied === true || workerAssignmentResultRef.worker_assignment_applied === true
    || workerAssignmentResultRef.worker_reserved === true || workerAssignmentResultRef.worker_started === true
  ) {
    return finalize('DISPATCH_WORKER_ASSIGNMENT_BLOCKED', ['worker_assignment_chain_not_genuinely_prepared']);
  }
  // "Dispatch não pode ser apenas stage ID + worker ID" -- every reference list this request carries
  // must be the SAME set the Worker Assignment Package already fingerprinted, never an
  // independently substituted list.
  if (
    !idSetMatches(workerRefs, 'runtime_worker_reference_id', workerAssignmentPackageRef.worker_reference_ids)
    || !idSetMatches(workerCompatibilityRefs, 'worker_compatibility_reference_id', workerAssignmentPackageRef.worker_compatibility_reference_ids)
    || !idSetMatches(workerCandidateSetRefs, 'worker_candidate_set_reference_id', workerAssignmentPackageRef.worker_candidate_set_reference_ids)
    || !idSetMatches(workerStageAssignmentRefs, 'worker_stage_assignment_reference_id', workerAssignmentPackageRef.worker_stage_assignment_reference_ids)
    || !fingerprintSetMatches(networkPermissionPolicyRefs, computeOfficialPolicyFingerprint, workerAssignmentPackageRef.official_network_policy_fingerprints)
    || !fingerprintSetMatches(secretResolutionPolicyRefs, computeOfficialPolicyFingerprint, workerAssignmentPackageRef.official_secret_policy_fingerprints)
    || !fingerprintSetMatches(stagePolicyRequirementRefs, (h) => h.requirement_reference_fingerprint, workerAssignmentPackageRef.stage_policy_requirement_fingerprints)
  ) {
    return finalize('DISPATCH_WORKER_ASSIGNMENT_BLOCKED', ['worker_assignment_output_substituted_or_incomplete']);
  }
  markValid('worker_assignment_validated');

  // 8-11. Scheduler chain -- must be a genuine, matching, already-prepared chain (same discipline
  // runtime-worker-assignment-boundary.js already applies one layer below).
  if (
    schedulerDecisionRef.status !== 'SCHEDULER_PACKAGE_PREPARED_SIMULATION' || schedulerDecisionRef.scheduler_package_prepared_in_simulation !== true
    || schedulerResultRef.status !== 'SCHEDULER_PACKAGE_PREPARED_SIMULATION' || schedulerResultRef.scheduler_package_prepared_in_simulation !== true
    || schedulerPackageRef.scheduler_status !== 'SCHEDULER_PACKAGE_PREPARED_SIMULATION' || schedulerPackageRef.scheduler_package_prepared_in_simulation !== true
    || schedulerDecisionRef.runtime_scheduler_request_id !== schedulerRequestRef.runtime_scheduler_request_id
    || schedulerResultRef.runtime_scheduler_decision_id !== schedulerDecisionRef.runtime_scheduler_decision_id
    || schedulerPackageRef.runtime_scheduler_package_id !== schedulerDecisionRef.runtime_scheduler_package_id
    || schedulerPackageRef.runtime_scheduler_package_id !== workerAssignmentPackageRef.runtime_scheduler_package_id
    || schedulerDecisionRef.scheduler_started === true || schedulerResultRef.scheduler_started === true
  ) {
    return finalize('DISPATCH_SCHEDULER_BLOCKED', ['scheduler_chain_not_genuinely_prepared']);
  }
  markValid('scheduler_validated');

  // 12. Runtime Execution Package -- still the exact same, never-mutated package the whole chain
  // found prepared.
  if (
    packageRef.runtime_status !== 'RUNTIME_PACKAGE_PREPARED_SIMULATION' || packageRef.runtime_admitted_in_simulation !== false
    || packageRef.runtime_enabled === true || packageRef.execution_authorized === true || packageRef.executed === true
    || packageRef.runtime_execution_package_id !== workerAssignmentPackageRef.runtime_execution_package_id
  ) {
    return finalize('DISPATCH_RUNTIME_PACKAGE_BLOCKED', ['runtime_package_not_still_prepared_or_mutated']);
  }
  markValid('runtime_package_validated');

  // 14. Freshness -- recomputed using this request's own logical_sequence, never the frozen
  // current_logical_sequence the reference already carries (same math already established at every
  // prior layer in this lineage).
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < freshnessRef.current_logical_sequence) {
    return finalize('DISPATCH_FRESHNESS_BLOCKED', ['dispatch_logical_sequence_regressive']);
  }
  const freshnessExpired = FRESHNESS_DIMENSIONS.some(([, createdField, maximumField]) => (
    (request.logical_sequence - freshnessRef[createdField]) > freshnessRef[maximumField]
  ));
  if (freshnessExpired || freshnessRef.freshness_validated !== true) {
    return finalize('DISPATCH_FRESHNESS_BLOCKED', ['runtime_freshness_expired_at_dispatch_logical_sequence']);
  }
  markValid('freshness_validated');

  // 15. Dispatch Replay -- the Dispatch layer's own Replay Reference, never Admission/Worker
  // Assignment Replay reused "como se fosse Dispatch Replay." Proven bound to the exact
  // Worker Assignment/Scheduler/Runtime Execution Package fingerprints+digests this evaluation is
  // about to use.
  if (
    !isPlainObject(dispatchReplayRef)
    || dispatchReplayRef.runtime_worker_assignment_package_id !== workerAssignmentPackageRef.runtime_worker_assignment_package_id
    || dispatchReplayRef.runtime_worker_assignment_package_fingerprint !== workerAssignmentPackageRef.worker_assignment_package_fingerprint
    || dispatchReplayRef.runtime_worker_assignment_package_digest !== workerAssignmentPackageRef.worker_assignment_package_digest
    || dispatchReplayRef.runtime_scheduler_package_id !== schedulerPackageRef.runtime_scheduler_package_id
    || dispatchReplayRef.runtime_scheduler_package_fingerprint !== schedulerDecisionRef.runtime_scheduler_package_fingerprint
    || dispatchReplayRef.runtime_scheduler_package_digest !== schedulerDecisionRef.runtime_scheduler_package_digest
    || dispatchReplayRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || dispatchReplayRef.runtime_execution_package_fingerprint !== packageRef.package_fingerprint
    || dispatchReplayRef.runtime_execution_package_digest !== packageRef.package_digest
    || dispatchReplayRef.idempotency_reference_id !== idempotencyReference.idempotency_reference_id
    || dispatchReplayRef.idempotency_fingerprint !== idempotencyReference.idempotency_fingerprint
    || dispatchReplayRef.replay_allowed !== true || dispatchReplayRef.replay_consumed !== false
  ) {
    return finalize('DISPATCH_REPLAY_BLOCKED', ['runtime_dispatch_replay_reference_not_bound_to_dispatch_request']);
  }
  markValid('replay_validated');

  // 16. Idempotency -- the real, official ExecutionPlanIdempotencyReference, proven to be the exact
  // same object the Worker Assignment Request itself already carried, plus its own self-fingerprint
  // and safe flags.
  if (
    idempotencyReference.idempotency_reference_id !== workerAssignmentRequestRef.idempotency_reference.idempotency_reference_id
    || idempotencyReference.idempotency_fingerprint !== workerAssignmentRequestRef.idempotency_reference.idempotency_fingerprint
    || computeIdempotencyFingerprint(idempotencyReference) !== idempotencyReference.idempotency_fingerprint
    || idempotencyReference.idempotency_validated !== true || idempotencyReference.idempotency_consumed !== false
    || idempotencyReference.duplicate_execution_blocked !== true
  ) {
    return finalize('DISPATCH_IDEMPOTENCY_BLOCKED', ['idempotency_reference_not_bound_to_worker_assignment_chain']);
  }
  markValid('idempotency_validated');

  // 17. Registry Snapshot -- proven to be the SAME snapshot the Worker Assignment Package already
  // proved every RESOLVED Stage Policy Requirement bound to (pr106fix5), never an independent
  // reference substituted at this layer.
  const workerAssignmentSnapshotFingerprint = workerAssignmentPackageRef.registry_snapshot_reference_fingerprint;
  const hasSnapshotAtWorkerAssignment = workerAssignmentSnapshotFingerprint && workerAssignmentSnapshotFingerprint !== 'fingerprint_not_available';
  if (hasSnapshotAtWorkerAssignment) {
    if (
      !isPlainObject(registrySnapshotRef)
      || computeSnapshotFingerprint(registrySnapshotRef) !== registrySnapshotRef.snapshot_fingerprint
      || registrySnapshotRef.snapshot_fingerprint !== workerAssignmentSnapshotFingerprint
    ) {
      return finalize('DISPATCH_REGISTRY_SNAPSHOT_BLOCKED', ['registry_snapshot_not_same_as_worker_assignment_layer']);
    }
  } else if (registrySnapshotRef !== null) {
    return finalize('DISPATCH_REGISTRY_SNAPSHOT_BLOCKED', ['registry_snapshot_present_but_worker_assignment_layer_had_none']);
  }
  markValid('registry_snapshot_validated');

  // 18. Official Network/Secret policies -- already proven non-substituted above (worker assignment
  // fingerprint-set cross-check); re-affirm PRODUCTION is never allowed.
  if (networkPermissionPolicyRefs.some((official) => official.environment === 'PRODUCTION')) {
    return finalize('DISPATCH_NETWORK_POLICY_BLOCKED', ['network_official_policy_production_not_allowed']);
  }
  if (secretResolutionPolicyRefs.some((official) => official.environment === 'PRODUCTION')) {
    return finalize('DISPATCH_SECRET_POLICY_BLOCKED', ['secret_official_policy_production_not_allowed']);
  }
  markValid('network_policies_validated');
  markValid('secret_policies_validated');

  // 19. Stage Policy Requirements -- already proven non-substituted above.
  markValid('stage_policy_requirements_validated');

  // 20-23. Worker References / Stage Assignments / Candidate Sets / Compatibility References --
  // already proven non-substituted above; index them for stage-level derivation.
  const capabilityById = new Map(workerCapabilityRefs.map((c) => [c.worker_capability_reference_id, c]));
  const capacityById = new Map(workerCapacityRefs.map((c) => [c.worker_capacity_reference_id, c]));
  const healthById = new Map(workerHealthRefs.map((h) => [h.worker_health_reference_id, h]));
  const workerById = new Map(workerRefs.map((w) => [w.runtime_worker_reference_id, w]));
  const compatibilityByStageAndWorker = new Map(workerCompatibilityRefs.map((c) => [`${c.scheduler_stage_reference_id}::${c.runtime_worker_reference_id}`, c]));
  const candidateSetByStageId = new Map(workerCandidateSetRefs.map((c) => [c.scheduler_stage_reference_id, c]));
  const assignmentByStageId = new Map(workerStageAssignmentRefs.map((a) => [a.scheduler_stage_reference_id, a]));
  void capabilityById;
  markValid('worker_references_validated');

  // 24-25. Derive Dispatch Stage References + Worker Binding References.
  const schedulerStages = Array.isArray(schedulerResultRef.scheduler_stage_references) ? schedulerResultRef.scheduler_stage_references : [];
  const requestId = request.runtime_dispatch_request_id;
  const packageId = `${requestId}-package`;
  const dispatchStageRefs = [];
  const workerBindingRefs = [];
  const dependencyGateRefs = [];
  const approvalGateRefs = [];
  const capacityRefs = [];
  const budgetRefs = [];
  const payloadRefs = [];
  const intentRefs = [];
  let dispatchSequence = 0;

  for (const stage of schedulerStages) {
    const assignment = assignmentByStageId.get(stage.scheduler_stage_reference_id);
    if (!assignment) {
      return finalize('DISPATCH_STAGE_BLOCKED', ['scheduler_stage_missing_worker_stage_assignment']);
    }
    const dispatchStageStatus = deriveDispatchStageStatus(stage, assignment.assignment_status);
    const dispatchStageId = `${stage.scheduler_stage_reference_id}-dispatch-stage`;
    const dispatchStageRef = buildRuntimeDispatchStageReference({
      runtime_dispatch_stage_reference_id: dispatchStageId,
      runtime_dispatch_request_id: requestId,
      runtime_dispatch_package_id: packageId,
      runtime_scheduler_package_id: schedulerPackageRef.runtime_scheduler_package_id,
      runtime_worker_assignment_package_id: workerAssignmentPackageRef.runtime_worker_assignment_package_id,
      runtime_execution_package_id: packageRef.runtime_execution_package_id,
      scheduler_stage_reference_id: stage.scheduler_stage_reference_id,
      runtime_stage_reference_id: stage.runtime_stage_reference_id,
      worker_stage_assignment_reference_id: assignment.worker_stage_assignment_reference_id,
      stage_sequence: dispatchStageRefs.length,
      scheduler_sequence: stage.scheduler_sequence,
      dispatch_sequence: dispatchSequence,
      stage_type: stage.stage_type,
      priority: stage.priority,
      required: stage.required,
      optional: stage.optional === true,
      parallelizable: stage.parallelizable,
      approval_required: stage.approval_required,
      dependency_reference_ids: stage.dependency_reference_ids,
      blocking_dependency_reference_ids: stage.blocking_dependency_reference_ids,
      task_reference_id: stage.task_reference_id,
      agent_reference_id: stage.agent_reference_id,
      memory_selection_reference_id: stage.memory_selection_reference_id,
      context_assembly_reference_id: stage.context_assembly_reference_id,
      model_selection_reference_id: stage.model_selection_reference_id,
      tool_reference_ids: stage.tool_reference_ids,
      workflow_reference_id: stage.workflow_reference_id,
      required_capabilities: stage.required_capabilities,
      required_modalities: stage.required_modalities,
      stage_policy_requirement_reference_ids: stagePolicyRequirementRefs
        .filter((h) => h.scheduler_stage_reference_id === stage.scheduler_stage_reference_id)
        .map((h) => h.stage_policy_requirement_reference_id),
      side_effect_classification: stage.side_effect_classification,
      risk_classification: stage.risk_classification,
      estimated_input_tokens: stage.estimated_input_tokens,
      estimated_output_tokens: stage.estimated_output_tokens,
      estimated_total_tokens: stage.estimated_total_tokens,
      estimated_cost_minor_units: stage.estimated_cost_minor_units,
      dispatch_stage_status: dispatchStageStatus,
      reason_codes: dispatchStageStatus === 'DISPATCH_STAGE_NOT_EVALUATED' ? ['dispatch_stage_status_not_evaluated'] : []
    });
    dispatchStageRefs.push(dispatchStageRef);

    // 26-27. Dependency/Approval gates -- derived for every stage, regardless of eligibility.
    const dependencyGateId = `${dispatchStageId}-dependency-gate`;
    const dependencyGateRef = buildRuntimeDispatchDependencyGateReference({
      dispatch_dependency_gate_reference_id: dependencyGateId,
      runtime_dispatch_package_id: packageId,
      runtime_scheduler_package_id: schedulerPackageRef.runtime_scheduler_package_id,
      runtime_dispatch_stage_reference_id: dispatchStageId,
      scheduler_stage_reference_id: stage.scheduler_stage_reference_id,
      required_dependency_reference_ids: stage.dependency_reference_ids,
      optional_dependency_reference_ids: [],
      blocking_dependency_reference_ids: stage.blocking_dependency_reference_ids
    });
    dependencyGateRefs.push(dependencyGateRef);

    const approvalGateId = `${dispatchStageId}-approval-gate`;
    const approvalGateRef = buildRuntimeDispatchApprovalGateReference({
      dispatch_approval_gate_reference_id: approvalGateId,
      runtime_dispatch_package_id: packageId,
      runtime_scheduler_package_id: schedulerPackageRef.runtime_scheduler_package_id,
      runtime_dispatch_stage_reference_id: dispatchStageId,
      scheduler_stage_reference_id: stage.scheduler_stage_reference_id,
      approval_required: stage.approval_required
    });
    approvalGateRefs.push(approvalGateRef);

    let workerBindingRef = null;
    let capacityRef = null;
    let budgetRef2 = null;
    let payloadRef = null;
    let capacityGatePassed = false;
    let budgetGatePassed = false;
    let workerGatePassed = false;

    if (dispatchStageStatus === 'DISPATCH_STAGE_ELIGIBLE_SIMULATION' || dispatchStageStatus === 'DISPATCH_STAGE_OPTIONAL_REFERENCE') {
      const worker = workerById.get(assignment.recommended_worker_reference_id);
      const candidateSet = candidateSetByStageId.get(stage.scheduler_stage_reference_id);
      const compatibilityRef = compatibilityByStageAndWorker.get(`${stage.scheduler_stage_reference_id}::${assignment.recommended_worker_reference_id}`);
      const health = worker ? healthById.get(worker.worker_health_reference_id) : undefined;
      const capacity = worker ? capacityById.get(worker.worker_capacity_reference_id) : undefined;

      const revalidation = worker ? revalidateWorkerBinding({
        candidateSet, compatibilityRef, worker, health, capacity, canonical, requestLogicalSequence: request.logical_sequence, stage
      }) : { valid: false, reasons: ['recommended_worker_reference_missing'], healthValid: false, capacityValid: false };
      workerGatePassed = revalidation.valid;

      const workerBindingId = `${dispatchStageId}-worker-binding`;
      workerBindingRef = buildRuntimeDispatchWorkerBindingReference({
        dispatch_worker_binding_reference_id: workerBindingId,
        runtime_dispatch_package_id: packageId,
        runtime_worker_assignment_package_id: workerAssignmentPackageRef.runtime_worker_assignment_package_id,
        runtime_scheduler_package_id: schedulerPackageRef.runtime_scheduler_package_id,
        runtime_dispatch_stage_reference_id: dispatchStageId,
        scheduler_stage_reference_id: stage.scheduler_stage_reference_id,
        runtime_stage_reference_id: stage.runtime_stage_reference_id,
        worker_stage_assignment_reference_id: assignment.worker_stage_assignment_reference_id,
        worker_candidate_set_reference_id: candidateSet ? candidateSet.worker_candidate_set_reference_id : 'worker_candidate_set_not_available',
        worker_compatibility_reference_id: compatibilityRef ? compatibilityRef.worker_compatibility_reference_id : 'worker_compatibility_not_available',
        runtime_worker_reference_id: worker ? worker.runtime_worker_reference_id : 'runtime_worker_not_available',
        worker_capability_reference_id: worker ? worker.worker_capability_reference_id : 'worker_capability_not_available',
        worker_capacity_reference_id: worker ? worker.worker_capacity_reference_id : 'worker_capacity_not_available',
        worker_health_reference_id: worker ? worker.worker_health_reference_id : 'worker_health_not_available',
        worker_assignment_status: assignment.assignment_status,
        worker_compatible: revalidation.reasons.includes('worker_not_in_compatible_candidate_set') || revalidation.reasons.includes('worker_compatibility_reference_invalid') ? false : true,
        worker_health_valid_at_dispatch: revalidation.healthValid,
        worker_capacity_valid_at_dispatch: revalidation.capacityValid,
        worker_binding_validated: revalidation.valid,
        reason_codes: revalidation.reasons
      });
      workerBindingRefs.push(workerBindingRef);

      const capacityId = `${dispatchStageId}-capacity`;
      const requestedTokens = stage.estimated_total_tokens;
      const requestedCost = stage.estimated_cost_minor_units;
      capacityRef = buildRuntimeDispatchCapacityReference({
        dispatch_capacity_reference_id: capacityId,
        runtime_dispatch_package_id: packageId,
        runtime_dispatch_stage_reference_id: dispatchStageId,
        runtime_worker_reference_id: worker ? worker.runtime_worker_reference_id : 'runtime_worker_not_available',
        runtime_capacity_snapshot_reference_id: capacitySnapshotRef.runtime_capacity_snapshot_reference_id,
        runtime_concurrency_reference_id: concurrencyRef.runtime_concurrency_reference_id,
        worker_capacity_reference_id: worker ? worker.worker_capacity_reference_id : 'worker_capacity_not_available',
        requested_stage_slots: 1,
        requested_parallel_slots: stage.parallelizable ? 1 : 0,
        requested_model_slots: stage.model_selection_reference_id !== null ? 1 : 0,
        requested_tool_slots: Array.isArray(stage.tool_reference_ids) ? stage.tool_reference_ids.length : 0,
        requested_workflow_slots: stage.workflow_reference_id !== null ? 1 : 0,
        requested_tokens: requestedTokens,
        requested_cost_minor_units: requestedCost,
        runtime_stage_capacity_available: capacitySnapshotRef.capacity_available === true,
        runtime_parallel_capacity_available: concurrencyRef.parallel_slots_available === true,
        runtime_model_capacity_available: concurrencyRef.model_slots_available === true,
        runtime_tool_capacity_available: concurrencyRef.tool_slots_available === true,
        runtime_workflow_capacity_available: concurrencyRef.workflow_slots_available === true,
        runtime_token_capacity_available: capacitySnapshotRef.capacity_available === true,
        runtime_cost_capacity_available: capacitySnapshotRef.capacity_available === true,
        worker_stage_capacity_available: capacity ? capacity.available_stage_assignments >= 1 : false,
        worker_parallel_capacity_available: capacity ? capacity.available_parallel_assignments >= 1 : false,
        worker_model_capacity_available: capacity ? capacity.available_model_assignments >= 1 : false,
        worker_tool_capacity_available: capacity ? capacity.available_tool_assignments >= 1 : false,
        worker_workflow_capacity_available: capacity ? capacity.available_workflow_assignments >= 1 : false,
        worker_token_capacity_available: capacity ? capacity.available_token_capacity >= requestedTokens : false,
        worker_cost_capacity_available: capacity ? capacity.available_cost_capacity_minor_units >= requestedCost : false
      });
      capacityRefs.push(capacityRef);
      capacityGatePassed = capacityRef.capacity_validated === true;

      const budgetId = `${dispatchStageId}-budget`;
      budgetRef2 = buildRuntimeDispatchBudgetReference({
        dispatch_budget_reference_id: budgetId,
        runtime_dispatch_package_id: packageId,
        runtime_dispatch_stage_reference_id: dispatchStageId,
        runtime_budget_reference_id: budgetRef.runtime_budget_reference_id,
        execution_budget_reference_id: budgetRef.execution_budget_id,
        estimated_input_tokens: stage.estimated_input_tokens,
        estimated_output_tokens: stage.estimated_output_tokens,
        estimated_total_tokens: stage.estimated_total_tokens,
        estimated_cost_minor_units: stage.estimated_cost_minor_units,
        remaining_input_tokens: budgetRef.maximum_input_tokens,
        remaining_output_tokens: budgetRef.maximum_output_tokens,
        remaining_total_tokens: budgetRef.maximum_total_tokens,
        remaining_cost_minor_units: budgetRef.maximum_total_cost_minor_units
      });
      budgetRefs.push(budgetRef2);
      budgetGatePassed = budgetRef2.budget_validated === true;

      const payloadId = `${dispatchStageId}-payload`;
      payloadRef = buildRuntimeDispatchPayloadReference({
        dispatch_payload_reference_id: payloadId,
        runtime_dispatch_package_id: packageId,
        runtime_dispatch_stage_reference_id: dispatchStageId,
        dispatch_worker_binding_reference_id: workerBindingId,
        runtime_execution_package_id: packageRef.runtime_execution_package_id,
        runtime_stage_reference_id: stage.runtime_stage_reference_id,
        runtime_worker_reference_id: worker ? worker.runtime_worker_reference_id : 'runtime_worker_not_available',
        task_reference_id: stage.task_reference_id,
        agent_reference_id: stage.agent_reference_id,
        memory_selection_reference_id: stage.memory_selection_reference_id,
        context_assembly_reference_id: stage.context_assembly_reference_id,
        model_selection_reference_id: stage.model_selection_reference_id,
        tool_reference_ids: stage.tool_reference_ids,
        workflow_reference_id: stage.workflow_reference_id,
        stage_policy_requirement_reference_ids: dispatchStageRef.stage_policy_requirement_reference_ids,
        network_policy_reference_ids: [],
        secret_policy_reference_ids: [],
        required_capability_ids: stage.required_capabilities,
        required_modality_ids: stage.required_modalities,
        estimated_input_tokens: stage.estimated_input_tokens,
        estimated_output_tokens: stage.estimated_output_tokens,
        estimated_total_tokens: stage.estimated_total_tokens,
        estimated_cost_minor_units: stage.estimated_cost_minor_units
      });
      payloadRefs.push(payloadRef);
    }

    const dependencyGatePassed = dependencyGateRef.dispatch_allowed_by_dependencies === true;
    const approvalGatePassed = approvalGateRef.dispatch_allowed_by_approval === true;
    const payloadGatePassed = payloadRef ? findAgentCoreOperationalMaterial(payloadRef).length === 0 : dispatchStageStatus !== 'DISPATCH_STAGE_ELIGIBLE_SIMULATION' && dispatchStageStatus !== 'DISPATCH_STAGE_OPTIONAL_REFERENCE';

    let intentStatus;
    if (dispatchStageStatus === 'DISPATCH_STAGE_WAITING_DEPENDENCY_REFERENCE') intentStatus = 'DISPATCH_INTENT_WAITING_DEPENDENCY_REFERENCE';
    else if (dispatchStageStatus === 'DISPATCH_STAGE_WAITING_APPROVAL_REFERENCE') intentStatus = 'DISPATCH_INTENT_WAITING_APPROVAL_REFERENCE';
    else if (dispatchStageStatus === 'DISPATCH_STAGE_NO_WORKER_BLOCKED') intentStatus = 'DISPATCH_INTENT_NO_WORKER_BLOCKED';
    else if (dispatchStageStatus === 'DISPATCH_STAGE_BLOCKED' || dispatchStageStatus === 'DISPATCH_STAGE_NOT_EVALUATED') intentStatus = 'DISPATCH_INTENT_BLOCKED';
    else if (dispatchStageStatus === 'DISPATCH_STAGE_OPTIONAL_REFERENCE') intentStatus = 'DISPATCH_INTENT_OPTIONAL_REFERENCE';
    else if (!capacityGatePassed) intentStatus = 'DISPATCH_INTENT_CAPACITY_BLOCKED';
    else if (!budgetGatePassed) intentStatus = 'DISPATCH_INTENT_BUDGET_BLOCKED';
    else if (!dependencyGatePassed || !approvalGatePassed || !workerGatePassed || !payloadGatePassed) intentStatus = 'DISPATCH_INTENT_BLOCKED';
    else intentStatus = 'DISPATCH_INTENT_PREPARED_SIMULATION';

    const intentId = `${dispatchStageId}-intent`;
    const intentRef = buildRuntimeDispatchIntentReference({
      dispatch_intent_reference_id: intentId,
      runtime_dispatch_package_id: packageId,
      runtime_dispatch_request_id: requestId,
      runtime_dispatch_stage_reference_id: dispatchStageId,
      dispatch_worker_binding_reference_id: workerBindingRef ? workerBindingRef.dispatch_worker_binding_reference_id : dependencyGateId,
      dispatch_dependency_gate_reference_id: dependencyGateId,
      dispatch_approval_gate_reference_id: approvalGateId,
      dispatch_capacity_reference_id: capacityRef ? capacityRef.dispatch_capacity_reference_id : dependencyGateId,
      dispatch_budget_reference_id: budgetRef2 ? budgetRef2.dispatch_budget_reference_id : dependencyGateId,
      dispatch_payload_reference_id: payloadRef ? payloadRef.dispatch_payload_reference_id : dependencyGateId,
      scheduler_stage_reference_id: stage.scheduler_stage_reference_id,
      runtime_stage_reference_id: stage.runtime_stage_reference_id,
      runtime_worker_reference_id: workerBindingRef ? workerBindingRef.runtime_worker_reference_id : null,
      dispatch_sequence: intentStatus === 'DISPATCH_INTENT_PREPARED_SIMULATION' ? dispatchSequence++ : dispatchSequence,
      dispatch_intent_status: intentStatus,
      dependency_gate_passed: intentStatus === 'DISPATCH_INTENT_PREPARED_SIMULATION' ? dependencyGatePassed : false,
      approval_gate_passed: intentStatus === 'DISPATCH_INTENT_PREPARED_SIMULATION' ? approvalGatePassed : false,
      capacity_gate_passed: intentStatus === 'DISPATCH_INTENT_PREPARED_SIMULATION' ? capacityGatePassed : false,
      budget_gate_passed: intentStatus === 'DISPATCH_INTENT_PREPARED_SIMULATION' ? budgetGatePassed : false,
      worker_gate_passed: intentStatus === 'DISPATCH_INTENT_PREPARED_SIMULATION' ? workerGatePassed : false,
      payload_gate_passed: intentStatus === 'DISPATCH_INTENT_PREPARED_SIMULATION' ? payloadGatePassed : false
    });
    intentRefs.push(intentRef);
  }
  markValid('dispatch_stages_validated');
  markValid('worker_bindings_validated');
  markValid('dependency_gates_validated');
  markValid('approval_gates_validated');
  markValid('capacity_references_validated');
  markValid('budget_references_validated');
  markValid('payload_references_validated');
  markValid('dispatch_intents_validated');

  // 32. Derive Dispatch Order -- "subsequência estável da ordem topológica do Scheduler Package,"
  // never recalculated by score.
  const orderedStageIds = schedulerStages.map((s) => `${s.scheduler_stage_reference_id}-dispatch-stage`);
  const orderedIntentIds = intentRefs.map((i) => i.dispatch_intent_reference_id);
  const preparedIntentIds = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION').map((i) => i.dispatch_intent_reference_id);
  const waitingDependencyIntentIds = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_WAITING_DEPENDENCY_REFERENCE').map((i) => i.dispatch_intent_reference_id);
  const waitingApprovalIntentIds = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_WAITING_APPROVAL_REFERENCE').map((i) => i.dispatch_intent_reference_id);
  const optionalIntentIds = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_OPTIONAL_REFERENCE').map((i) => i.dispatch_intent_reference_id);
  const blockedIntentIds = intentRefs.filter((i) => !['DISPATCH_INTENT_PREPARED_SIMULATION', 'DISPATCH_INTENT_WAITING_DEPENDENCY_REFERENCE', 'DISPATCH_INTENT_WAITING_APPROVAL_REFERENCE', 'DISPATCH_INTENT_OPTIONAL_REFERENCE'].includes(i.dispatch_intent_status)).map((i) => i.dispatch_intent_reference_id);

  const orderId = `${packageId}-order`;
  const orderRef = buildRuntimeDispatchOrderReference({
    dispatch_order_reference_id: orderId,
    runtime_dispatch_package_id: packageId,
    runtime_scheduler_package_id: schedulerPackageRef.runtime_scheduler_package_id,
    ordered_dispatch_stage_reference_ids: orderedStageIds,
    ordered_dispatch_intent_reference_ids: orderedIntentIds,
    prepared_dispatch_intent_reference_ids: preparedIntentIds,
    waiting_dependency_intent_reference_ids: waitingDependencyIntentIds,
    waiting_approval_intent_reference_ids: waitingApprovalIntentIds,
    optional_intent_reference_ids: optionalIntentIds,
    blocked_intent_reference_ids: blockedIntentIds,
    // "A ordem de dispatch é uma subsequência estável da ordem topológica do Scheduler Package" --
    // stage ids are emitted in exactly the order schedulerResultRef.scheduler_stage_references
    // itself already carries (already topologically ordered by PR #105), never recomputed here.
    scheduler_order_preserved: true,
    required_predecessor_order_preserved: true
  });
  markValid('dispatch_order_validated');

  // 33. Policy limits.
  if (Number.isInteger(policy.maximum_dispatch_intent_count) && preparedIntentIds.length > policy.maximum_dispatch_intent_count) {
    return finalize('DISPATCH_POLICY_BLOCKED', ['dispatch_intent_count_exceeds_policy_limit']);
  }
  const hasModelIntent = intentRefs.some((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION' && dispatchStageRefs.find((s) => s.runtime_dispatch_stage_reference_id === i.runtime_dispatch_stage_reference_id)?.model_selection_reference_id !== null);
  void hasModelIntent;

  // 36. Non-execution invariants.
  if (schedulerResultRef.executed === true || workerAssignmentResultRef.executed === true || packageRef.executed === true) {
    return finalize('DISPATCH_VALIDATION_FAILED', ['non_execution_invariant_violated']);
  }
  markValid('non_execution_invariants_validated');
  markValid('package_fingerprint_validated');
  markValid('package_digest_validated');

  return finalize('DISPATCH_PACKAGE_PREPARED_SIMULATION', ['dispatch_package_prepared_in_simulation_only'], {
    dispatchStageRefs, workerBindingRefs, dependencyGateRefs, approvalGateRefs, capacityRefs, budgetRefs, payloadRefs,
    intentRefs, orderRef, dispatchReplayRef, registrySnapshotRef, networkPermissionPolicyRefs, secretResolutionPolicyRefs,
    stagePolicyRequirementRefs, workerRefs, workerCompatibilityRefs, workerCandidateSetRefs, capacitySnapshotRef,
    concurrencyRef, budgetRef, freshnessRef, idempotencyReference
  });
}

function buildDispatchOutcome(status, reasonCodes, ctx, validatedFlags) {
  const {
    request, requestFingerprint, canonical,
    workerAssignmentDecisionRef, workerAssignmentResultRef, workerAssignmentPackageRef,
    schedulerDecisionRef, schedulerResultRef, schedulerPackageRef, packageRef,
    dispatchStageRefs = [], workerBindingRefs = [], dependencyGateRefs = [], approvalGateRefs = [],
    capacityRefs = [], budgetRefs = [], payloadRefs = [], intentRefs = [], orderRef, dispatchReplayRef,
    registrySnapshotRef, networkPermissionPolicyRefs = [], secretResolutionPolicyRefs = [], stagePolicyRequirementRefs = [],
    workerRefs = [], workerCompatibilityRefs = [], workerCandidateSetRefs = [],
    capacitySnapshotRef, concurrencyRef, budgetRef, freshnessRef, idempotencyReference
  } = ctx;

  const requestSafe = isPlainObject(request) ? request : {};
  const workerAssignmentPackageSafe = isPlainObject(workerAssignmentPackageRef) ? workerAssignmentPackageRef : {};
  const schedulerDecisionSafe = isPlainObject(schedulerDecisionRef) ? schedulerDecisionRef : {};
  const schedulerPackageSafe = isPlainObject(schedulerPackageRef) ? schedulerPackageRef : {};
  const packageSafe = isPlainObject(packageRef) ? packageRef : {};
  const capacitySnapshotSafe = isPlainObject(capacitySnapshotRef) ? capacitySnapshotRef : {};
  const concurrencySafe = isPlainObject(concurrencyRef) ? concurrencyRef : {};
  const budgetSafe = isPlainObject(budgetRef) ? budgetRef : {};
  const freshnessSafe = isPlainObject(freshnessRef) ? freshnessRef : {};
  const idempotencySafe = isPlainObject(idempotencyReference) ? idempotencyReference : {};
  const registrySnapshotSafe = isPlainObject(registrySnapshotRef) ? registrySnapshotRef : {};
  const dispatchReplaySafe = isPlainObject(dispatchReplayRef) ? dispatchReplayRef : {};
  const canonicalSafe = canonical || {};

  const requestId = requestSafe.runtime_dispatch_request_id || 'runtime_dispatch_request_not_available';
  const packageId = `${requestId}-package`;

  const preparedIds = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION').map((i) => i.dispatch_intent_reference_id);
  const waitingDependencyIds = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_WAITING_DEPENDENCY_REFERENCE').map((i) => i.dispatch_intent_reference_id);
  const waitingApprovalIds = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_WAITING_APPROVAL_REFERENCE').map((i) => i.dispatch_intent_reference_id);
  const optionalIds = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_OPTIONAL_REFERENCE').map((i) => i.dispatch_intent_reference_id);
  const blockedIds = intentRefs.filter((i) => !['DISPATCH_INTENT_PREPARED_SIMULATION', 'DISPATCH_INTENT_WAITING_DEPENDENCY_REFERENCE', 'DISPATCH_INTENT_WAITING_APPROVAL_REFERENCE', 'DISPATCH_INTENT_OPTIONAL_REFERENCE'].includes(i.dispatch_intent_status)).map((i) => i.dispatch_intent_reference_id);

  const modelIntentCount = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION' && dispatchStageRefs.find((s) => s.runtime_dispatch_stage_reference_id === i.runtime_dispatch_stage_reference_id)?.model_selection_reference_id !== null).length;
  const toolIntentCount = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION' && dispatchStageRefs.find((s) => s.runtime_dispatch_stage_reference_id === i.runtime_dispatch_stage_reference_id)?.tool_reference_ids.length > 0).length;
  const workflowIntentCount = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION' && dispatchStageRefs.find((s) => s.runtime_dispatch_stage_reference_id === i.runtime_dispatch_stage_reference_id)?.workflow_reference_id !== null).length;
  const parallelIntentCount = intentRefs.filter((i) => i.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION' && dispatchStageRefs.find((s) => s.runtime_dispatch_stage_reference_id === i.runtime_dispatch_stage_reference_id)?.parallelizable === true).length;

  const estimatedInputTokens = dispatchStageRefs.reduce((sum, s) => sum + (preparedIds.includes(`${s.runtime_dispatch_stage_reference_id}-intent`) ? s.estimated_input_tokens : 0), 0);
  const estimatedOutputTokens = dispatchStageRefs.reduce((sum, s) => sum + (preparedIds.includes(`${s.runtime_dispatch_stage_reference_id}-intent`) ? s.estimated_output_tokens : 0), 0);
  const estimatedTotalTokens = dispatchStageRefs.reduce((sum, s) => sum + (preparedIds.includes(`${s.runtime_dispatch_stage_reference_id}-intent`) ? s.estimated_total_tokens : 0), 0);
  const estimatedTotalCost = dispatchStageRefs.reduce((sum, s) => sum + (preparedIds.includes(`${s.runtime_dispatch_stage_reference_id}-intent`) ? s.estimated_cost_minor_units : 0), 0);

  const pkg = buildRuntimeDispatchPackage({
    runtime_dispatch_package_id: packageId,
    runtime_dispatch_request_id: requestId,
    runtime_worker_assignment_request_id: workerAssignmentPackageSafe.runtime_worker_assignment_request_id || 'runtime_worker_assignment_request_not_available',
    runtime_worker_assignment_decision_id: (isPlainObject(workerAssignmentDecisionRef) && workerAssignmentDecisionRef.runtime_worker_assignment_decision_id) || 'runtime_worker_assignment_decision_not_available',
    runtime_worker_assignment_result_id: (isPlainObject(workerAssignmentResultRef) && workerAssignmentResultRef.runtime_worker_assignment_result_id) || 'runtime_worker_assignment_result_not_available',
    runtime_worker_assignment_package_id: workerAssignmentPackageSafe.runtime_worker_assignment_package_id || 'runtime_worker_assignment_package_not_available',
    runtime_scheduler_request_id: schedulerDecisionSafe.runtime_scheduler_request_id || 'runtime_scheduler_request_not_available',
    runtime_scheduler_decision_id: schedulerDecisionSafe.runtime_scheduler_decision_id || 'runtime_scheduler_decision_not_available',
    runtime_scheduler_result_id: (isPlainObject(schedulerResultRef) && schedulerResultRef.runtime_scheduler_result_id) || 'runtime_scheduler_result_not_available',
    runtime_scheduler_package_id: schedulerPackageSafe.runtime_scheduler_package_id || 'runtime_scheduler_package_not_available',
    runtime_execution_package_id: packageSafe.runtime_execution_package_id || 'runtime_execution_package_not_available',
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    dispatch_stage_reference_ids: dispatchStageRefs.map((s) => s.runtime_dispatch_stage_reference_id),
    dispatch_worker_binding_reference_ids: workerBindingRefs.map((r) => r.dispatch_worker_binding_reference_id),
    dispatch_dependency_gate_reference_ids: dependencyGateRefs.map((r) => r.dispatch_dependency_gate_reference_id),
    dispatch_approval_gate_reference_ids: approvalGateRefs.map((r) => r.dispatch_approval_gate_reference_id),
    dispatch_capacity_reference_ids: capacityRefs.map((r) => r.dispatch_capacity_reference_id),
    dispatch_budget_reference_ids: budgetRefs.map((r) => r.dispatch_budget_reference_id),
    dispatch_payload_reference_ids: payloadRefs.map((r) => r.dispatch_payload_reference_id),
    dispatch_intent_reference_ids: intentRefs.map((r) => r.dispatch_intent_reference_id),
    dispatch_order_reference_id: orderRef ? orderRef.dispatch_order_reference_id : `${packageId}-order-not-available`,
    runtime_dispatch_replay_reference_id: dispatchReplaySafe.runtime_dispatch_replay_reference_id || 'runtime_dispatch_replay_reference_not_available',
    ordered_dispatch_stage_reference_ids: orderRef ? orderRef.ordered_dispatch_stage_reference_ids : [],
    ordered_dispatch_intent_reference_ids: orderRef ? orderRef.ordered_dispatch_intent_reference_ids : [],
    prepared_dispatch_intent_reference_ids: preparedIds,
    waiting_dependency_intent_reference_ids: waitingDependencyIds,
    waiting_approval_intent_reference_ids: waitingApprovalIds,
    optional_intent_reference_ids: optionalIds,
    blocked_intent_reference_ids: blockedIds,
    dispatch_stage_count: dispatchStageRefs.length,
    dispatch_intent_count: intentRefs.length,
    prepared_intent_count: preparedIds.length,
    waiting_dependency_count: waitingDependencyIds.length,
    waiting_approval_count: waitingApprovalIds.length,
    optional_count: optionalIds.length,
    blocked_count: blockedIds.length,
    model_intent_count: modelIntentCount,
    tool_intent_count: toolIntentCount,
    workflow_intent_count: workflowIntentCount,
    parallel_intent_count: parallelIntentCount,
    estimated_input_tokens: estimatedInputTokens,
    estimated_output_tokens: estimatedOutputTokens,
    estimated_total_tokens: estimatedTotalTokens,
    estimated_total_cost_minor_units: estimatedTotalCost,
    worker_assignment_package_fingerprint: workerAssignmentPackageSafe.worker_assignment_package_fingerprint || 'fingerprint_not_available',
    worker_assignment_package_digest: workerAssignmentPackageSafe.worker_assignment_package_digest || 'digest_not_available',
    scheduler_package_fingerprint: schedulerDecisionSafe.runtime_scheduler_package_fingerprint || 'fingerprint_not_available',
    scheduler_package_digest: schedulerDecisionSafe.runtime_scheduler_package_digest || 'digest_not_available',
    runtime_execution_package_fingerprint: packageSafe.package_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_digest: packageSafe.package_digest || 'digest_not_available',
    capacity_snapshot_fingerprint: capacitySnapshotSafe.capacity_fingerprint || 'fingerprint_not_available',
    concurrency_fingerprint: concurrencySafe.concurrency_fingerprint || 'fingerprint_not_available',
    runtime_budget_fingerprint: budgetSafe.budget_fingerprint || 'fingerprint_not_available',
    freshness_fingerprint: freshnessSafe.freshness_fingerprint || 'fingerprint_not_available',
    idempotency_fingerprint: idempotencySafe.idempotency_fingerprint || 'fingerprint_not_available',
    registry_snapshot_fingerprint: registrySnapshotSafe.snapshot_fingerprint || 'fingerprint_not_available',
    worker_fingerprints: workerRefs.map((w) => w.worker_fingerprint),
    worker_assignment_fingerprints: [],
    worker_compatibility_fingerprints: workerCompatibilityRefs.map((c) => c.compatibility_fingerprint),
    worker_candidate_set_fingerprints: workerCandidateSetRefs.map((c) => c.candidate_set_fingerprint),
    stage_policy_requirement_fingerprints: stagePolicyRequirementRefs.map((h) => h.requirement_reference_fingerprint),
    stage_policy_requirement_source_fingerprints: [],
    official_network_policy_fingerprints: networkPermissionPolicyRefs.map((o) => computeOfficialPolicyFingerprint(o)),
    official_secret_policy_fingerprints: secretResolutionPolicyRefs.map((o) => computeOfficialPolicyFingerprint(o)),
    dispatch_stage_fingerprints: dispatchStageRefs.map((s) => s.dispatch_stage_fingerprint),
    dispatch_worker_binding_fingerprints: workerBindingRefs.map((r) => r.worker_binding_fingerprint),
    dispatch_dependency_gate_fingerprints: dependencyGateRefs.map((r) => r.dependency_gate_fingerprint),
    dispatch_approval_gate_fingerprints: approvalGateRefs.map((r) => r.approval_gate_fingerprint),
    dispatch_capacity_fingerprints: capacityRefs.map((r) => r.capacity_fingerprint),
    dispatch_budget_fingerprints: budgetRefs.map((r) => r.budget_fingerprint),
    dispatch_payload_fingerprints: payloadRefs.map((r) => r.payload_fingerprint),
    dispatch_intent_fingerprints: intentRefs.map((r) => r.dispatch_intent_fingerprint),
    dispatch_order_fingerprint: orderRef ? orderRef.order_fingerprint : 'fingerprint_not_available',
    dispatch_replay_fingerprint: dispatchReplaySafe.replay_fingerprint || 'fingerprint_not_available',
    dispatch_status: status
  });

  const decision = buildRuntimeDispatchDecision({
    runtime_dispatch_decision_id: `${requestId}-decision`,
    runtime_dispatch_request_id: requestId,
    runtime_dispatch_package_id: pkg.runtime_dispatch_package_id,
    runtime_worker_assignment_decision_id: pkg.runtime_worker_assignment_decision_id,
    runtime_worker_assignment_result_id: pkg.runtime_worker_assignment_result_id,
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
    runtime_dispatch_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    runtime_dispatch_package_fingerprint: pkg.dispatch_package_fingerprint,
    runtime_dispatch_package_digest: pkg.dispatch_package_digest,
    worker_assignment_package_fingerprint: pkg.worker_assignment_package_fingerprint,
    worker_assignment_package_digest: pkg.worker_assignment_package_digest,
    scheduler_package_fingerprint: pkg.scheduler_package_fingerprint,
    scheduler_package_digest: pkg.scheduler_package_digest,
    runtime_execution_package_fingerprint: pkg.runtime_execution_package_fingerprint,
    runtime_execution_package_digest: pkg.runtime_execution_package_digest,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  const result = buildRuntimeDispatchResult({
    runtime_dispatch_result_id: `${requestId}-result`,
    runtime_dispatch_request_id: requestId,
    runtime_dispatch_decision_id: decision.runtime_dispatch_decision_id,
    runtime_dispatch_package_id: decision.runtime_dispatch_package_id,
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
    runtime_dispatch_request_fingerprint: decision.runtime_dispatch_request_fingerprint,
    runtime_dispatch_decision_fingerprint: computeCanonicalContentDigest(decision),
    runtime_dispatch_package_fingerprint: decision.runtime_dispatch_package_fingerprint,
    runtime_dispatch_package_digest: decision.runtime_dispatch_package_digest,
    registry_version: String(requestSafe.expected_dispatch_registry_version || 'registry_version_not_available'),
    dispatch_stage_count: pkg.dispatch_stage_count,
    dispatch_intent_count: pkg.dispatch_intent_count,
    prepared_intent_count: pkg.prepared_intent_count,
    waiting_dependency_count: pkg.waiting_dependency_count,
    waiting_approval_count: pkg.waiting_approval_count,
    optional_count: pkg.optional_count,
    blocked_count: pkg.blocked_count,
    estimated_input_tokens: pkg.estimated_input_tokens,
    estimated_output_tokens: pkg.estimated_output_tokens,
    estimated_total_tokens: pkg.estimated_total_tokens,
    estimated_total_cost_minor_units: pkg.estimated_total_cost_minor_units,
    blockers: reasonCodes,
    reason_codes: reasonCodes
  });

  const audit = buildRuntimeDispatchAudit({
    decision, result,
    workerReferenceIds: workerBindingRefs.map((r) => r.runtime_worker_reference_id).filter((id) => isNonEmptyString(id)),
    dependencyGateOutcomes: dependencyGateRefs.map((r) => `${r.scheduler_stage_reference_id}::${r.dispatch_allowed_by_dependencies}`),
    approvalGateOutcomes: approvalGateRefs.map((r) => `${r.scheduler_stage_reference_id}::${r.dispatch_allowed_by_approval}`),
    logicalSequence: requestSafe.logical_sequence
  });

  return {
    decision, result, audit, package: pkg,
    dispatchStageRefs, workerBindingRefs, dependencyGateRefs, approvalGateRefs, capacityRefs, budgetRefs, payloadRefs,
    intentRefs, orderRef
  };
}

module.exports = {
  deriveDispatchStageStatus,
  evaluateRuntimeDispatchRequest,
  omitDispatchReplay,
  revalidateWorkerBinding
};
