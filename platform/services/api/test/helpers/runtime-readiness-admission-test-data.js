'use strict';

// Test-only helper that builds a fully self-consistent "golden" RuntimeReadinessRequest +
// RuntimeAdmissionRequest bundle on top of PR #103's own golden RuntimeExecutionSimulationRequest
// bundle -- the already-prepared RuntimeExecutionPackage/Decision/Result plus every new PR #104
// reference (capacity, concurrency, freshness, replay).
const { buildGoldenRuntimeBundle, evaluateRuntimeExecutionSimulationRequest } = require('./runtime-execution-simulation-test-data');
const { buildRuntimeReadinessPolicy } = require('../../src/core/runtime-readiness-policy');
const { buildRuntimeAdmissionPolicy } = require('../../src/core/runtime-admission-policy');
const { buildRuntimeCapacitySnapshotReference } = require('../../src/core/runtime-capacity-snapshot-reference');
const { buildRuntimeConcurrencyReference } = require('../../src/core/runtime-concurrency-reference');
const { buildRuntimeReadinessFreshnessReference } = require('../../src/core/runtime-readiness-freshness-reference');
const { buildRuntimeReadinessReplayReference } = require('../../src/core/runtime-readiness-replay-reference');
const { buildRuntimeReadinessRequest } = require('../../src/core/runtime-readiness-request');
const { buildRuntimeAdmissionRequest } = require('../../src/core/runtime-admission-request');
const { buildExecutionPlanIdempotency } = require('../../src/core/execution-plan-idempotency');
const { computeCanonicalContentDigest } = require('../../src/core/canonical-content-digest');
const {
  evaluateRuntimeReadinessRequest, evaluateRuntimeAdmissionRequest
} = require('../../src/core/runtime-admission-boundary');

const planFixture = require('../fixtures/hermes-execution-plan-contracts.json');

const PLACEHOLDER_FINGERPRINT = `sha256:${'0'.repeat(64)}`;

// Mirrors runtime-admission-boundary.js's own omitReplayReference exactly: stableCanonicalize
// throws `undefined_not_serializable` the moment it recurses into ANY own key whose value is
// `undefined` (it does not skip such keys the way JSON.stringify does), so the replay reference
// must be genuinely removed as an own key -- never merely set to `undefined` -- before hashing.
function omitReplayReference(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const { runtime_readiness_replay_reference, ...rest } = obj;
  return rest;
}

