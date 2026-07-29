'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { checkIdentity, computeRuntimePackageDigest } = require('./runtime-execution-package');
const { validateRuntimeReadinessRequest } = require('./runtime-readiness-request');
const { buildRuntimeReadinessDecision } = require('./runtime-readiness-decision');
const { validateRuntimeAdmissionRequest } = require('./runtime-admission-request');
const { buildRuntimeAdmissionDecision } = require('./runtime-admission-decision');
const { buildRuntimeAdmissionResult } = require('./runtime-admission-result');
const { buildRuntimeAdmissionAudit } = require('./runtime-admission-audit');
const { CAPACITY_DIMENSIONS } = require('./runtime-capacity-snapshot-reference');
const { FRESHNESS_DIMENSIONS } = require('./runtime-readiness-freshness-reference');

// pr104: the two-phase boundary this PR exists to build. Phase A (Readiness) independently
// re-derives everything the PR #103 Runtime Execution Package already claimed, plus the 4 genuinely
// new dimensions (freshness, replay, capacity, concurrency) this PR introduces -- "um
// self-fingerprint válido não substitui o cross-check". Phase B (Admission) only ever runs against
// an already-RUNTIME_READY_SIMULATION readiness decision, and adds identity/policy-limit checks on
// top. Neither phase ever enables a runtime, starts a scheduler, creates a job/queue/worker,
// reserves capacity, consumes a concurrency slot, or applies a dependency/stop/compensation --
// every one of those flags is forced false in every outcome this boundary can ever produce (see
// buildReadinessOutcome/buildAdmissionOutcome below).

function arraysEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}

// Returns a shallow copy of `obj` with `runtime_readiness_replay_reference` genuinely removed as an
// own key -- never merely set to `undefined`. agent-identity-contract.js's own stableCanonicalize
// throws `undefined_not_serializable` the moment it recurses into ANY own-enumerable key whose
// value is `undefined` (it does not silently skip such keys the way JSON.stringify does), so
// `{ ...obj, field: undefined }` does not "exclude" a field from a canonical digest -- it corrupts
// the whole digest into a fixed `digest_invalid::undefined_not_serializable` sentinel, which then
// trivially (and meaninglessly) satisfies any subsequent equality check between two independently
// "excluded" copies. Every self-fingerprinted contract in this codebase already avoids this via
// real destructuring (see e.g. runtime-budget-simulation-reference.js's own
// `const { budget_fingerprint, ...rest } = reference`); this helper applies that same discipline
// to the one nested field (`runtime_readiness_replay_reference`) that both Phase A and Phase B need
// to exclude from their own request digests to avoid a circular self-reference.
function omitReplayReference(obj) {
  if (!isPlainObject(obj)) return obj;
  const { runtime_readiness_replay_reference, ...rest } = obj;
  return rest;
}

// --- Phase A: Readiness ----------------------------------------------------------------------

