'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { checkIdentity } = require('./runtime-execution-package');
const { FRESHNESS_DIMENSIONS } = require('./runtime-readiness-freshness-reference');
const { CAPACITY_DIMENSIONS } = require('./runtime-capacity-snapshot-reference');
const { computeIdempotencyFingerprint } = require('./execution-plan-idempotency');
const { validateRuntimeSchedulerRequest } = require('./runtime-scheduler-request');
const { buildRuntimeSchedulerStageReference } = require('./runtime-scheduler-stage-reference');
const { buildRuntimeSchedulerDependencyReference } = require('./runtime-scheduler-dependency-reference');
const { buildRuntimeSchedulerParallelGroupReference } = require('./runtime-scheduler-parallel-group-reference');
const { buildRuntimeSchedulerApprovalWaitReference } = require('./runtime-scheduler-approval-wait-reference');
const { buildRuntimeSchedulerCapacityPlanReference } = require('./runtime-scheduler-capacity-plan-reference');
const { buildRuntimeSchedulerQueuePlanReference } = require('./runtime-scheduler-queue-plan-reference');
const { buildRuntimeSchedulerPackage } = require('./runtime-scheduler-package');
const { buildRuntimeSchedulerDecision } = require('./runtime-scheduler-decision');
const { buildRuntimeSchedulerResult } = require('./runtime-scheduler-result');
const { buildRuntimeSchedulerAudit } = require('./runtime-scheduler-audit');

// pr105: the single evaluator this PR exists to build. Receives only an already
// RUNTIME_ADMITTED_SIMULATION package (Admission is a hard precondition, never re-derived here) and
// produces a purely declarative scheduling plan: eligibility per stage, dependency edges preserved
// 1:1, parallel groups genuinely derived from the dependency graph (never accepted free-form from
// the caller), approval waits derived exclusively from `approval_required`, a recalculated capacity
// plan, and a deterministic queue plan. Nothing here starts a scheduler, creates a job/queue/worker,
// dispatches a stage, or marks any dependency satisfied -- every one of those flags is forced false
// in every outcome this boundary can ever produce (see buildSchedulerOutcome below).

function arraysEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

// Mirrors runtime-admission-boundary.js's own omitReplayReference exactly, for the one field this
// layer's own request carries: `runtime_replay_reference` (never `runtime_readiness_replay_
// reference` -- see runtime-scheduler-request.js's own field list). Genuine key removal via
// destructuring, never `{ ...obj, field: undefined }` (stableCanonicalize throws
// `undefined_not_serializable` the instant it recurses into an own key whose value is `undefined`).
function omitReplayReference(obj) {
  if (!isPlainObject(obj)) return obj;
  const { runtime_replay_reference, ...rest } = obj;
  return rest;
}

// Excludes an admission request's own nested replay reference (and its own further-nested copy
// inside the readiness request it carries) before hashing -- the identical two-pass exclusion
// runtime-admission-boundary.js's own Phase B already established, reused here unchanged so the
// recomputed fingerprint agrees with the one the Admission layer itself already produced and bound
// into its own Replay Reference.
function computeAdmissionRequestFingerprint(admissionRequestRef) {
  if (!isPlainObject(admissionRequestRef)) return computeCanonicalContentDigest(admissionRequestRef);
  const { runtime_readiness_replay_reference, ...restTop } = admissionRequestRef;
  const readinessRequestRef = isPlainObject(admissionRequestRef.runtime_readiness_request_reference)
    ? admissionRequestRef.runtime_readiness_request_reference : undefined;
  const readinessRequestSansReplay = isPlainObject(readinessRequestRef)
    ? (({ runtime_readiness_replay_reference: _omit, ...rest }) => rest)(readinessRequestRef)
    : readinessRequestRef;
  return computeCanonicalContentDigest({ ...restTop, runtime_readiness_request_reference: readinessRequestSansReplay });
}

// --- Derivation helpers -------------------------------------------------------------------------

const SCHEDULER_STAGE_STATUSES_ORDER = Object.freeze({
  BLOCKED: 'SCHEDULER_STAGE_BLOCKED',
  WAITING_DEPENDENCY: 'SCHEDULER_STAGE_WAITING_DEPENDENCY_REFERENCE',
  WAITING_APPROVAL: 'SCHEDULER_STAGE_WAITING_APPROVAL_REFERENCE',
  OPTIONAL: 'SCHEDULER_STAGE_OPTIONAL_REFERENCE',
  ELIGIBLE: 'SCHEDULER_STAGE_ELIGIBLE_SIMULATION'
});

// Derives one status per source stage. Nothing is ever satisfied/approved in this PR, so any stage
// that is the `to` side of any dependency edge (required or not -- see "Preservar a semântica do
// grafo") is WAITING_DEPENDENCY_REFERENCE; `approval_required=true` always yields
// WAITING_APPROVAL_REFERENCE; `optional=true` (once neither of the above applies) yields
// OPTIONAL_REFERENCE; anything else that clears policy/type checks is ELIGIBLE_REFERENCE_SIMULATION.
function deriveStageStatus(stage, hasIncomingDependency, policy) {
  const hasModel = stage.model_selection_reference_id !== null;
  const hasTool = Array.isArray(stage.tool_reference_ids) && stage.tool_reference_ids.length > 0;
  const hasWorkflow = stage.workflow_reference_id !== null;
  const blocked = (
    stage.side_effect_classification === 'EXTERNAL_EFFECT_REFERENCE'
    || stage.side_effect_classification === 'IRREVERSIBLE_REFERENCE'
    || (hasModel && policy.allow_model_stage_reference !== true)
    || (hasTool && policy.allow_tool_stage_reference !== true)
    || (hasWorkflow && policy.allow_workflow_stage_reference !== true)
  );
  if (blocked) return SCHEDULER_STAGE_STATUSES_ORDER.BLOCKED;
  if (hasIncomingDependency) return SCHEDULER_STAGE_STATUSES_ORDER.WAITING_DEPENDENCY;
  if (stage.approval_required === true) return SCHEDULER_STAGE_STATUSES_ORDER.WAITING_APPROVAL;
  if (stage.optional === true) return SCHEDULER_STAGE_STATUSES_ORDER.OPTIONAL;
  return SCHEDULER_STAGE_STATUSES_ORDER.ELIGIBLE;
}

// The spec's own 6-tier deterministic comparator, applied as a sort key tuple. Blocked stages are
// placed in their own, most-significant tier (not described by the spec's own 6 rules, since a
// blocked stage participates in none of "waiting for dependency"/"waiting for approval"/"required
// vs optional" in any meaningful sense) -- everything after that follows the spec's literal order:
// dependency-wait before approval-wait before optional-vs-required, then priority (descending),
// stage_sequence (ascending), and finally runtime_stage_reference_id lexicographically.
function schedulerSortKey(stage, status) {
  return [
    status === SCHEDULER_STAGE_STATUSES_ORDER.BLOCKED ? 1 : 0,
    status === SCHEDULER_STAGE_STATUSES_ORDER.WAITING_DEPENDENCY ? 1 : 0,
    status === SCHEDULER_STAGE_STATUSES_ORDER.WAITING_APPROVAL ? 1 : 0,
    stage.optional === true ? 1 : 0,
    -stage.priority,
    stage.stage_sequence,
    stage.runtime_stage_reference_id
  ];
}