function buildGoldenReadinessBundle(scenarioKey = 'prepared-no-llm-plan') {
  const rtGolden = buildGoldenRuntimeBundle(scenarioKey);
  const rtOutcome = evaluateRuntimeExecutionSimulationRequest(rtGolden.runtimeRequest, {});
  if (rtOutcome.decision.status !== 'RUNTIME_PACKAGE_PREPARED_SIMULATION') {
    throw new Error(`golden PR#103 bundle for ${scenarioKey} did not reach RUNTIME_PACKAGE_PREPARED_SIMULATION: ${rtOutcome.decision.status}`);
  }
  const { decision: rtDecision, result: rtResult, runtimePackage } = rtOutcome;

  const baseId = `${rtGolden.runtimeRequestId}-readiness`;
  const readinessRequestId = `${baseId}-request`;
  const identity = {
    tenant_id: rtGolden.plan.tenant_id,
    organization_id: rtGolden.plan.organization_id,
    project_id: rtGolden.plan.project_id,
    session_reference_id: rtGolden.plan.session_reference_id,
    agent_id: rtGolden.plan.agent_id
  };

  const readinessPolicy = buildRuntimeReadinessPolicy({ runtime_readiness_policy_id: `${baseId}-policy` });

  // pr104fix2 FIX #2: the real, official ExecutionPlanIdempotencyReference (PR #98) -- rebuilt via
  // its own real builder (never a raw fixture object passed through as-is) from the exact same raw
  // fields the plan fixture's own request already carried under `idempotency_policy_reference`,
  // which is what `plan.idempotency_reference_id`/`plan.idempotency_fingerprint` were themselves
  // copied from by execution-plan-engine.js at plan-build time -- reproducing the identical
  // fingerprint so the readiness boundary's own cross-check against those two plan fields holds.
  const rawIdempotencyReference = planFixture.scenarios[scenarioKey].request.idempotency_policy_reference;
  const idempotencyReference = buildExecutionPlanIdempotency(rawIdempotencyReference);

  const capacitySnapshotRef = buildRuntimeCapacitySnapshotReference({
    runtime_capacity_snapshot_reference_id: `${baseId}-capacity`,
    runtime_environment_reference_id: `${baseId}-environment`,
    runtime_registry_snapshot_reference_id: rtGolden.snapshotReference.registry_snapshot_reference_id,
    ...identity,
    total_package_capacity: 10, used_package_capacity: 0, available_package_capacity: 10,
    total_stage_capacity: 1000, used_stage_capacity: 0, available_stage_capacity: 1000,
    total_parallel_stage_capacity: 100, used_parallel_stage_capacity: 0, available_parallel_stage_capacity: 100,
    total_model_stage_capacity: 100, used_model_stage_capacity: 0, available_model_stage_capacity: 100,
    total_tool_stage_capacity: 100, used_tool_stage_capacity: 0, available_tool_stage_capacity: 100,
    total_workflow_stage_capacity: 100, used_workflow_stage_capacity: 0, available_workflow_stage_capacity: 100,
    maximum_tokens_capacity: 10000000, used_tokens_capacity: 0, available_tokens_capacity: 10000000,
    maximum_cost_capacity_minor_units: 10000000, used_cost_capacity_minor_units: 0, available_cost_capacity_minor_units: 10000000,
    snapshot_created_logical_sequence: 0, current_logical_sequence: 0, maximum_valid_sequences: 1000,
    capacity_available: true
  });

  const concurrencyRef = buildRuntimeConcurrencyReference({
    runtime_concurrency_reference_id: `${baseId}-concurrency`,
    runtime_capacity_snapshot_reference_id: capacitySnapshotRef.runtime_capacity_snapshot_reference_id,
    runtime_execution_package_id: runtimePackage.runtime_execution_package_id,
    ...identity,
    requested_package_slots: 1,
    requested_stage_slots: rtGolden.runtimeStageManifest.runtime_stage_count,
    requested_parallel_stage_slots: rtGolden.runtimeStageManifest.parallel_stage_count,
    requested_model_stage_slots: rtGolden.runtimeStageManifest.model_stage_count,
    requested_tool_stage_slots: rtGolden.runtimeStageManifest.tool_stage_count,
    requested_workflow_stage_slots: rtGolden.runtimeStageManifest.workflow_stage_count,
    maximum_tenant_package_slots: 100, current_tenant_package_slots: 0,
    maximum_organization_package_slots: 100, current_organization_package_slots: 0,
    maximum_agent_package_slots: 100, current_agent_package_slots: 0,
    package_slots_available: true, stage_slots_available: true, parallel_slots_available: true,
    model_slots_available: true, tool_slots_available: true, workflow_slots_available: true,
    tenant_slots_available: true, organization_slots_available: true, agent_slots_available: true
  });

  const freshnessRef = buildRuntimeReadinessFreshnessReference({
    runtime_readiness_freshness_reference_id: `${baseId}-freshness`,
    runtime_execution_package_id: runtimePackage.runtime_execution_package_id,
    gateway_decision_id: rtGolden.gatewayDecision.gateway_decision_id,
    authorization_decision_id: rtGolden.authorizationDecision.authorization_decision_id,
    authorization_scope_reference_id: rtGolden.scopeReference.authorization_scope_reference_id,
    registry_snapshot_reference_id: rtGolden.snapshotReference.registry_snapshot_reference_id,
    architecture_gate_evidence_reference_id: rtGolden.evidenceReference.architecture_gate_evidence_reference_id,
    binding_ledger_id: rtGolden.bindingLedger.binding_ledger_id,
    validation_ledger_id: rtGolden.validationLedger.validation_ledger_id,
    runtime_capacity_snapshot_reference_id: capacitySnapshotRef.runtime_capacity_snapshot_reference_id,
    package_created_logical_sequence: 0, gateway_created_logical_sequence: 0, authorization_created_logical_sequence: 0,
    scope_created_logical_sequence: 0, registry_created_logical_sequence: 0, architecture_evidence_created_logical_sequence: 0,
    binding_ledger_created_logical_sequence: 0, validation_ledger_created_logical_sequence: 0,
    capacity_snapshot_created_logical_sequence: 0,
    current_logical_sequence: 0,
    maximum_package_valid_sequences: 1000, maximum_gateway_valid_sequences: 1000, maximum_authorization_valid_sequences: 1000,
    maximum_scope_valid_sequences: 1000, maximum_registry_valid_sequences: 1000, maximum_architecture_evidence_valid_sequences: 1000,
    maximum_binding_ledger_valid_sequences: 1000, maximum_validation_ledger_valid_sequences: 1000,
    maximum_capacity_valid_sequences: 1000
  });

  function buildReplayReference(readinessRequestFingerprint) {
    return buildRuntimeReadinessReplayReference({
      runtime_readiness_replay_reference_id: `${baseId}-replay`,
      runtime_execution_package_id: runtimePackage.runtime_execution_package_id,
      runtime_package_fingerprint: runtimePackage.package_fingerprint,
      runtime_package_digest: runtimePackage.package_digest,
      readiness_request_id: readinessRequestId,
      readiness_request_fingerprint: readinessRequestFingerprint,
      admission_request_id: `${baseId}-admission-request`,
      admission_request_fingerprint: PLACEHOLDER_FINGERPRINT,
      idempotency_reference_id: idempotencyReference.idempotency_reference_id,
      idempotency_fingerprint: idempotencyReference.idempotency_fingerprint,
      expected_readiness_attempt: 1, maximum_readiness_attempts: 5,
      expected_admission_attempt: 1, maximum_admission_attempts: 5,
      prior_readiness_decision_ids: [], prior_readiness_decision_fingerprints: [],
      prior_admission_decision_ids: [], prior_admission_decision_fingerprints: []
    });
  }

  function buildReadinessRequest(replayRef) {
    return buildRuntimeReadinessRequest({
      runtime_readiness_request_id: readinessRequestId,
      runtime_readiness_policy: readinessPolicy,
      runtime_execution_package_reference: runtimePackage,
      runtime_execution_simulation_decision_reference: rtDecision,
      runtime_execution_simulation_result_reference: rtResult,
      gateway_decision_reference: rtGolden.gatewayDecision,
      gateway_result_reference: rtGolden.gatewayResult,
      gateway_package_reference: rtGolden.packageReference,
      execution_plan_reference: rtGolden.plan,
      execution_plan_result_reference: rtGolden.result,
      authorization_provenance_reference: rtGolden.provenanceReference,
      authorization_scope_reference: rtGolden.scopeReference,
      registry_snapshot_reference: rtGolden.snapshotReference,
      architecture_gate_evidence_reference: rtGolden.evidenceReference,
      stage_manifest_reference: rtGolden.stageManifestReference,
      dependency_graph_reference: rtGolden.dependencyGraphReference,
      binding_ledger_reference: rtGolden.bindingLedger,
      validation_ledger_reference: rtGolden.validationLedger,
      execution_budget_reference: rtGolden.executionBudgetReference,
      idempotency_reference: idempotencyReference,
      runtime_stage_manifest_reference: rtGolden.runtimeStageManifest,
      runtime_dependency_manifest_reference: rtGolden.runtimeDependencyManifest,
      runtime_budget_reference: rtGolden.runtimeBudgetReference,
      runtime_stop_references: rtGolden.runtimeStopRefs,
      runtime_compensation_references: rtGolden.runtimeCompensationRefs,
      runtime_artifact_plan_reference: rtGolden.runtimeArtifactPlan,
      runtime_event_plan_reference: rtGolden.runtimeEventPlan,
      runtime_capacity_snapshot_reference: capacitySnapshotRef,
      runtime_concurrency_reference: concurrencyRef,
      runtime_readiness_freshness_reference: freshnessRef,
      runtime_readiness_replay_reference: replayRef,
      correlation_id: 'corr-readiness-1',
      causation_id: 'cause-readiness-1',
      trace_id: 'trace-readiness-1',
      logical_sequence: 0,
      expected_readiness_registry_version: 1,
      simulation_context: rtGolden.gatewayRequest.simulation_context
    });
  }

  // Two-pass build: readiness_request_fingerprint is excluded from its own digest by the boundary
  // (see runtime-admission-boundary.js's own comment on requestForFingerprint), so a placeholder
  // replay reference already yields the real, final digest on the first pass.
  const placeholderReplayRef = buildReplayReference(PLACEHOLDER_FINGERPRINT);
  const placeholderRequest = buildReadinessRequest(placeholderReplayRef);
  const readinessRequestFingerprint = computeCanonicalContentDigest(omitReplayReference(placeholderRequest));
  const replayRef = buildReplayReference(readinessRequestFingerprint);
  const readinessRequest = buildReadinessRequest(replayRef);

  return {
    ...rtGolden,
    rtDecision, rtResult, runtimePackage,
    readinessRequestId, readinessPolicy, idempotencyReference, capacitySnapshotRef, concurrencyRef, freshnessRef, replayRef,
    readinessRequest
  };
}