function evaluateRuntimeReadinessRequest(request, context = {}) {
  void context; // never consulted for any decision -- kept only for call-shape compatibility.
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  const requestIsObject = isPlainObject(request);
  const policy = requestIsObject ? request.runtime_readiness_policy : undefined;
  const packageRef = requestIsObject ? request.runtime_execution_package_reference : undefined;
  const decisionRef = requestIsObject ? request.runtime_execution_simulation_decision_reference : undefined;
  const resultRef = requestIsObject ? request.runtime_execution_simulation_result_reference : undefined;
  const gatewayDecision = requestIsObject ? request.gateway_decision_reference : undefined;
  const gatewayResult = requestIsObject ? request.gateway_result_reference : undefined;
  const gatewayPackageRef = requestIsObject ? request.gateway_package_reference : undefined;
  const plan = requestIsObject ? request.execution_plan_reference : undefined;
  const planResult = requestIsObject ? request.execution_plan_result_reference : undefined;
  const provenanceRef = requestIsObject ? request.authorization_provenance_reference : undefined;
  const scopeRef = requestIsObject ? request.authorization_scope_reference : undefined;
  const snapshotRef = requestIsObject ? request.registry_snapshot_reference : undefined;
  const evidenceRef = requestIsObject ? request.architecture_gate_evidence_reference : undefined;
  const stageManifestRef = requestIsObject ? request.stage_manifest_reference : undefined;
  const dependencyGraphRef = requestIsObject ? request.dependency_graph_reference : undefined;
  const bindingLedger = requestIsObject ? request.binding_ledger_reference : undefined;
  const validationLedger = requestIsObject ? request.validation_ledger_reference : undefined;
  const executionBudgetReference = requestIsObject ? request.execution_budget_reference : undefined;
  const runtimeStageManifest = requestIsObject ? request.runtime_stage_manifest_reference : undefined;
  const runtimeDependencyManifest = requestIsObject ? request.runtime_dependency_manifest_reference : undefined;
  const runtimeBudgetRef = requestIsObject ? request.runtime_budget_reference : undefined;
  const runtimeStopRefs = requestIsObject && Array.isArray(request.runtime_stop_references) ? request.runtime_stop_references : [];
  const runtimeCompensationRefs = requestIsObject && Array.isArray(request.runtime_compensation_references) ? request.runtime_compensation_references : [];
  const runtimeArtifactPlan = requestIsObject ? request.runtime_artifact_plan_reference : undefined;
  const runtimeEventPlan = requestIsObject ? request.runtime_event_plan_reference : undefined;
  const capacitySnapshotRef = requestIsObject ? request.runtime_capacity_snapshot_reference : undefined;
  const concurrencyRef = requestIsObject ? request.runtime_concurrency_reference : undefined;
  const freshnessRef = requestIsObject ? request.runtime_readiness_freshness_reference : undefined;
  const replayRef = requestIsObject ? request.runtime_readiness_replay_reference : undefined;

  const canonical = {
    tenantId: isPlainObject(plan) ? plan.tenant_id : undefined,
    organizationId: isPlainObject(plan) ? plan.organization_id : undefined,
    projectId: isPlainObject(plan) ? plan.project_id : undefined,
    sessionId: isPlainObject(plan) ? plan.session_reference_id : undefined,
    agentId: isPlainObject(plan) ? plan.agent_id : undefined,
    actorId: isPlainObject(gatewayPackageRef) ? gatewayPackageRef.actor_id : undefined
  };

  // Excludes runtime_readiness_replay_reference from its own input -- that reference's own
  // readiness_request_fingerprint field exists specifically to describe this request, so including
  // it here would make the digest depend on itself (no fixed point exists, the same reason every
  // other self-fingerprinted contract in this codebase excludes its own fingerprint/digest field
  // before hashing).
  const requestForFingerprint = requestIsObject ? omitReplayReference(request) : request;
  const requestFingerprint = computeCanonicalContentDigest(requestForFingerprint);

  function finalize(status, reasonCodes) {
    return buildReadinessOutcome(status, reasonCodes, {
      request, requestFingerprint, canonical, packageRef, decisionRef, resultRef, capacitySnapshotRef,
      concurrencyRef, freshnessRef, replayRef
    }, validatedFlags);
  }

  // 1. Request contract shape, including every nested reference against its own real validator.
  const requestValidation = validateRuntimeReadinessRequest(request);
  if (!requestValidation.valid) {
    return finalize('RUNTIME_READINESS_VALIDATION_FAILED', ['runtime_readiness_request_invalid']);
  }
  markValid('request_validated');

  // 9. Identity -- evaluated early, matching the real precedence order (RUNTIME_READINESS_PRECEDENCE_
  // ORDER lists identity ahead of policy), the same "declared Fase order != real evaluation order"
  // split runtime-execution-package.js's own evaluator already established.
  const identityChecks = [
    ['runtime_execution_package_reference', packageRef], ['execution_plan_result_reference', planResult],
    ['stage_manifest_reference', stageManifestRef], ['dependency_graph_reference', dependencyGraphRef],
    ['binding_ledger_reference', bindingLedger], ['validation_ledger_reference', validationLedger],
    ['authorization_provenance_reference', provenanceRef], ['authorization_scope_reference', scopeRef],
    ['registry_snapshot_reference', snapshotRef], ['gateway_decision_reference', gatewayDecision],
    ['gateway_result_reference', gatewayResult], ['execution_budget_reference', executionBudgetReference],
    ['runtime_capacity_snapshot_reference', capacitySnapshotRef], ['runtime_concurrency_reference', concurrencyRef]
  ];
  for (const [label, reference] of identityChecks) {
    const mismatch = checkIdentity(reference, canonical, label);
    if (mismatch) return finalize(mismatch.status, [mismatch.reason]);
  }

  // 2-3. Readiness Policy -- every require_* flag is structurally forced true (already proven by
  // the request's own nested validator); the 6 allow_*_package flags are genuinely re-checked
  // against the real stage composition the Runtime Stage Manifest declares, and
  // allow_external_effect_reference/allow_irreversible_reference remain forced false.
  const runtimeStages = isPlainObject(runtimeStageManifest) && Array.isArray(runtimeStageManifest.runtime_stage_references)
    ? runtimeStageManifest.runtime_stage_references : [];
  const stageTypes = new Set(runtimeStages.map((stage) => stage.stage_type));
  const hasModelStage = stageTypes.has('MODEL_REFERENCE_STAGE') || runtimeStages.some((stage) => stage.model_selection_reference_id !== null);
  const isNoLlmPackage = !hasModelStage;
  if (isNoLlmPackage && policy.allow_no_llm_package !== true) return finalize('RUNTIME_READINESS_POLICY_BLOCKED', ['no_llm_package_not_allowed_by_readiness_policy']);
  if (hasModelStage && policy.allow_model_reference_package !== true) return finalize('RUNTIME_READINESS_POLICY_BLOCKED', ['model_reference_package_not_allowed_by_readiness_policy']);
  if (stageTypes.has('TOOL_REFERENCE_STAGE') && policy.allow_tool_reference_package !== true) return finalize('RUNTIME_READINESS_POLICY_BLOCKED', ['tool_reference_package_not_allowed_by_readiness_policy']);
  if (stageTypes.has('WORKFLOW_REFERENCE_STAGE') && policy.allow_workflow_reference_package !== true) return finalize('RUNTIME_READINESS_POLICY_BLOCKED', ['workflow_reference_package_not_allowed_by_readiness_policy']);
  if (runtimeStages.some((stage) => stage.parallelizable === true) && policy.allow_parallel_package !== true) return finalize('RUNTIME_READINESS_POLICY_BLOCKED', ['parallel_package_not_allowed_by_readiness_policy']);
  if (runtimeStages.some((stage) => stage.approval_required === true) && policy.allow_human_approval_reference !== true) return finalize('RUNTIME_READINESS_POLICY_BLOCKED', ['human_approval_reference_not_allowed_by_readiness_policy']);
  if (runtimeStages.some((stage) => stage.side_effect_classification === 'EXTERNAL_EFFECT_REFERENCE')) return finalize('RUNTIME_READINESS_POLICY_BLOCKED', ['external_effect_reference_never_allowed']);
  if (runtimeStages.some((stage) => stage.side_effect_classification === 'IRREVERSIBLE_REFERENCE')) return finalize('RUNTIME_READINESS_POLICY_BLOCKED', ['irreversible_reference_never_allowed']);
  markValid('policy_validated');

  // 4-6. Runtime Package / Decision / Result -- "continua íntegro" starts with re-proving these
  // three PR #103 outputs are still mutually consistent, never trusted merely because each one is
  // individually structurally valid.
  if (packageRef.runtime_status !== 'RUNTIME_PACKAGE_PREPARED_SIMULATION' || packageRef.runtime_package_prepared_in_simulation !== true || packageRef.runtime_admitted_in_simulation !== false) {
    return finalize('RUNTIME_PACKAGE_BLOCKED', ['runtime_package_not_prepared']);
  }
  if (
    decisionRef.status !== packageRef.runtime_status || decisionRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || decisionRef.runtime_package_fingerprint !== packageRef.package_fingerprint || decisionRef.runtime_package_digest !== packageRef.package_digest
    || decisionRef.runtime_package_prepared_in_simulation !== true || decisionRef.runtime_admitted_in_simulation !== false
  ) {
    return finalize('RUNTIME_PACKAGE_BLOCKED', ['runtime_execution_simulation_decision_mismatch']);
  }
  if (
    resultRef.status !== decisionRef.status || resultRef.runtime_decision_id !== decisionRef.runtime_decision_id
    || resultRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || resultRef.runtime_package_fingerprint !== packageRef.package_fingerprint
  ) {
    return finalize('RUNTIME_PACKAGE_BLOCKED', ['runtime_execution_simulation_result_mismatch']);
  }
  markValid('runtime_package_validated');

  // 7. Gateway.
  if (
    gatewayDecision.status !== 'GATEWAY_ACCEPTED_SIMULATION' || gatewayDecision.gateway_accepted_in_simulation !== true
    || gatewayResult.status !== 'GATEWAY_ACCEPTED_SIMULATION' || gatewayResult.gateway_accepted_in_simulation !== true
    || gatewayDecision.gateway_decision_id !== packageRef.gateway_decision_id
    || gatewayResult.gateway_result_id !== packageRef.gateway_result_id
    || gatewayPackageRef.gateway_package_reference_id !== packageRef.gateway_package_reference_id
  ) {
    return finalize('RUNTIME_GATEWAY_BLOCKED', ['gateway_not_accepted_or_mismatched']);
  }
  markValid('gateway_validated');

  // 8. Execution Plan.
  if (
    plan.execution_plan_status !== 'EXECUTION_PLAN_PREPARED_SIMULATION' || plan.execution_plan_id !== packageRef.execution_plan_id
    || planResult.execution_plan_id !== plan.execution_plan_id || planResult.result_id !== packageRef.execution_plan_result_id
  ) {
    return finalize('RUNTIME_EXECUTION_PLAN_BLOCKED', ['execution_plan_not_prepared_or_mismatched']);
  }
  markValid('execution_plan_validated');

  // 10. Authorization -- pr104fix FIX #1: a different provenance object sharing the same id (with
  // its own, validly self-consistent content) must never silently substitute the one the Gateway
  // actually accepted. AuthorizationProvenanceReference carries no self-fingerprint field of its
  // own; the Execution Plan carries the authoritative copy of that fingerprint (the exact value
  // execution-gateway-boundary.js itself already cross-checked at Gateway time -- see its own
  // `[packageRef.authorization_provenance_fingerprint, plan.authorization_provenance_fingerprint]`
  // comparison), so that copy is reused here rather than trusting mere id equality.
  if (
    provenanceRef.authorization_provenance_reference_id !== packageRef.authorization_provenance_reference_id
    || provenanceRef.authorization_decision_id !== gatewayPackageRef.authorization_decision_id
    || plan.authorization_provenance_fingerprint !== gatewayPackageRef.authorization_provenance_fingerprint
  ) {
    return finalize('RUNTIME_AUTHORIZATION_BLOCKED', ['authorization_provenance_reference_mismatch']);
  }
  markValid('authorization_validated');

  // 11. Scope -- pr104fix FIX #1: bound by its own real self-fingerprint (`scope_fingerprint`)
  // against the Gateway Package's declared copy, never by id alone.
  if (
    scopeRef.authorization_scope_reference_id !== packageRef.authorization_scope_reference_id
    || scopeRef.authorization_decision_id !== gatewayPackageRef.authorization_decision_id
    || scopeRef.scope_fingerprint !== gatewayPackageRef.authorization_scope_fingerprint
  ) {
    return finalize('RUNTIME_SCOPE_BLOCKED', ['authorization_scope_reference_mismatch']);
  }
  markValid('authorization_scope_validated');

  // 12. Registry snapshot -- pr104fix FIX #1: bound by its own real self-fingerprint
  // (`snapshot_fingerprint`) against the Gateway Package's declared copy, plus the execution plan
  // binding it declares and its own internal expected/observed version consistency
  // (`snapshot_consistent`).
  if (
    snapshotRef.registry_snapshot_reference_id !== packageRef.registry_snapshot_reference_id
    || snapshotRef.snapshot_fingerprint !== gatewayPackageRef.registry_snapshot_fingerprint
    || snapshotRef.execution_plan_id !== plan.execution_plan_id
    || snapshotRef.snapshot_consistent !== true
  ) {
    return finalize('RUNTIME_REGISTRY_BLOCKED', ['registry_snapshot_reference_mismatch']);
  }
  markValid('registry_snapshot_validated');

  // 13. Architecture gate evidence -- genuinely new: PR #103 never validated this as a blocking
  // gate. pr104fix FIX #1: bound by its own real self-fingerprint (`evidence_fingerprint`) against
  // the Gateway Package's declared copy -- commit SHA/ruleset/gate-result tampering is caught
  // transitively through this fingerprint, since each is part of what `evidence_fingerprint` itself
  // hashes over (see architecture-gate-evidence-reference.js's own computeEvidenceFingerprint).
  if (
    evidenceRef.evidence_status !== 'ARCHITECTURE_GATES_PASSED_SIMULATION' || evidenceRef.all_required_gates_passed !== true
    || evidenceRef.expired_logically !== false || evidenceRef.evidence_validated !== true
    || evidenceRef.evidence_fingerprint !== gatewayPackageRef.architecture_gate_evidence_fingerprint
  ) {
    return finalize('RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED', ['architecture_gate_evidence_not_passed_or_expired']);
  }
  markValid('architecture_gate_evidence_validated');

  // 14-15. Stage Manifest (source + Runtime Stage Manifest).
  if (
    stageManifestRef.stage_manifest_reference_id !== packageRef.stage_manifest_reference_id
    || stageManifestRef.manifest_fingerprint !== packageRef.stage_manifest_fingerprint
    || runtimeStageManifest.runtime_stage_manifest_id !== packageRef.runtime_stage_manifest_id
    || runtimeStageManifest.manifest_fingerprint !== packageRef.runtime_stage_manifest_fingerprint
    || runtimeStageManifest.manifest_validated !== true
  ) {
    return finalize('RUNTIME_STAGE_MANIFEST_BLOCKED', ['stage_manifest_or_runtime_stage_manifest_mismatch']);
  }
  markValid('stage_manifest_validated');

  // 16-17. Dependency Graph (source + Runtime Dependency Manifest).
  if (
    dependencyGraphRef.dependency_graph_reference_id !== packageRef.dependency_graph_reference_id
    || dependencyGraphRef.graph_fingerprint !== packageRef.dependency_graph_fingerprint
    || runtimeDependencyManifest.runtime_dependency_manifest_id !== packageRef.runtime_dependency_manifest_id
    || runtimeDependencyManifest.manifest_fingerprint !== packageRef.runtime_dependency_manifest_fingerprint
    || runtimeDependencyManifest.cycle_free !== true
  ) {
    return finalize('RUNTIME_DEPENDENCY_BLOCKED', ['dependency_graph_or_runtime_dependency_manifest_mismatch']);
  }
  markValid('dependency_manifest_validated');

  // 18. Binding Ledger.
  if (
    bindingLedger.binding_ledger_id !== packageRef.binding_ledger_id || bindingLedger.ledger_fingerprint !== packageRef.binding_ledger_fingerprint
    || bindingLedger.references_bound_in_simulation !== true || bindingLedger.all_required_bindings_present !== true
  ) {
    return finalize('RUNTIME_BINDING_BLOCKED', ['binding_ledger_mismatch']);
  }
  markValid('binding_ledger_validated');

  // 19. Validation Ledger.
  if (
    validationLedger.validation_ledger_id !== packageRef.validation_ledger_id
    || validationLedger.ledger_fingerprint !== packageRef.validation_ledger_fingerprint
    || validationLedger.pipeline_completed !== true || validationLedger.all_required_validations_valid !== true
  ) {
    return finalize('RUNTIME_VALIDATION_LEDGER_BLOCKED', ['validation_ledger_mismatch']);
  }
  markValid('validation_ledger_validated');

  // 20-21. Execution Plan Budget + Runtime Budget.
  if (executionBudgetReference.execution_plan_id !== plan.execution_plan_id) {
    return finalize('RUNTIME_BUDGET_BLOCKED', ['execution_plan_budget_mismatch']);
  }
  if (
    runtimeBudgetRef.budget_fingerprint !== packageRef.runtime_budget_fingerprint
    || runtimeBudgetRef.execution_budget_id !== executionBudgetReference.execution_budget_id
    || runtimeBudgetRef.budget_validated !== true
  ) {
    return finalize('RUNTIME_BUDGET_BLOCKED', ['runtime_budget_mismatch']);
  }
  markValid('budget_validated');

  // 22. Stops.
  const stopFingerprints = runtimeStopRefs.map((stop) => stop.stop_fingerprint).sort();
  if (!arraysEqual(stopFingerprints, packageRef.runtime_stop_fingerprints) || runtimeStopRefs.some((stop) => stop.stop_validated !== true)) {
    return finalize('RUNTIME_STOP_BLOCKED', ['runtime_stop_references_mismatch']);
  }
  markValid('stops_validated');

  // 23. Compensations.
  const compensationFingerprints = runtimeCompensationRefs.map((compensation) => compensation.compensation_fingerprint).sort();
  if (!arraysEqual(compensationFingerprints, packageRef.runtime_compensation_fingerprints) || runtimeCompensationRefs.some((compensation) => compensation.compensation_validated !== true)) {
    return finalize('RUNTIME_COMPENSATION_BLOCKED', ['runtime_compensation_references_mismatch']);
  }
  markValid('compensations_validated');

  // 24. Artifact Plan.
  if (runtimeArtifactPlan.artifact_plan_fingerprint !== packageRef.runtime_artifact_plan_fingerprint) {
    return finalize('RUNTIME_ARTIFACT_PLAN_BLOCKED', ['artifact_plan_mismatch']);
  }
  markValid('artifact_plan_validated');

  // 25. Event Plan.
  if (runtimeEventPlan.event_plan_fingerprint !== packageRef.runtime_event_plan_fingerprint) {
    return finalize('RUNTIME_EVENT_PLAN_BLOCKED', ['event_plan_mismatch']);
  }
  markValid('event_plan_validated');

  // 26-27. Package fingerprint / digest -- recomputed from the real, raw sub-objects, exactly the
  // same shape runtime-execution-package.js's own computeRuntimePackageDigest already uses; a
  // mismatch here proves at least one underlying reference drifted since PR #103 prepared this
  // package, regardless of what every individual shallow check above already confirmed.
  const recomputedDigest = computeRuntimePackageDigest({
    gatewayDecision, gatewayResult, gatewayPackageRef, plan, result: planResult, stageManifestRef, dependencyGraphRef,
    bindingLedger, validationLedger, runtimeStageManifest, runtimeDependencyManifest, runtimeBudgetRef,
    executionBudgetReference, runtimeStopRefs, runtimeCompensationRefs, runtimeArtifactPlan, runtimeEventPlan,
    orderedRuntimeStageIds: packageRef.ordered_runtime_stage_ids, runtimeDependencyIds: packageRef.runtime_dependency_ids,
    estimates: {
      estimated_input_tokens: packageRef.estimated_input_tokens, estimated_output_tokens: packageRef.estimated_output_tokens,
      estimated_total_tokens: packageRef.estimated_total_tokens, estimated_total_cost_minor_units: packageRef.estimated_total_cost_minor_units
    },
    canonical
  });
  if (recomputedDigest !== packageRef.package_fingerprint) return finalize('RUNTIME_FINGERPRINT_BLOCKED', ['runtime_package_fingerprint_not_honestly_derived']);
  markValid('package_fingerprint_validated');
  if (recomputedDigest !== packageRef.package_digest || recomputedDigest !== decisionRef.runtime_package_digest) {
    return finalize('RUNTIME_DIGEST_BLOCKED', ['runtime_package_digest_not_honestly_derived']);
  }
  markValid('package_digest_validated');

  // 28. Freshness -- every dimension recomputed by the reference's own builder math; the boundary
  // re-checks the outcome (never a bare declared flag) and that it describes this exact package.
  if (
    freshnessRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || freshnessRef.freshness_validated !== true
    || FRESHNESS_DIMENSIONS.some(([, , , expiredField]) => freshnessRef[expiredField] !== false)
  ) {
    return finalize('RUNTIME_FRESHNESS_BLOCKED', ['runtime_readiness_freshness_reference_not_valid']);
  }
  markValid('freshness_validated');

  // 29. Replay.
  if (
    replayRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || replayRef.runtime_package_fingerprint !== recomputedDigest || replayRef.runtime_package_digest !== recomputedDigest
    || replayRef.readiness_request_id !== request.runtime_readiness_request_id
    || replayRef.readiness_request_fingerprint !== requestFingerprint
    || replayRef.replay_allowed !== true || replayRef.replay_validated !== true
    || replayRef.duplicate_readiness_acceptance_blocked !== false
  ) {
    return finalize('RUNTIME_REPLAY_BLOCKED', ['runtime_readiness_replay_reference_not_valid']);
  }
  markValid('replay_validated');

  // 30-31. Capacity Snapshot + real capacity requirements recomputed from the Runtime Package/
  // Manifest -- "Não aceitar valores requested fornecidos livremente pelo caller."
  const requestedCapacity = {
    total_package_capacity: 1,
    total_stage_capacity: runtimeStageManifest.runtime_stage_count,
    total_parallel_stage_capacity: runtimeStageManifest.parallel_stage_count,
    total_model_stage_capacity: runtimeStageManifest.model_stage_count,
    total_tool_stage_capacity: runtimeStageManifest.tool_stage_count,
    total_workflow_stage_capacity: runtimeStageManifest.workflow_stage_count,
    maximum_tokens_capacity: runtimeStageManifest.estimated_total_tokens,
    maximum_cost_capacity_minor_units: runtimeStageManifest.estimated_total_cost_minor_units
  };
  const capacityFits = CAPACITY_DIMENSIONS.every(([totalField, , availableField]) => capacitySnapshotRef[availableField] >= requestedCapacity[totalField]);
  const recomputedCapacityAvailable = capacityFits && capacitySnapshotRef.capacity_consistent === true && capacitySnapshotRef.snapshot_expired_logically === false;
  if (capacitySnapshotRef.capacity_available !== recomputedCapacityAvailable || recomputedCapacityAvailable !== true) {
    return finalize('RUNTIME_CAPACITY_BLOCKED', ['runtime_capacity_not_honestly_available_for_package']);
  }
  markValid('capacity_validated');

  // 32. Concurrency -- requested_* fields cross-checked against the same honestly-derived
  // requirements above (never trusted as caller-declared), scope pools re-derived from
  // current/maximum, dimension pools re-derived against the very same capacity snapshot.
  const expectedRequested = {
    requested_package_slots: 1,
    requested_stage_slots: runtimeStageManifest.runtime_stage_count,
    requested_parallel_stage_slots: runtimeStageManifest.parallel_stage_count,
    requested_model_stage_slots: runtimeStageManifest.model_stage_count,
    requested_tool_stage_slots: runtimeStageManifest.tool_stage_count,
    requested_workflow_stage_slots: runtimeStageManifest.workflow_stage_count
  };
  const requestedMismatch = Object.entries(expectedRequested).some(([field, value]) => concurrencyRef[field] !== value);
  const dimensionAvailability = {
    package_slots_available: capacitySnapshotRef.available_package_capacity >= expectedRequested.requested_package_slots,
    stage_slots_available: capacitySnapshotRef.available_stage_capacity >= expectedRequested.requested_stage_slots,
    parallel_slots_available: capacitySnapshotRef.available_parallel_stage_capacity >= expectedRequested.requested_parallel_stage_slots,
    model_slots_available: capacitySnapshotRef.available_model_stage_capacity >= expectedRequested.requested_model_stage_slots,
    tool_slots_available: capacitySnapshotRef.available_tool_stage_capacity >= expectedRequested.requested_tool_stage_slots,
    workflow_slots_available: capacitySnapshotRef.available_workflow_stage_capacity >= expectedRequested.requested_workflow_stage_slots,
    tenant_slots_available: concurrencyRef.current_tenant_package_slots < concurrencyRef.maximum_tenant_package_slots,
    organization_slots_available: concurrencyRef.current_organization_package_slots < concurrencyRef.maximum_organization_package_slots,
    agent_slots_available: concurrencyRef.current_agent_package_slots < concurrencyRef.maximum_agent_package_slots
  };
  const dimensionMismatch = Object.entries(dimensionAvailability).some(([field, value]) => concurrencyRef[field] !== value);
  if (requestedMismatch || dimensionMismatch || concurrencyRef.concurrency_validated !== true || concurrencyRef.runtime_capacity_snapshot_reference_id !== capacitySnapshotRef.runtime_capacity_snapshot_reference_id) {
    return finalize('RUNTIME_CONCURRENCY_BLOCKED', ['runtime_concurrency_not_honestly_available_for_package']);
  }
  markValid('concurrency_validated');

  // 33. Non-execution invariants.
  const operationalCarriers = [plan, planResult, bindingLedger];
  const anyOperationalFlagLive = operationalCarriers.some((carrier) => (
    carrier.execution_authorized === true || carrier.execution_started === true || carrier.executed === true
    || (carrier.runtime_enabled !== undefined && carrier.runtime_enabled === true)
  ));
  if (anyOperationalFlagLive) return finalize('RUNTIME_READINESS_VALIDATION_FAILED', ['non_execution_invariant_violated']);
  markValid('non_execution_invariants_validated');

  // 34. RUNTIME_READY_SIMULATION.
  return finalize('RUNTIME_READY_SIMULATION', ['runtime_ready_in_simulation_only']);
}