function compareSortKeys(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

// Topological depth (longest path from any root, 0-based) over the full dependency edge set --
// used only to cluster "mesmo nível topológico" candidates for parallel-group derivation, never to
// decide eligibility. `dependencyManifest.cycle_free` is already proven true by the time this runs,
// so plain memoized recursion terminates.
function computeStageDepths(stageIds, edges) {
  const incoming = new Map(stageIds.map((id) => [id, []]));
  for (const edge of edges) {
    if (incoming.has(edge.to_runtime_stage_id)) incoming.get(edge.to_runtime_stage_id).push(edge.from_runtime_stage_id);
  }
  const depths = new Map();
  function depthOf(id, visiting) {
    if (depths.has(id)) return depths.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const preds = incoming.get(id) || [];
    const depth = preds.length === 0 ? 0 : 1 + Math.max(...preds.map((p) => depthOf(p, visiting)));
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  }
  for (const id of stageIds) depthOf(id, new Set());
  return depths;
}

// --- Main evaluator ------------------------------------------------------------------------------

function evaluateRuntimeSchedulerRequest(request, context = {}) {
  void context; // never consulted for any decision.
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  const requestIsObject = isPlainObject(request);
  const policy = requestIsObject ? request.runtime_scheduler_policy : undefined;
  const admissionRequestRef = requestIsObject ? request.runtime_admission_request_reference : undefined;
  const admissionDecisionRef = requestIsObject ? request.runtime_admission_decision_reference : undefined;
  const admissionResultRef = requestIsObject ? request.runtime_admission_result_reference : undefined;
  const readinessDecisionRef = requestIsObject ? request.runtime_readiness_decision_reference : undefined;
  const packageRef = requestIsObject ? request.runtime_execution_package_reference : undefined;
  const stageManifest = requestIsObject ? request.runtime_stage_manifest_reference : undefined;
  const dependencyManifest = requestIsObject ? request.runtime_dependency_manifest_reference : undefined;
  const budgetRef = requestIsObject ? request.runtime_budget_reference : undefined;
  const capacitySnapshotRef = requestIsObject ? request.runtime_capacity_snapshot_reference : undefined;
  const concurrencyRef = requestIsObject ? request.runtime_concurrency_reference : undefined;
  const freshnessRef = requestIsObject ? request.runtime_freshness_reference : undefined;
  const replayRef = requestIsObject ? request.runtime_replay_reference : undefined;
  const idempotencyReference = requestIsObject ? request.idempotency_reference : undefined;
  const stopRefs = requestIsObject && Array.isArray(request.runtime_stop_references) ? request.runtime_stop_references : [];
  const compensationRefs = requestIsObject && Array.isArray(request.runtime_compensation_references) ? request.runtime_compensation_references : [];
  const artifactPlan = requestIsObject ? request.runtime_artifact_plan_reference : undefined;
  const eventPlan = requestIsObject ? request.runtime_event_plan_reference : undefined;

  const canonical = {
    tenantId: isPlainObject(packageRef) ? packageRef.tenant_id : undefined,
    organizationId: isPlainObject(packageRef) ? packageRef.organization_id : undefined,
    projectId: isPlainObject(packageRef) ? packageRef.project_id : undefined,
    sessionId: isPlainObject(packageRef) ? packageRef.session_reference_id : undefined,
    agentId: isPlainObject(packageRef) ? packageRef.agent_id : undefined,
    actorId: isPlainObject(packageRef) ? packageRef.actor_id : undefined
  };

  // Excludes runtime_replay_reference from its own input -- the same self-reference exclusion every
  // prior layer's own request fingerprint already applies.
  const requestForFingerprint = requestIsObject ? omitReplayReference(request) : request;
  const requestFingerprint = computeCanonicalContentDigest(requestForFingerprint);

  function finalize(status, reasonCodes, derived = {}) {
    return buildSchedulerOutcome(status, reasonCodes, {
      request, requestFingerprint, canonical, admissionDecisionRef, admissionResultRef, readinessDecisionRef,
      packageRef, capacitySnapshotRef, concurrencyRef, freshnessRef, idempotencyReference,
      stageManifest, dependencyManifest, budgetRef, policy, ...derived
    }, validatedFlags);
  }

  // 1-2. Request contract shape, including simulation_context and every nested reference against
  // its own real validator (policy, admission chain, readiness decision, package, manifests,
  // budget, capacity, concurrency, freshness, replay, idempotency, stops, compensations, artifact/
  // event plan).
  const requestValidation = validateRuntimeSchedulerRequest(request);
  if (!requestValidation.valid) return finalize('SCHEDULER_VALIDATION_FAILED', ['runtime_scheduler_request_invalid']);
  markValid('request_validated');

  // 9. Identity -- evaluated early, matching the real precedence order (identity ahead of policy),
  // the same "declarated order != real evaluation order" split every prior layer's boundary already
  // established.
  const identityChecks = [
    ['runtime_execution_package_reference', packageRef], ['runtime_stage_manifest_reference', stageManifest],
    ['runtime_dependency_manifest_reference', dependencyManifest], ['runtime_budget_reference', budgetRef],
    ['runtime_capacity_snapshot_reference', capacitySnapshotRef], ['runtime_concurrency_reference', concurrencyRef],
    ['idempotency_reference', idempotencyReference]
  ];
  for (const [label, reference] of identityChecks) {
    const mismatch = checkIdentity(reference, canonical, label);
    if (mismatch) return finalize(mismatch.status, [mismatch.reason]);
  }
  markValid('identity_validated');

  // 3. Scheduler Policy -- allow_*_stage_reference flags genuinely re-checked against the real
  // stage composition; external/irreversible effects are never allowed regardless of policy.
  const stages = isPlainObject(stageManifest) && Array.isArray(stageManifest.runtime_stage_references) ? stageManifest.runtime_stage_references : [];
  const hasExternalEffect = stages.some((s) => s.side_effect_classification === 'EXTERNAL_EFFECT_REFERENCE');
  const hasIrreversibleEffect = stages.some((s) => s.side_effect_classification === 'IRREVERSIBLE_REFERENCE');
  if (hasExternalEffect) return finalize('SCHEDULER_POLICY_BLOCKED', ['external_effect_reference_never_allowed']);
  if (hasIrreversibleEffect) return finalize('SCHEDULER_POLICY_BLOCKED', ['irreversible_reference_never_allowed']);
  const hasRequiredStage = stages.some((s) => s.optional !== true);
  const hasOptionalStage = stages.some((s) => s.optional === true);
  const hasParallelStage = stages.some((s) => s.parallelizable === true);
  const hasApprovalStage = stages.some((s) => s.approval_required === true);
  const hasModelStage = stages.some((s) => s.model_selection_reference_id !== null);
  const hasToolStage = stages.some((s) => Array.isArray(s.tool_reference_ids) && s.tool_reference_ids.length > 0);
  const hasWorkflowStage = stages.some((s) => s.workflow_reference_id !== null);
  const hasStateChangeStage = stages.some((s) => s.side_effect_classification === 'STATE_CHANGE_REFERENCE');
  if (hasRequiredStage && policy.allow_required_stage_reference !== true) return finalize('SCHEDULER_POLICY_BLOCKED', ['required_stage_reference_not_allowed_by_scheduler_policy']);
  if (hasOptionalStage && policy.allow_optional_stage_reference !== true) return finalize('SCHEDULER_POLICY_BLOCKED', ['optional_stage_reference_not_allowed_by_scheduler_policy']);
  if (hasParallelStage && policy.allow_parallel_group_reference !== true) return finalize('SCHEDULER_POLICY_BLOCKED', ['parallel_group_reference_not_allowed_by_scheduler_policy']);
  if (hasApprovalStage && policy.allow_human_approval_wait_reference !== true) return finalize('SCHEDULER_POLICY_BLOCKED', ['human_approval_wait_reference_not_allowed_by_scheduler_policy']);
  if (hasModelStage && policy.allow_model_stage_reference !== true) return finalize('SCHEDULER_POLICY_BLOCKED', ['model_stage_reference_not_allowed_by_scheduler_policy']);
  if (hasToolStage && policy.allow_tool_stage_reference !== true) return finalize('SCHEDULER_POLICY_BLOCKED', ['tool_stage_reference_not_allowed_by_scheduler_policy']);
  if (hasWorkflowStage && policy.allow_workflow_stage_reference !== true) return finalize('SCHEDULER_POLICY_BLOCKED', ['workflow_stage_reference_not_allowed_by_scheduler_policy']);
  if (hasStateChangeStage && policy.allow_state_change_reference !== true) return finalize('SCHEDULER_POLICY_BLOCKED', ['state_change_reference_not_allowed_by_scheduler_policy']);
  if (stages.length > policy.maximum_scheduler_stage_count) return finalize('SCHEDULER_POLICY_BLOCKED', ['scheduler_stage_count_exceeds_policy_limit']);
  const rawModelStageCount = stages.filter((s) => s.model_selection_reference_id !== null).length;
  const rawToolStageCount = stages.filter((s) => Array.isArray(s.tool_reference_ids) && s.tool_reference_ids.length > 0).length;
  const rawWorkflowStageCount = stages.filter((s) => s.workflow_reference_id !== null).length;
  if (rawModelStageCount > policy.maximum_model_stage_count) return finalize('SCHEDULER_POLICY_BLOCKED', ['model_stage_count_exceeds_policy_limit']);
  if (rawToolStageCount > policy.maximum_tool_stage_count) return finalize('SCHEDULER_POLICY_BLOCKED', ['tool_stage_count_exceeds_policy_limit']);
  if (rawWorkflowStageCount > policy.maximum_workflow_stage_count) return finalize('SCHEDULER_POLICY_BLOCKED', ['workflow_stage_count_exceeds_policy_limit']);
  if (isPlainObject(stageManifest) && stageManifest.estimated_total_tokens > policy.maximum_estimated_tokens) {
    return finalize('SCHEDULER_POLICY_BLOCKED', ['estimated_tokens_exceeds_policy_limit']);
  }
  if (isPlainObject(stageManifest) && stageManifest.estimated_total_cost_minor_units > policy.maximum_estimated_cost_minor_units) {
    return finalize('SCHEDULER_POLICY_BLOCKED', ['estimated_cost_exceeds_policy_limit']);
  }
  markValid('policy_validated');

  // 4-6. Admission -- must be a genuine, matching, already-admitted chain.
  if (
    admissionDecisionRef.status !== 'RUNTIME_ADMITTED_SIMULATION' || admissionDecisionRef.runtime_admitted_in_simulation !== true
    || admissionResultRef.status !== 'RUNTIME_ADMITTED_SIMULATION' || admissionResultRef.runtime_admitted_in_simulation !== true
    || admissionDecisionRef.runtime_admission_request_id !== admissionRequestRef.runtime_admission_request_id
    || admissionResultRef.runtime_admission_decision_id !== admissionDecisionRef.runtime_admission_decision_id
    || admissionDecisionRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || readinessDecisionRef.status !== 'RUNTIME_READY_SIMULATION' || readinessDecisionRef.runtime_ready_in_simulation !== true
    || readinessDecisionRef.runtime_readiness_decision_id !== admissionDecisionRef.runtime_readiness_decision_id
  ) {
    return finalize('SCHEDULER_ADMISSION_BLOCKED', ['scheduler_admission_chain_not_genuinely_admitted']);
  }
  markValid('admission_validated');

  // 8. Runtime Package -- must still be the exact same, never-mutated package the admission chain
  // found admitted; stops/compensations are cross-checked here too (this layer has no dedicated
  // precedence slot for them, the same way PR #104's own Phase B folds them into runtime_package_
  // validated rather than a separate status).
  const stopFingerprints = stopRefs.map((s) => s.stop_fingerprint).sort();
  const compensationFingerprints = compensationRefs.map((c) => c.compensation_fingerprint).sort();
  if (
    packageRef.runtime_status !== 'RUNTIME_PACKAGE_PREPARED_SIMULATION' || packageRef.runtime_admitted_in_simulation !== false
    || packageRef.runtime_enabled === true || packageRef.execution_authorized === true || packageRef.executed === true
    || packageRef.package_fingerprint !== admissionDecisionRef.runtime_execution_package_fingerprint
    || packageRef.package_digest !== admissionDecisionRef.runtime_execution_package_digest
    || !arraysEqual(stopFingerprints, packageRef.runtime_stop_fingerprints || stopFingerprints)
    || !arraysEqual(compensationFingerprints, packageRef.runtime_compensation_fingerprints || compensationFingerprints)
    || !isPlainObject(artifactPlan) || artifactPlan.artifact_plan_fingerprint !== packageRef.runtime_artifact_plan_fingerprint
    || !isPlainObject(eventPlan) || eventPlan.event_plan_fingerprint !== packageRef.runtime_event_plan_fingerprint
  ) {
    return finalize('SCHEDULER_RUNTIME_PACKAGE_BLOCKED', ['runtime_package_not_still_prepared_or_mutated']);
  }
  markValid('runtime_package_validated');

  // 10. Stage Manifest -- must match what the Runtime Package itself declares.
  if (
    stageManifest.runtime_stage_manifest_id !== packageRef.runtime_stage_manifest_id
    || stageManifest.manifest_fingerprint !== packageRef.runtime_stage_manifest_fingerprint
    || stageManifest.manifest_validated !== true
  ) {
    return finalize('SCHEDULER_STAGE_BLOCKED', ['runtime_stage_manifest_mismatch']);
  }
  markValid('stage_manifest_validated');

  // 11. Dependency Manifest -- must match the package's own declared fingerprint and be cycle-free.
  const dependencies = isPlainObject(dependencyManifest) && Array.isArray(dependencyManifest.runtime_dependency_references)
    ? dependencyManifest.runtime_dependency_references : [];
  const knownStageIds = new Set(stages.map((s) => s.runtime_stage_reference_id));
  const hasUnknownStageReference = dependencies.some((d) => !knownStageIds.has(d.from_runtime_stage_id) || !knownStageIds.has(d.to_runtime_stage_id));
  if (
    dependencyManifest.runtime_dependency_manifest_id !== packageRef.runtime_dependency_manifest_id
    || dependencyManifest.manifest_fingerprint !== packageRef.runtime_dependency_manifest_fingerprint
    || dependencyManifest.cycle_free !== true
    || (policy.fail_on_unknown_stage === true && hasUnknownStageReference)
    || (policy.fail_on_unknown_dependency === true && dependencyManifest.all_dependencies_validated !== true)
    || (policy.fail_on_cycle === true && dependencyManifest.cycle_free !== true)
  ) {
    return finalize('SCHEDULER_DEPENDENCY_BLOCKED', ['runtime_dependency_manifest_mismatch_or_invalid']);
  }
  markValid('dependency_manifest_validated');

  // 12. Budget.
  if (
    budgetRef.budget_fingerprint !== packageRef.runtime_budget_fingerprint || budgetRef.budget_validated !== true
    || budgetRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
  ) {
    return finalize('SCHEDULER_BUDGET_BLOCKED', ['runtime_budget_reference_mismatch']);
  }
  markValid('budget_validated');

  // 13. Capacity Snapshot -- must still be the exact same, still-consistent snapshot the admission
  // chain used.
  if (
    capacitySnapshotRef.capacity_fingerprint !== admissionDecisionRef.runtime_capacity_snapshot_fingerprint
    || capacitySnapshotRef.capacity_available !== true || capacitySnapshotRef.capacity_consistent !== true
    || capacitySnapshotRef.snapshot_expired_logically !== false
  ) {
    return finalize('SCHEDULER_CAPACITY_BLOCKED', ['runtime_capacity_snapshot_not_still_valid']);
  }
  markValid('capacity_validated');

  // 14. Concurrency.
  if (concurrencyRef.concurrency_fingerprint !== admissionDecisionRef.runtime_concurrency_fingerprint || concurrencyRef.concurrency_validated !== true) {
    return finalize('SCHEDULER_CONCURRENCY_BLOCKED', ['runtime_concurrency_not_still_valid']);
  }
  markValid('concurrency_validated');

  // 15. Freshness -- pr105 recomputes every dimension using the Scheduler Request's own
  // logical_sequence, never the frozen current_logical_sequence the reference already carries (the
  // same "package can age logically between phases" fix PR #104fix already established one layer
  // below).
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < freshnessRef.current_logical_sequence) {
    return finalize('SCHEDULER_FRESHNESS_BLOCKED', ['scheduler_logical_sequence_regressive']);
  }
  const schedulerFreshnessExpired = FRESHNESS_DIMENSIONS.some(([, createdField, maximumField]) => (
    (request.logical_sequence - freshnessRef[createdField]) > freshnessRef[maximumField]
  ));
  if (schedulerFreshnessExpired || freshnessRef.freshness_validated !== true) {
    return finalize('SCHEDULER_FRESHNESS_BLOCKED', ['runtime_freshness_expired_at_scheduler_logical_sequence']);
  }
  markValid('freshness_validated');

  // 16. Replay -- the reused RuntimeReadinessReplayReference is proven to genuinely bind to *this*
  // scheduler request's own upstream admission chain (never trusted as merely "the same object
  // admission already used"): its own admission_request_id/admission_request_fingerprint are
  // recomputed and cross-checked against the real admission_request_reference this scheduler
  // request itself carries, and its own package/idempotency copies against the real package/
  // idempotency this request carries.
  const recomputedAdmissionRequestFingerprint = computeAdmissionRequestFingerprint(admissionRequestRef);
  if (
    replayRef.admission_request_id !== admissionRequestRef.runtime_admission_request_id
    || replayRef.admission_request_fingerprint !== recomputedAdmissionRequestFingerprint
    || replayRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || replayRef.runtime_package_fingerprint !== packageRef.package_fingerprint
    || replayRef.runtime_package_digest !== packageRef.package_digest
    || replayRef.idempotency_reference_id !== idempotencyReference.idempotency_reference_id
    || replayRef.idempotency_fingerprint !== idempotencyReference.idempotency_fingerprint
    || replayRef.replay_validated !== true || replayRef.replay_allowed !== true
  ) {
    return finalize('SCHEDULER_REPLAY_BLOCKED', ['runtime_replay_reference_not_bound_to_scheduler_request']);
  }
  markValid('replay_validated');

  // 17. Idempotency -- the real, official ExecutionPlanIdempotencyReference (PR #98, reused
  // verbatim) is proven to be the exact same one that flowed through the admission chain this
  // scheduler request carries (readiness request's own `idempotency_reference`, embedded
  // transitively inside `runtime_admission_request_reference.runtime_readiness_request_reference`),
  // never independently substituted -- plus its own self-fingerprint (the contract's own validator
  // does not recompute-and-compare one) and safe flags.
  const upstreamReadinessRequestRef = isPlainObject(admissionRequestRef) ? admissionRequestRef.runtime_readiness_request_reference : undefined;
  const upstreamIdempotencyReference = isPlainObject(upstreamReadinessRequestRef) ? upstreamReadinessRequestRef.idempotency_reference : undefined;
  if (
    !isPlainObject(upstreamIdempotencyReference)
    || idempotencyReference.idempotency_reference_id !== upstreamIdempotencyReference.idempotency_reference_id
    || idempotencyReference.idempotency_fingerprint !== upstreamIdempotencyReference.idempotency_fingerprint
    || computeIdempotencyFingerprint(idempotencyReference) !== idempotencyReference.idempotency_fingerprint
    || idempotencyReference.idempotency_validated !== true || idempotencyReference.idempotency_consumed !== false
    || idempotencyReference.duplicate_execution_blocked !== true
  ) {
    return finalize('SCHEDULER_IDEMPOTENCY_BLOCKED', ['idempotency_reference_not_bound_to_admission_chain']);
  }
  markValid('idempotency_validated');

  // 20. Derive Scheduler Stage References.
  const hasIncomingDependencyByStageId = new Map(stages.map((s) => [s.runtime_stage_reference_id, false]));
  for (const dep of dependencies) {
    if (hasIncomingDependencyByStageId.has(dep.to_runtime_stage_id)) hasIncomingDependencyByStageId.set(dep.to_runtime_stage_id, true);
  }
  const stageStatusById = new Map();
  for (const stage of stages) {
    stageStatusById.set(stage.runtime_stage_reference_id, deriveStageStatus(stage, hasIncomingDependencyByStageId.get(stage.runtime_stage_reference_id), policy));
  }
  const waitingApprovalCount = [...stageStatusById.values()].filter((s) => s === SCHEDULER_STAGE_STATUSES_ORDER.WAITING_APPROVAL).length;
  if (waitingApprovalCount > policy.maximum_waiting_approval_stage_count) {
    return finalize('SCHEDULER_POLICY_BLOCKED', ['waiting_approval_stage_count_exceeds_policy_limit']);
  }

  const sortedStages = [...stages].sort((a, b) => compareSortKeys(
    schedulerSortKey(a, stageStatusById.get(a.runtime_stage_reference_id)),
    schedulerSortKey(b, stageStatusById.get(b.runtime_stage_reference_id))
  ));

  const schedulerStageRefs = sortedStages.map((stage, index) => buildRuntimeSchedulerStageReference({
    scheduler_stage_reference_id: `${packageRef.runtime_execution_package_id}-scheduler-stage-${stage.runtime_stage_reference_id}`,
    runtime_scheduler_request_id: request.runtime_scheduler_request_id,
    runtime_scheduler_package_id: `${request.runtime_scheduler_request_id}-package`,
    runtime_execution_package_id: packageRef.runtime_execution_package_id,
    runtime_stage_reference_id: stage.runtime_stage_reference_id,
    source_execution_stage_id: stage.source_execution_stage_id,
    source_orchestrator_stage_id: stage.source_orchestrator_stage_id,
    stage_sequence: stage.stage_sequence,
    scheduler_sequence: index,
    stage_type: stage.stage_type,
    priority: stage.priority,
    required: stage.optional !== true,
    optional: stage.optional === true,
    parallelizable: stage.parallelizable === true,
    approval_required: stage.approval_required === true,
    dependency_reference_ids: dependencies.filter((d) => d.to_runtime_stage_id === stage.runtime_stage_reference_id).map((d) => d.runtime_dependency_reference_id),
    blocking_dependency_reference_ids: dependencies.filter((d) => d.to_runtime_stage_id === stage.runtime_stage_reference_id && d.required === true).map((d) => d.runtime_dependency_reference_id),
    parallel_dependency_reference_ids: dependencies.filter((d) => d.to_runtime_stage_id === stage.runtime_stage_reference_id && d.dependency_type === 'PARALLEL_REFERENCE').map((d) => d.runtime_dependency_reference_id),
    required_capabilities: stage.required_capabilities,
    required_modalities: stage.required_modalities,
    task_reference_id: stage.task_reference_id,
    agent_reference_id: stage.agent_reference_id,
    memory_selection_reference_id: stage.memory_selection_reference_id,
    context_assembly_reference_id: stage.context_assembly_reference_id,
    model_selection_reference_id: stage.model_selection_reference_id,
    tool_reference_ids: stage.tool_reference_ids,
    workflow_reference_id: stage.workflow_reference_id,
    stop_reference_ids: stage.stop_reference_ids,
    compensation_reference_ids: stage.compensation_reference_ids,
    side_effect_classification: stage.side_effect_classification,
    risk_classification: stage.risk_classification,
    estimated_input_tokens: stage.estimated_input_tokens,
    estimated_output_tokens: stage.estimated_output_tokens,
    estimated_total_tokens: stage.estimated_total_tokens,
    estimated_cost_minor_units: stage.estimated_cost_minor_units,
    scheduler_stage_status: stageStatusById.get(stage.runtime_stage_reference_id)
  }));
  const schedulerStageRefById = new Map(schedulerStageRefs.map((r) => [r.runtime_stage_reference_id, r]));
  markValid('scheduler_stages_validated');

  // 21. Derive Scheduler Dependency References -- preserves source id/endpoints/type/required 1:1;
  // "would_block_target=true" only for required edges (nothing is ever satisfied in this PR).
  const schedulerDependencyRefs = dependencies.map((dep, index) => buildRuntimeSchedulerDependencyReference({
    scheduler_dependency_reference_id: `${packageRef.runtime_execution_package_id}-scheduler-dependency-${dep.runtime_dependency_reference_id}`,
    runtime_scheduler_package_id: `${request.runtime_scheduler_request_id}-package`,
    runtime_execution_package_id: packageRef.runtime_execution_package_id,
    source_runtime_dependency_reference_id: dep.runtime_dependency_reference_id,
    from_scheduler_stage_reference_id: schedulerStageRefById.get(dep.from_runtime_stage_id).scheduler_stage_reference_id,
    to_scheduler_stage_reference_id: schedulerStageRefById.get(dep.to_runtime_stage_id).scheduler_stage_reference_id,
    dependency_type: dep.dependency_type,
    required: dep.required === true,
    dependency_order: index,
    source_dependency_fingerprint: dep.dependency_fingerprint,
    dependency_validated: dep.dependency_validated === true,
    would_block_target: dep.required === true
  }));
  if (policy.fail_on_dependency_redirection === true && schedulerDependencyRefs.some((ref, index) => (
    ref.from_scheduler_stage_reference_id !== schedulerStageRefById.get(dependencies[index].from_runtime_stage_id).scheduler_stage_reference_id
    || ref.to_scheduler_stage_reference_id !== schedulerStageRefById.get(dependencies[index].to_runtime_stage_id).scheduler_stage_reference_id
  ))) {
    return finalize('SCHEDULER_DEPENDENCY_BLOCKED', ['scheduler_dependency_endpoint_redirected']);
  }
  markValid('scheduler_dependencies_validated');

  // 22. Derive Parallel Groups -- clustered by real topological depth (never accepted free-form
  // from the caller), restricted to parallelizable+eligible members.
  const eligibleParallelizableIds = sortedStages.filter((s) => s.parallelizable === true && stageStatusById.get(s.runtime_stage_reference_id) === SCHEDULER_STAGE_STATUSES_ORDER.ELIGIBLE)
    .map((s) => s.runtime_stage_reference_id);
  const depths = computeStageDepths(stages.map((s) => s.runtime_stage_reference_id), dependencies);
  const groupsByDepth = new Map();
  for (const id of eligibleParallelizableIds) {
    const depth = depths.get(id) || 0;
    if (!groupsByDepth.has(depth)) groupsByDepth.set(depth, []);
    groupsByDepth.get(depth).push(id);
  }
  const parallelGroupCandidates = [...groupsByDepth.entries()].filter(([, ids]) => ids.length >= 2).sort((a, b) => a[0] - b[0]);
  if (parallelGroupCandidates.length > policy.maximum_parallel_group_count) {
    return finalize('SCHEDULER_POLICY_BLOCKED', ['parallel_group_count_exceeds_policy_limit']);
  }
  if (parallelGroupCandidates.some(([, ids]) => ids.length > policy.maximum_stages_per_parallel_group)) {
    return finalize('SCHEDULER_POLICY_BLOCKED', ['parallel_group_size_exceeds_policy_limit']);
  }
  const parallelGroupRefs = parallelGroupCandidates.map(([, stageIds], sequence) => {
    const members = stageIds.map((id) => schedulerStageRefById.get(id));
    const memberModelCount = members.filter((m) => m.model_selection_reference_id !== null).length;
    const memberToolCount = members.filter((m) => Array.isArray(m.tool_reference_ids) && m.tool_reference_ids.length > 0).length;
    const memberWorkflowCount = members.filter((m) => m.workflow_reference_id !== null).length;
    const memberTokens = members.reduce((sum, m) => sum + m.estimated_total_tokens, 0);
    const memberCost = members.reduce((sum, m) => sum + m.estimated_cost_minor_units, 0);
    return buildRuntimeSchedulerParallelGroupReference({
      parallel_group_reference_id: `${packageRef.runtime_execution_package_id}-parallel-group-${sequence}`,
      runtime_scheduler_package_id: `${request.runtime_scheduler_request_id}-package`,
      runtime_execution_package_id: packageRef.runtime_execution_package_id,
      parallel_group_sequence: sequence,
      scheduler_stage_reference_ids: members.map((m) => m.scheduler_stage_reference_id),
      source_runtime_stage_reference_ids: stageIds,
      source_dependency_reference_ids: schedulerDependencyRefs.filter((d) => stageIds.some((id) => schedulerStageRefById.get(id).scheduler_stage_reference_id === d.to_scheduler_stage_reference_id)).map((d) => d.source_runtime_dependency_reference_id),
      required_stage_count: members.filter((m) => m.required === true).length,
      optional_stage_count: members.filter((m) => m.optional === true).length,
      model_stage_count: memberModelCount,
      tool_stage_count: memberToolCount,
      workflow_stage_count: memberWorkflowCount,
      estimated_total_tokens: memberTokens,
      estimated_total_cost_minor_units: memberCost,
      capacity_within_limit: capacitySnapshotRef.available_parallel_stage_capacity >= members.length,
      concurrency_within_limit: concurrencyRef.parallel_slots_available === true,
      budget_within_limit: budgetRef.tokens_within_limit === true && budgetRef.cost_within_limit === true
    });
  });
  if (policy.fail_on_parallel_group_mismatch === true && parallelGroupRefs.some((g) => g.parallel_group_validated !== true)) {
    return finalize('SCHEDULER_PARALLEL_GROUP_BLOCKED', ['parallel_group_limits_not_within_bounds']);
  }
  markValid('parallel_groups_validated');

  // 23. Derive Approval Wait References -- exclusively from `approval_required`.
  const approvalWaitRefs = sortedStages.filter((s) => s.approval_required === true).map((stage) => buildRuntimeSchedulerApprovalWaitReference({
    approval_wait_reference_id: `${packageRef.runtime_execution_package_id}-approval-wait-${stage.runtime_stage_reference_id}`,
    runtime_scheduler_package_id: `${request.runtime_scheduler_request_id}-package`,
    runtime_execution_package_id: packageRef.runtime_execution_package_id,
    scheduler_stage_reference_id: schedulerStageRefById.get(stage.runtime_stage_reference_id).scheduler_stage_reference_id,
    runtime_stage_reference_id: stage.runtime_stage_reference_id,
    approval_required: true,
    approval_validated: true
  }));
  if (policy.fail_on_approval_wait_mismatch === true && approvalWaitRefs.some((w) => w.approval_status !== 'WAITING_APPROVAL_REFERENCE')) {
    return finalize('SCHEDULER_APPROVAL_WAIT_BLOCKED', ['approval_wait_not_genuinely_waiting']);
  }
  markValid('approval_waits_validated');

  // 24. Derive Capacity Plan -- requested_* derived from the real Runtime Stage Manifest, never
  // accepted as caller-declared; available_* derived from the real Capacity Snapshot.
  const requestedByDimension = {
    requested_package_slots: 1,
    requested_stage_slots: stageManifest.runtime_stage_count,
    requested_parallel_stage_slots: stageManifest.parallel_stage_count,
    requested_model_stage_slots: stageManifest.model_stage_count,
    requested_tool_stage_slots: stageManifest.tool_stage_count,
    requested_workflow_stage_slots: stageManifest.workflow_stage_count,
    requested_tokens: stageManifest.estimated_total_tokens,
    requested_cost_minor_units: stageManifest.estimated_total_cost_minor_units
  };
  const availableByDimension = {};
  for (const [totalField, , availableField] of CAPACITY_DIMENSIONS) {
    availableByDimension[totalField] = capacitySnapshotRef[availableField];
  }
  const capacityPlanRef = buildRuntimeSchedulerCapacityPlanReference({
    scheduler_capacity_plan_reference_id: `${packageRef.runtime_execution_package_id}-scheduler-capacity-plan`,
    runtime_scheduler_package_id: `${request.runtime_scheduler_request_id}-package`,
    runtime_execution_package_id: packageRef.runtime_execution_package_id,
    runtime_capacity_snapshot_reference_id: capacitySnapshotRef.runtime_capacity_snapshot_reference_id,
    runtime_concurrency_reference_id: concurrencyRef.runtime_concurrency_reference_id,
    requested_package_slots: requestedByDimension.requested_package_slots,
    available_package_slots: capacitySnapshotRef.available_package_capacity,
    requested_stage_slots: requestedByDimension.requested_stage_slots,
    available_stage_slots: capacitySnapshotRef.available_stage_capacity,
    requested_parallel_stage_slots: requestedByDimension.requested_parallel_stage_slots,
    available_parallel_stage_slots: capacitySnapshotRef.available_parallel_stage_capacity,
    requested_model_stage_slots: requestedByDimension.requested_model_stage_slots,
    available_model_stage_slots: capacitySnapshotRef.available_model_stage_capacity,
    requested_tool_stage_slots: requestedByDimension.requested_tool_stage_slots,
    available_tool_stage_slots: capacitySnapshotRef.available_tool_stage_capacity,
    requested_workflow_stage_slots: requestedByDimension.requested_workflow_stage_slots,
    available_workflow_stage_slots: capacitySnapshotRef.available_workflow_stage_capacity,
    requested_tokens: requestedByDimension.requested_tokens,
    available_tokens: capacitySnapshotRef.available_tokens_capacity,
    requested_cost_minor_units: requestedByDimension.requested_cost_minor_units,
    available_cost_minor_units: capacitySnapshotRef.available_cost_capacity_minor_units
  });
  if (capacityPlanRef.capacity_plan_validated !== true) {
    return finalize('SCHEDULER_CAPACITY_BLOCKED', ['scheduler_capacity_plan_not_within_limits']);
  }
  markValid('capacity_plan_validated');

  // 25-26. Derive Queue Plan -- the already-sorted (step 20) stage list becomes the ordered queue;
  // each stage falls into exactly one of the 5 eligibility categories.
  const eligibleIds = sortedStages.filter((s) => stageStatusById.get(s.runtime_stage_reference_id) === SCHEDULER_STAGE_STATUSES_ORDER.ELIGIBLE).map((s) => schedulerStageRefById.get(s.runtime_stage_reference_id).scheduler_stage_reference_id);
  const waitingDependencyIds = sortedStages.filter((s) => stageStatusById.get(s.runtime_stage_reference_id) === SCHEDULER_STAGE_STATUSES_ORDER.WAITING_DEPENDENCY).map((s) => schedulerStageRefById.get(s.runtime_stage_reference_id).scheduler_stage_reference_id);
  const waitingApprovalIds = sortedStages.filter((s) => stageStatusById.get(s.runtime_stage_reference_id) === SCHEDULER_STAGE_STATUSES_ORDER.WAITING_APPROVAL).map((s) => schedulerStageRefById.get(s.runtime_stage_reference_id).scheduler_stage_reference_id);
  const optionalIds = sortedStages.filter((s) => stageStatusById.get(s.runtime_stage_reference_id) === SCHEDULER_STAGE_STATUSES_ORDER.OPTIONAL).map((s) => schedulerStageRefById.get(s.runtime_stage_reference_id).scheduler_stage_reference_id);
  const blockedIds = sortedStages.filter((s) => stageStatusById.get(s.runtime_stage_reference_id) === SCHEDULER_STAGE_STATUSES_ORDER.BLOCKED).map((s) => schedulerStageRefById.get(s.runtime_stage_reference_id).scheduler_stage_reference_id);

  const queuePlanRef = buildRuntimeSchedulerQueuePlanReference({
    scheduler_queue_plan_reference_id: `${packageRef.runtime_execution_package_id}-scheduler-queue-plan`,
    runtime_scheduler_package_id: `${request.runtime_scheduler_request_id}-package`,
    runtime_execution_package_id: packageRef.runtime_execution_package_id,
    ordered_scheduler_stage_reference_ids: sortedStages.map((s) => schedulerStageRefById.get(s.runtime_stage_reference_id).scheduler_stage_reference_id),
    eligible_scheduler_stage_reference_ids: eligibleIds,
    waiting_dependency_stage_reference_ids: waitingDependencyIds,
    waiting_approval_stage_reference_ids: waitingApprovalIds,
    optional_stage_reference_ids: optionalIds,
    blocked_stage_reference_ids: blockedIds,
    parallel_group_reference_ids: parallelGroupRefs.map((g) => g.parallel_group_reference_id),
    approval_wait_reference_ids: approvalWaitRefs.map((w) => w.approval_wait_reference_id)
  });
  if (queuePlanRef.queue_plan_validated !== true) {
    return finalize('SCHEDULER_QUEUE_PLAN_BLOCKED', ['scheduler_queue_plan_order_or_partition_invalid']);
  }
  markValid('queue_plan_validated');

  // 29. Non-execution invariants.
  if (
    admissionResultRef.executed === true || admissionResultRef.runtime_enabled === true
    || readinessDecisionRef.runtime_enabled === true
  ) {
    return finalize('SCHEDULER_VALIDATION_FAILED', ['non_execution_invariant_violated']);
  }
  markValid('non_execution_invariants_validated');

  markValid('package_fingerprint_validated');
  markValid('package_digest_validated');

  // 27-28. Emit the prepared outcome -- package fingerprint/digest are computed inside
  // buildSchedulerOutcome, over the exact derived data this evaluation produced.
  return finalize('SCHEDULER_PACKAGE_PREPARED_SIMULATION', ['scheduler_package_prepared_in_simulation_only'], {
    schedulerStageRefs, schedulerDependencyRefs, parallelGroupRefs, approvalWaitRefs, capacityPlanRef, queuePlanRef,
    stageManifest, dependencyManifest
  });
}