function buildGoldenAdmissionBundle(scenarioKey = 'prepared-no-llm-plan', overrides = {}) {
  const readinessGolden = buildGoldenReadinessBundle(scenarioKey);
  const readinessOutcome = evaluateRuntimeReadinessRequest(readinessGolden.readinessRequest, {});
  if (readinessOutcome.decision.status !== 'RUNTIME_READY_SIMULATION') {
    throw new Error(`golden readiness bundle for ${scenarioKey} did not reach RUNTIME_READY_SIMULATION: ${readinessOutcome.decision.status}`);
  }
  const readinessDecision = readinessOutcome.decision;

  const baseId = `${readinessGolden.runtimeRequestId}-admission`;
  // Reuses the admission_request_id already baked into the readiness-side replay reference (see
  // buildGoldenReadinessBundle's own buildReplayReference) -- never independently invented here,
  // so the two can never silently disagree.
  const admissionRequestId = readinessGolden.replayRef.admission_request_id;

  const admissionPolicy = buildRuntimeAdmissionPolicy({
    runtime_admission_policy_id: `${baseId}-policy`,
    maximum_admitted_packages_per_tenant: 100, maximum_admitted_packages_per_organization: 100,
    maximum_admitted_packages_per_agent: 100, maximum_admitted_parallel_stages: 100,
    maximum_admitted_model_stages: 100, maximum_admitted_tool_stages: 100, maximum_admitted_workflow_stages: 100,
    maximum_admitted_estimated_tokens: 100000000, maximum_admitted_estimated_cost_minor_units: 100000000
  });

  // `overrides` (e.g. a different logical_sequence) are folded in *before* the two-pass fingerprint
  // computation below, so a caller wanting a genuinely self-consistent -- not just field-patched --
  // bundle with a different logical_sequence can get one without hand-rolling the same two-pass
  // dance a second time.
  function buildAdmissionRequestWith(replayRef) {
    return buildRuntimeAdmissionRequest({
      runtime_admission_request_id: admissionRequestId,
      runtime_admission_policy: admissionPolicy,
      runtime_readiness_request_reference: readinessGolden.readinessRequest,
      runtime_readiness_decision_reference: readinessDecision,
      runtime_execution_package_reference: readinessGolden.runtimePackage,
      runtime_capacity_snapshot_reference: readinessGolden.capacitySnapshotRef,
      runtime_concurrency_reference: readinessGolden.concurrencyRef,
      runtime_readiness_freshness_reference: readinessGolden.freshnessRef,
      runtime_readiness_replay_reference: replayRef,
      correlation_id: 'corr-admission-1',
      causation_id: 'cause-admission-1',
      trace_id: 'trace-admission-1',
      logical_sequence: 0,
      expected_admission_registry_version: 1,
      simulation_context: readinessGolden.gatewayRequest.simulation_context,
      ...overrides
    });
  }

  // Two-pass build, mirroring readiness's own pattern (pr104fix FIX #3): admission_request_
  // fingerprint is excluded from its own digest by the boundary -- both directly and via the
  // nested runtime_readiness_request_reference's own copy of this same replay reference -- so a
  // placeholder-admission-fingerprint replay reference already yields the real, final digest on
  // the first pass; no iteration is needed.
  const placeholderAdmissionRequest = buildAdmissionRequestWith(readinessGolden.replayRef);
  const admissionRequestFingerprint = computeCanonicalContentDigest({
    ...omitReplayReference(placeholderAdmissionRequest),
    runtime_readiness_request_reference: omitReplayReference(placeholderAdmissionRequest.runtime_readiness_request_reference)
  });
  const replayRef = buildRuntimeReadinessReplayReference({ ...readinessGolden.replayRef, admission_request_fingerprint: admissionRequestFingerprint });
  const admissionRequest = buildAdmissionRequestWith(replayRef);

  return {
    ...readinessGolden,
    readinessDecision, admissionRequestId, admissionPolicy, replayRef, admissionRequest
  };
}

module.exports = {
  buildGoldenAdmissionBundle,
  buildGoldenReadinessBundle,
  evaluateRuntimeAdmissionRequest,
  evaluateRuntimeReadinessRequest
};