function buildReadinessOutcome(status, reasonCodes, ctx, validatedFlags) {
  const { request, requestFingerprint, canonical, packageRef, decisionRef, capacitySnapshotRef, concurrencyRef, freshnessRef, replayRef } = ctx;
  const requestSafe = isPlainObject(request) ? request : {};
  const packageSafe = isPlainObject(packageRef) ? packageRef : {};
  const decisionSafe = isPlainObject(decisionRef) ? decisionRef : {};
  const capacitySafe = isPlainObject(capacitySnapshotRef) ? capacitySnapshotRef : {};
  const concurrencySafe = isPlainObject(concurrencyRef) ? concurrencyRef : {};
  const freshnessSafe = isPlainObject(freshnessRef) ? freshnessRef : {};
  const replaySafe = isPlainObject(replayRef) ? replayRef : {};
  const canonicalSafe = canonical || {};

  const readinessRequestId = requestSafe.runtime_readiness_request_id || 'runtime_readiness_request_not_available';

  const decision = buildRuntimeReadinessDecision({
    runtime_readiness_decision_id: `${readinessRequestId}-decision`,
    runtime_readiness_request_id: readinessRequestId,
    runtime_execution_package_id: packageSafe.runtime_execution_package_id || 'runtime_execution_package_not_available',
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    status,
    runtime_readiness_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    runtime_execution_package_fingerprint: packageSafe.package_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_digest: decisionSafe.runtime_package_digest || packageSafe.package_digest || 'digest_not_available',
    runtime_capacity_snapshot_fingerprint: capacitySafe.capacity_fingerprint || 'fingerprint_not_available',
    runtime_concurrency_fingerprint: concurrencySafe.concurrency_fingerprint || 'fingerprint_not_available',
    runtime_freshness_fingerprint: freshnessSafe.freshness_fingerprint || 'fingerprint_not_available',
    runtime_replay_fingerprint: replaySafe.replay_fingerprint || 'fingerprint_not_available',
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  return { decision };
}

// --- Phase B: Admission -----------------------------------------------------------------------

function evaluateRuntimeAdmissionRequest(request, context = {}) {
  void context;
  const validatedFlags = {};
  function markValid(flag) {
    validatedFlags[flag] = true;
  }

  const requestIsObject = isPlainObject(request);
  const policy = requestIsObject ? request.runtime_admission_policy : undefined;
  const readinessRequestRef = requestIsObject ? request.runtime_readiness_request_reference : undefined;
  const readinessDecisionRef = requestIsObject ? request.runtime_readiness_decision_reference : undefined;
  const packageRef = requestIsObject ? request.runtime_execution_package_reference : undefined;
  const capacitySnapshotRef = requestIsObject ? request.runtime_capacity_snapshot_reference : undefined;
  const concurrencyRef = requestIsObject ? request.runtime_concurrency_reference : undefined;
  const freshnessRef = requestIsObject ? request.runtime_readiness_freshness_reference : undefined;
  const replayRef = requestIsObject ? request.runtime_readiness_replay_reference : undefined;

  const canonical = {
    tenantId: isPlainObject(packageRef) ? packageRef.tenant_id : undefined,
    organizationId: isPlainObject(packageRef) ? packageRef.organization_id : undefined,
    projectId: isPlainObject(packageRef) ? packageRef.project_id : undefined,
    sessionId: isPlainObject(packageRef) ? packageRef.session_reference_id : undefined,
    agentId: isPlainObject(packageRef) ? packageRef.agent_id : undefined,
    actorId: isPlainObject(packageRef) ? packageRef.actor_id : undefined
  };

  // pr104fix FIX #3: excludes runtime_readiness_replay_reference from its own input -- that
  // reference's own admission_request_fingerprint field exists specifically to describe this
  // request, so including it here would make the digest depend on itself (no fixed point exists,
  // the identical reason Phase A's own requestForFingerprint already excludes its own replay
  // reference). The same replay reference is *also* reachable through the nested
  // runtime_readiness_request_reference (a RuntimeReadinessRequest carries its own copy of this
  // field) -- excluded there too, for the identical reason; otherwise the cycle would simply
  // reopen one level down. This is the one fingerprint used everywhere below: the Admission
  // Decision, the Admission Result, the audit, and the replay cross-check all reuse this exact
  // value.
  const requestForFingerprint = requestIsObject ? {
    ...omitReplayReference(request),
    runtime_readiness_request_reference: omitReplayReference(request.runtime_readiness_request_reference)
  } : request;
  const requestFingerprint = computeCanonicalContentDigest(requestForFingerprint);

  function finalize(status, reasonCodes) {
    return buildAdmissionOutcome(status, reasonCodes, {
      request, requestFingerprint, canonical, readinessDecisionRef, packageRef, capacitySnapshotRef, concurrencyRef,
      freshnessRef, replayRef
    }, validatedFlags);
  }

  // 1. Request contract shape.
  const requestValidation = validateRuntimeAdmissionRequest(request);
  if (!requestValidation.valid) {
    return finalize('RUNTIME_ADMISSION_VALIDATION_FAILED', ['runtime_admission_request_invalid']);
  }
  markValid('request_validated');

  // Identity -- every carried reference must agree with the package's own canonical identity.
  const identityChecks = [
    ['runtime_execution_package_reference', packageRef], ['runtime_capacity_snapshot_reference', capacitySnapshotRef],
    ['runtime_concurrency_reference', concurrencyRef]
  ];
  for (const [label, reference] of identityChecks) {
    const mismatch = checkIdentity(reference, canonical, label);
    if (mismatch) return finalize(mismatch.status, [mismatch.reason]);
  }
  if (
    readinessDecisionRef.tenant_id !== canonical.tenantId || readinessDecisionRef.organization_id !== canonical.organizationId
    || readinessDecisionRef.project_id !== canonical.projectId || readinessDecisionRef.session_reference_id !== canonical.sessionId
    || readinessDecisionRef.agent_id !== canonical.agentId || readinessDecisionRef.actor_id !== canonical.actorId
  ) {
    return finalize('RUNTIME_IDENTITY_BLOCKED', ['readiness_decision_identity_mismatch']);
  }
  markValid('identity_validated');

  // 2. Admission Policy -- structural (already proven true by the nested validator).
  if (policy.allow_runtime_admission_simulation !== true || policy.require_runtime_ready_simulation !== true) {
    return finalize('RUNTIME_ADMISSION_POLICY_BLOCKED', ['admission_policy_not_valid']);
  }
  markValid('policy_validated');

  // 3. Readiness Decision.
  if (
    readinessDecisionRef.status !== 'RUNTIME_READY_SIMULATION' || readinessDecisionRef.runtime_ready_in_simulation !== true
    || readinessDecisionRef.runtime_readiness_request_id !== readinessRequestRef.runtime_readiness_request_id
    || readinessDecisionRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
  ) {
    return finalize('RUNTIME_NOT_READY_BLOCKED', ['readiness_decision_not_ready_or_mismatched']);
  }
  markValid('readiness_validated');

  // 4. Runtime Package -- must be the exact same package the readiness decision found ready.
  if (
    packageRef.runtime_status !== 'RUNTIME_PACKAGE_PREPARED_SIMULATION' || packageRef.runtime_admitted_in_simulation !== false
    || packageRef.package_fingerprint !== readinessDecisionRef.runtime_execution_package_fingerprint
    || packageRef.package_digest !== readinessDecisionRef.runtime_execution_package_digest
  ) {
    return finalize('RUNTIME_PACKAGE_BLOCKED', ['runtime_package_not_prepared_or_swapped']);
  }
  markValid('runtime_package_validated');

  // 6. Revalidate Capacity Snapshot -- must be the exact same, still-consistent snapshot readiness used.
  if (
    capacitySnapshotRef.capacity_fingerprint !== readinessDecisionRef.runtime_capacity_snapshot_fingerprint
    || capacitySnapshotRef.capacity_available !== true || capacitySnapshotRef.capacity_consistent !== true
    || capacitySnapshotRef.snapshot_expired_logically !== false
  ) {
    return finalize('RUNTIME_CAPACITY_BLOCKED', ['runtime_capacity_snapshot_not_still_valid']);
  }
  markValid('capacity_validated');

  // 7. Revalidate Concurrency.
  if (concurrencyRef.concurrency_fingerprint !== readinessDecisionRef.runtime_concurrency_fingerprint || concurrencyRef.concurrency_validated !== true) {
    return finalize('RUNTIME_CONCURRENCY_BLOCKED', ['runtime_concurrency_not_still_valid']);
  }
  markValid('concurrency_validated');

  // 8. Revalidate Freshness -- pr104fix FIX #2: recomputed using the Admission Request's own
  // logical_sequence, never just re-confirming the same reference readiness already accepted (a
  // package can age logically -- and expire -- between readiness and admission, using an unchanged
  // freshness reference that was genuinely still valid at readiness time).
  if (freshnessRef.freshness_fingerprint !== readinessDecisionRef.runtime_freshness_fingerprint) {
    return finalize('RUNTIME_FRESHNESS_BLOCKED', ['runtime_freshness_reference_swapped_since_readiness']);
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < freshnessRef.current_logical_sequence) {
    return finalize('RUNTIME_FRESHNESS_BLOCKED', ['admission_logical_sequence_regressive']);
  }
  const admissionExpired = FRESHNESS_DIMENSIONS.some(([, createdField, maximumField]) => (
    (request.logical_sequence - freshnessRef[createdField]) > freshnessRef[maximumField]
  ));
  if (admissionExpired || freshnessRef.freshness_validated !== true) {
    return finalize('RUNTIME_FRESHNESS_BLOCKED', ['runtime_freshness_expired_at_admission_logical_sequence']);
  }
  markValid('freshness_validated');

  // 9. Revalidate Replay -- including the admission-specific half (readiness's own half was already
  // proven during Phase A; Phase B additionally proves this admission attempt is not a duplicate).
  // pr104fix FIX #3: the replay reference is now genuinely bound to *this* Admission Request --
  // its own id and the request's real (self-excluding) fingerprint -- and to the exact Runtime
  // Execution Package being admitted, never merely re-confirmed as "the same object readiness
  // already used". idempotency_reference_id/idempotency_fingerprint are cross-checked against the
  // real upstream replay reference the Runtime Readiness Request itself already carried -- never
  // accepted as an unsourced claim.
  //
  // The readiness-half and admission-half of this one replay reference are proven independently,
  // each against its own real, self-excluding fingerprint (readiness_request_fingerprint against a
  // freshly recomputed digest of the embedded readiness request; admission_request_fingerprint
  // against `requestFingerprint`, already computed above) -- deliberately never cross-referencing
  // readinessDecisionRef's own runtime_replay_fingerprint copy, since that value was captured by
  // Phase A from this same replay reference and would otherwise make admission_request_fingerprint
  // depend on its own value once bound (no fixed point exists for that composition, the identical
  // class of self-reference this fix's own exclusion already solves one layer up).
  const readinessRequestForFingerprint = omitReplayReference(readinessRequestRef);
  const readinessRequestFingerprint = computeCanonicalContentDigest(readinessRequestForFingerprint);
  const readinessReplayRef = isPlainObject(readinessRequestRef) ? readinessRequestRef.runtime_readiness_replay_reference : undefined;
  if (
    replayRef.readiness_request_id !== (isPlainObject(readinessRequestRef) ? readinessRequestRef.runtime_readiness_request_id : undefined)
    || replayRef.readiness_request_fingerprint !== readinessRequestFingerprint
    || replayRef.replay_validated !== true || replayRef.replay_allowed !== true || replayRef.replay_consumed !== false
    || replayRef.duplicate_admission_acceptance_blocked !== false
    || replayRef.expected_admission_attempt > replayRef.maximum_admission_attempts
    || replayRef.admission_request_id !== request.runtime_admission_request_id
    || replayRef.admission_request_fingerprint !== requestFingerprint
    || replayRef.runtime_execution_package_id !== packageRef.runtime_execution_package_id
    || replayRef.runtime_package_fingerprint !== packageRef.package_fingerprint
    || replayRef.runtime_package_digest !== packageRef.package_digest
    || !isPlainObject(readinessReplayRef) || replayRef.idempotency_reference_id !== readinessReplayRef.idempotency_reference_id
    || replayRef.idempotency_fingerprint !== readinessReplayRef.idempotency_fingerprint
  ) {
    return finalize('RUNTIME_REPLAY_BLOCKED', ['runtime_replay_not_bound_to_admission_request']);
  }
  markValid('replay_validated');

  // 10. Admission Policy limits -- real, already-honestly-derived counts from the Runtime
  // Concurrency Reference (Phase A already proved these were not "fornecidos livremente pelo
  // caller"), never re-trusted from anywhere else.
  const limitChecks = [
    [concurrencyRef.requested_parallel_stage_slots, policy.maximum_admitted_parallel_stages, 'admission_parallel_limit_exceeded'],
    [concurrencyRef.requested_model_stage_slots, policy.maximum_admitted_model_stages, 'admission_model_limit_exceeded'],
    [concurrencyRef.requested_tool_stage_slots, policy.maximum_admitted_tool_stages, 'admission_tool_limit_exceeded'],
    [concurrencyRef.requested_workflow_stage_slots, policy.maximum_admitted_workflow_stages, 'admission_workflow_limit_exceeded'],
    [packageRef.estimated_total_tokens, policy.maximum_admitted_estimated_tokens, 'admission_token_limit_exceeded'],
    [packageRef.estimated_total_cost_minor_units, policy.maximum_admitted_estimated_cost_minor_units, 'admission_cost_limit_exceeded'],
    [concurrencyRef.current_tenant_package_slots + 1, policy.maximum_admitted_packages_per_tenant, 'admission_package_limit_exceeded_per_tenant'],
    [concurrencyRef.current_organization_package_slots + 1, policy.maximum_admitted_packages_per_organization, 'admission_package_limit_exceeded_per_organization'],
    [concurrencyRef.current_agent_package_slots + 1, policy.maximum_admitted_packages_per_agent, 'admission_package_limit_exceeded_per_agent']
  ];
  for (const [value, maximum, reason] of limitChecks) {
    if (value > maximum) return finalize('RUNTIME_LIMIT_BLOCKED', [reason]);
  }
  markValid('admission_limits_validated');

  // 11. Non-execution invariants.
  if (packageRef.runtime_enabled === true || packageRef.execution_authorized === true || packageRef.executed === true) {
    return finalize('RUNTIME_ADMISSION_VALIDATION_FAILED', ['non_execution_invariant_violated']);
  }
  markValid('non_execution_invariants_validated');

  // 12-14. RUNTIME_ADMITTED_SIMULATION.
  return finalize('RUNTIME_ADMITTED_SIMULATION', ['runtime_admitted_in_simulation_only']);
}

function buildAdmissionOutcome(status, reasonCodes, ctx, validatedFlags) {
  const { request, requestFingerprint, canonical, readinessDecisionRef, packageRef, capacitySnapshotRef, concurrencyRef, freshnessRef, replayRef } = ctx;
  const requestSafe = isPlainObject(request) ? request : {};
  const readinessDecisionSafe = isPlainObject(readinessDecisionRef) ? readinessDecisionRef : {};
  const packageSafe = isPlainObject(packageRef) ? packageRef : {};
  const capacitySafe = isPlainObject(capacitySnapshotRef) ? capacitySnapshotRef : {};
  const concurrencySafe = isPlainObject(concurrencyRef) ? concurrencyRef : {};
  const freshnessSafe = isPlainObject(freshnessRef) ? freshnessRef : {};
  const replaySafe = isPlainObject(replayRef) ? replayRef : {};
  const canonicalSafe = canonical || {};

  const admissionRequestId = requestSafe.runtime_admission_request_id || 'runtime_admission_request_not_available';

  const decision = buildRuntimeAdmissionDecision({
    runtime_admission_decision_id: `${admissionRequestId}-decision`,
    runtime_admission_request_id: admissionRequestId,
    runtime_readiness_decision_id: readinessDecisionSafe.runtime_readiness_decision_id || 'runtime_readiness_decision_not_available',
    runtime_execution_package_id: packageSafe.runtime_execution_package_id || 'runtime_execution_package_not_available',
    tenant_id: canonicalSafe.tenantId || 'tenant_not_available',
    organization_id: canonicalSafe.organizationId || 'organization_not_available',
    project_id: canonicalSafe.projectId || 'project_not_available',
    session_reference_id: canonicalSafe.sessionId || 'session_not_available',
    agent_id: canonicalSafe.agentId || 'agent_not_available',
    actor_id: canonicalSafe.actorId || 'actor_not_available',
    status,
    runtime_admission_request_fingerprint: requestFingerprint || 'fingerprint_not_available',
    runtime_readiness_decision_fingerprint: computeCanonicalContentDigest(readinessDecisionSafe),
    runtime_execution_package_fingerprint: packageSafe.package_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_digest: packageSafe.package_digest || 'digest_not_available',
    runtime_capacity_snapshot_fingerprint: capacitySafe.capacity_fingerprint || 'fingerprint_not_available',
    runtime_concurrency_fingerprint: concurrencySafe.concurrency_fingerprint || 'fingerprint_not_available',
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    ...validatedFlags
  });

  const result = buildRuntimeAdmissionResult({
    runtime_admission_result_id: `${admissionRequestId}-result`,
    runtime_admission_request_id: admissionRequestId,
    runtime_admission_decision_id: decision.runtime_admission_decision_id,
    runtime_readiness_decision_id: decision.runtime_readiness_decision_id,
    runtime_execution_package_id: decision.runtime_execution_package_id,
    tenant_id: decision.tenant_id,
    organization_id: decision.organization_id,
    project_id: decision.project_id,
    session_reference_id: decision.session_reference_id,
    agent_id: decision.agent_id,
    actor_id: decision.actor_id,
    status,
    runtime_admission_request_fingerprint: decision.runtime_admission_request_fingerprint,
    runtime_admission_decision_fingerprint: computeCanonicalContentDigest(decision),
    runtime_readiness_decision_fingerprint: decision.runtime_readiness_decision_fingerprint,
    runtime_execution_package_fingerprint: decision.runtime_execution_package_fingerprint,
    runtime_execution_package_digest: decision.runtime_execution_package_digest,
    runtime_capacity_snapshot_fingerprint: decision.runtime_capacity_snapshot_fingerprint,
    runtime_concurrency_fingerprint: decision.runtime_concurrency_fingerprint,
    registry_version: String(requestSafe.expected_admission_registry_version || 'registry_version_not_available'),
    requested_package_slots: Number.isInteger(concurrencySafe.requested_package_slots) ? concurrencySafe.requested_package_slots : 0,
    requested_stage_slots: Number.isInteger(concurrencySafe.requested_stage_slots) ? concurrencySafe.requested_stage_slots : 0,
    requested_parallel_stage_slots: Number.isInteger(concurrencySafe.requested_parallel_stage_slots) ? concurrencySafe.requested_parallel_stage_slots : 0,
    requested_model_stage_slots: Number.isInteger(concurrencySafe.requested_model_stage_slots) ? concurrencySafe.requested_model_stage_slots : 0,
    requested_tool_stage_slots: Number.isInteger(concurrencySafe.requested_tool_stage_slots) ? concurrencySafe.requested_tool_stage_slots : 0,
    requested_workflow_stage_slots: Number.isInteger(concurrencySafe.requested_workflow_stage_slots) ? concurrencySafe.requested_workflow_stage_slots : 0,
    estimated_total_tokens: Number.isInteger(packageSafe.estimated_total_tokens) ? packageSafe.estimated_total_tokens : 0,
    estimated_total_cost_minor_units: Number.isInteger(packageSafe.estimated_total_cost_minor_units) ? packageSafe.estimated_total_cost_minor_units : 0,
    blockers: reasonCodes,
    reason_codes: reasonCodes,
    runtime_readiness_evaluated: true,
    runtime_ready_in_simulation: readinessDecisionSafe.runtime_ready_in_simulation === true
  });

  const audit = buildRuntimeAdmissionAudit({
    decision, result,
    availablePackageCapacity: capacitySafe.available_package_capacity,
    availableStageCapacity: capacitySafe.available_stage_capacity,
    availableParallelStageCapacity: capacitySafe.available_parallel_stage_capacity,
    availableModelStageCapacity: capacitySafe.available_model_stage_capacity,
    availableToolStageCapacity: capacitySafe.available_tool_stage_capacity,
    availableWorkflowStageCapacity: capacitySafe.available_workflow_stage_capacity,
    availableTokensCapacity: capacitySafe.available_tokens_capacity,
    availableCostCapacityMinorUnits: capacitySafe.available_cost_capacity_minor_units,
    currentTenantPackageSlots: concurrencySafe.current_tenant_package_slots,
    currentOrganizationPackageSlots: concurrencySafe.current_organization_package_slots,
    currentAgentPackageSlots: concurrencySafe.current_agent_package_slots,
    freshnessValidated: freshnessSafe.freshness_validated === true,
    replayValidated: replaySafe.replay_validated === true,
    expectedReadinessAttempt: replaySafe.expected_readiness_attempt,
    expectedAdmissionAttempt: replaySafe.expected_admission_attempt,
    logicalSequence: requestSafe.logical_sequence
  });

  return { decision, result, audit };
}

module.exports = {
  evaluateRuntimeAdmissionRequest,
  evaluateRuntimeReadinessRequest
};