function buildSchedulerOutcome(status, reasonCodes, ctx, validatedFlags) {
  const {
    request, requestFingerprint, canonical, admissionDecisionRef, admissionResultRef, packageRef,
    capacitySnapshotRef, concurrencyRef, freshnessRef, idempotencyReference,
    schedulerStageRefs = [], schedulerDependencyRefs = [], parallelGroupRefs = [], approvalWaitRefs = [],
    capacityPlanRef, queuePlanRef, stageManifest, dependencyManifest, budgetRef
  } = ctx;
  const requestSafe = isPlainObject(request) ? request : {};
  const admissionDecisionSafe = isPlainObject(admissionDecisionRef) ? admissionDecisionRef : {};
  const admissionResultSafe = isPlainObject(admissionResultRef) ? admissionResultRef : {};
  const packageSafe = isPlainObject(packageRef) ? packageRef : {};
  const capacitySafe = isPlainObject(capacitySnapshotRef) ? capacitySnapshotRef : {};
  const concurrencySafe = isPlainObject(concurrencyRef) ? concurrencyRef : {};
  const freshnessSafe = isPlainObject(freshnessRef) ? freshnessRef : {};
  const idempotencySafe = isPlainObject(idempotencyReference) ? idempotencyReference : {};
  const stageManifestSafe = isPlainObject(stageManifest) ? stageManifest : {};
  const dependencyManifestSafe = isPlainObject(dependencyManifest) ? dependencyManifest : {};
  const budgetSafe = isPlainObject(budgetRef) ? budgetRef : {};
  const canonicalSafe = canonical || {};

  const schedulerRequestId = requestSafe.runtime_scheduler_request_id || 'runtime_scheduler_request_not_available';
  const schedulerPackageId = `${schedulerRequestId}-package`;

  const pkg = buildRuntimeSchedulerPackage({
    runtime_scheduler_package_id: schedulerPackageId,
    runtime_scheduler_request_id: schedulerRequestId,
    runtime_admission_request_id: admissionDecisionSafe.runtime_admission_request_id || 'runtime_admission_request_not_available',
    runtime_admission_decision_id: admissionDecisionSafe.runtime_admission_decision_id || 'runtime_admission_decision_not_available',
    runtime_admission_result_id: admissionResultSafe.runtime_admission_result_id || 'runtime_admission_result_not_available',
    runtime_readiness_decision_id: admissionDecisionSafe.runtime_readiness_decision_id || 'runtime_readiness_decision_not_available',
    runtime_execution_package_id: packageSafe.runtime_execution_package_id || 'runtime_execution_package_not_available',
    runtime_stage_manifest_id: stageManifestSafe.runtime_stage_manifest_id || 'runtime_stage_manifest_not_available',
    runtime_dependency_manifest_id: dependencyManifestSafe.runtime_dependency_manifest_id || 'runtime_dependency_manifest_not_available',
    runtime_budget_reference_id: budgetSafe.runtime_budget_reference_id || 'runtime_budget_reference_not_available',
    runtime_capacity_snapshot_reference_id: capacitySafe.runtime_capacity_snapshot_reference_id || 'runtime_capacity_snapshot_reference_not_available',
    runtime_concurrency_reference_id: concurrencySafe.runtime_concurrency_reference_id || 'runtime_concurrency_reference_not_available',
    runtime_freshness_reference_id: freshnessSafe.runtime_readiness_freshness_reference_id || 'runtime_freshness_reference_not_available',
    runtime_replay_reference_id: 'runtime_replay_reference_not_available',
    idempotency_reference_id: idempotencySafe.idempotency_reference_id || 'idempotency_reference_not_available',
    scheduler_capacity_plan_reference_id: (capacityPlanRef && capacityPlanRef.scheduler_capacity_plan_reference_id) || `${schedulerPackageId}-no-capacity-plan`,
    scheduler_queue_plan_reference_id: (queuePlanRef && queuePlanRef.scheduler_queue_plan_reference_id) || `${schedulerPackageId}-no-queue-plan`,
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    scheduler_status: status,
    scheduler_stage_reference_ids: schedulerStageRefs.map((s) => s.scheduler_stage_reference_id),
    scheduler_dependency_reference_ids: schedulerDependencyRefs.map((d) => d.scheduler_dependency_reference_id),
    parallel_group_reference_ids: parallelGroupRefs.map((g) => g.parallel_group_reference_id),
    approval_wait_reference_ids: approvalWaitRefs.map((w) => w.approval_wait_reference_id),
    ordered_scheduler_stage_reference_ids: queuePlanRef ? queuePlanRef.ordered_scheduler_stage_reference_ids : [],
    eligible_scheduler_stage_reference_ids: queuePlanRef ? queuePlanRef.eligible_scheduler_stage_reference_ids : [],
    waiting_dependency_stage_reference_ids: queuePlanRef ? queuePlanRef.waiting_dependency_stage_reference_ids : [],
    waiting_approval_stage_reference_ids: queuePlanRef ? queuePlanRef.waiting_approval_stage_reference_ids : [],
    optional_stage_reference_ids: queuePlanRef ? queuePlanRef.optional_stage_reference_ids : [],
    blocked_stage_reference_ids: queuePlanRef ? queuePlanRef.blocked_stage_reference_ids : [],
    scheduler_stage_count: schedulerStageRefs.length,
    scheduler_dependency_count: schedulerDependencyRefs.length,
    parallel_group_count: parallelGroupRefs.length,
    approval_wait_count: approvalWaitRefs.length,
    model_stage_count: schedulerStageRefs.filter((s) => s.model_selection_reference_id !== null).length,
    tool_stage_count: schedulerStageRefs.filter((s) => Array.isArray(s.tool_reference_ids) && s.tool_reference_ids.length > 0).length,
    workflow_stage_count: schedulerStageRefs.filter((s) => s.workflow_reference_id !== null).length,
    parallel_stage_count: schedulerStageRefs.filter((s) => s.parallelizable === true).length,
    optional_stage_count: schedulerStageRefs.filter((s) => s.optional === true).length,
    approval_stage_count: schedulerStageRefs.filter((s) => s.approval_required === true).length,
    estimated_input_tokens: schedulerStageRefs.reduce((sum, s) => sum + s.estimated_input_tokens, 0),
    estimated_output_tokens: schedulerStageRefs.reduce((sum, s) => sum + s.estimated_output_tokens, 0),
    estimated_total_tokens: schedulerStageRefs.reduce((sum, s) => sum + s.estimated_total_tokens, 0),
    estimated_total_cost_minor_units: schedulerStageRefs.reduce((sum, s) => sum + s.estimated_cost_minor_units, 0),
    runtime_admission_decision_fingerprint: admissionDecisionSafe.runtime_admission_request_fingerprint || 'fingerprint_not_available',
    runtime_admission_result_fingerprint: computeCanonicalContentDigest(admissionResultSafe),
    runtime_execution_package_fingerprint: packageSafe.package_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_digest: packageSafe.package_digest || 'digest_not_available',
    runtime_stage_manifest_fingerprint: stageManifestSafe.manifest_fingerprint || 'fingerprint_not_available',
    runtime_dependency_manifest_fingerprint: dependencyManifestSafe.manifest_fingerprint || 'fingerprint_not_available',
    runtime_budget_fingerprint: budgetSafe.budget_fingerprint || 'fingerprint_not_available',
    runtime_capacity_snapshot_fingerprint: capacitySafe.capacity_fingerprint || 'fingerprint_not_available',
    runtime_concurrency_fingerprint: concurrencySafe.concurrency_fingerprint || 'fingerprint_not_available',
    runtime_freshness_fingerprint: freshnessSafe.freshness_fingerprint || 'fingerprint_not_available',
    runtime_replay_fingerprint: 'fingerprint_not_available',
    idempotency_fingerprint: idempotencySafe.idempotency_fingerprint || 'fingerprint_not_available',
    scheduler_stage_fingerprints: schedulerStageRefs.map((s) => s.stage_fingerprint),
    scheduler_dependency_fingerprints: schedulerDependencyRefs.map((d) => d.dependency_fingerprint),
    parallel_group_fingerprints: parallelGroupRefs.map((g) => g.parallel_group_fingerprint),
    approval_wait_fingerprints: approvalWaitRefs.map((w) => w.approval_wait_fingerprint),
    scheduler_capacity_plan_fingerprint: (capacityPlanRef && capacityPlanRef.capacity_plan_fingerprint) || 'fingerprint_not_available',
    scheduler_queue_plan_fingerprint: (queuePlanRef && queuePlanRef.queue_plan_fingerprint) || 'fingerprint_not_available'
  });

  const decision = buildRuntimeSchedulerDecision({
    runtime_scheduler_decision_id: `${schedulerRequestId}-decision`,
    runtime_scheduler_request_id: schedulerRequestId,
    runtime_scheduler_package_id: pkg.runtime_scheduler_package_id,
    runtime_admission_decision_id: pkg.runtime_admission_decision_id,
    runtime_admission_result_id: pkg.runtime_admission_result_id,
    runtime_execution_package_id: pkg.runtime_execution_package_id,
    tenant_id: pkg.tenant_id,
    organization_id: pkg.organization_id,
    project_id: pkg.project_id,
    session_reference_id: pkg.session_reference_id,
    agent_id: pkg.agent_id,
    actor_id: pkg.actor_id,
    status,
    runtime_scheduler_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    runtime_scheduler_package_fingerprint: pkg.scheduler_package_fingerprint,
    runtime_scheduler_package_digest: pkg.scheduler_package_digest,
    runtime_admission_decision_fingerprint: pkg.runtime_admission_decision_fingerprint,
    runtime_admission_result_fingerprint: pkg.runtime_admission_result_fingerprint,
    runtime_execution_package_fingerprint: pkg.runtime_execution_package_fingerprint,
    runtime_execution_package_digest: pkg.runtime_execution_package_digest,
    runtime_capacity_snapshot_fingerprint: pkg.runtime_capacity_snapshot_fingerprint,
    runtime_concurrency_fingerprint: pkg.runtime_concurrency_fingerprint,
    runtime_freshness_fingerprint: pkg.runtime_freshness_fingerprint,
    runtime_replay_fingerprint: pkg.runtime_replay_fingerprint,
    idempotency_fingerprint: pkg.idempotency_fingerprint,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  const result = buildRuntimeSchedulerResult({
    runtime_scheduler_result_id: `${schedulerRequestId}-result`,
    runtime_scheduler_request_id: schedulerRequestId,
    runtime_scheduler_decision_id: decision.runtime_scheduler_decision_id,
    runtime_scheduler_package_id: decision.runtime_scheduler_package_id,
    runtime_admission_decision_id: decision.runtime_admission_decision_id,
    runtime_admission_result_id: decision.runtime_admission_result_id,
    runtime_execution_package_id: decision.runtime_execution_package_id,
    tenant_id: decision.tenant_id,
    organization_id: decision.organization_id,
    project_id: decision.project_id,
    session_reference_id: decision.session_reference_id,
    agent_id: decision.agent_id,
    actor_id: decision.actor_id,
    status,
    runtime_scheduler_request_fingerprint: decision.runtime_scheduler_request_fingerprint,
    runtime_scheduler_decision_fingerprint: computeCanonicalContentDigest(decision),
    runtime_scheduler_package_fingerprint: decision.runtime_scheduler_package_fingerprint,
    runtime_scheduler_package_digest: decision.runtime_scheduler_package_digest,
    registry_version: String(requestSafe.expected_scheduler_registry_version || 'registry_version_not_available'),
    scheduler_stage_count: pkg.scheduler_stage_count,
    scheduler_dependency_count: pkg.scheduler_dependency_count,
    parallel_group_count: pkg.parallel_group_count,
    approval_wait_count: pkg.approval_wait_count,
    eligible_stage_count: pkg.eligible_scheduler_stage_reference_ids.length,
    waiting_dependency_stage_count: pkg.waiting_dependency_stage_reference_ids.length,
    waiting_approval_stage_count: pkg.waiting_approval_stage_reference_ids.length,
    optional_stage_count: pkg.optional_stage_reference_ids.length,
    blocked_stage_count: pkg.blocked_stage_reference_ids.length,
    estimated_input_tokens: pkg.estimated_input_tokens,
    estimated_output_tokens: pkg.estimated_output_tokens,
    estimated_total_tokens: pkg.estimated_total_tokens,
    estimated_total_cost_minor_units: pkg.estimated_total_cost_minor_units,
    blockers: reasonCodes,
    reason_codes: reasonCodes
  });

  const audit = buildRuntimeSchedulerAudit({
    decision, result, capacityPlan: capacityPlanRef || {}, logicalSequence: requestSafe.logical_sequence
  });

  return { decision, result, audit, package: pkg, schedulerStageRefs, schedulerDependencyRefs, parallelGroupRefs, approvalWaitRefs, capacityPlanRef, queuePlanRef };
}

module.exports = {
  computeAdmissionRequestFingerprint,
  evaluateRuntimeSchedulerRequest,
  omitReplayReference
};
