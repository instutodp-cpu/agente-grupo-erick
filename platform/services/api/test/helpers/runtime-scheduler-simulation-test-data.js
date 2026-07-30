'use strict';

// Test-only helper that builds a fully self-consistent "golden" RuntimeSchedulerRequest on top of
// PR #104's own golden RuntimeAdmissionRequest bundle -- the already-RUNTIME_ADMITTED_SIMULATION
// chain (Admission Request/Decision/Result, Readiness Decision, Runtime Execution Package) plus
// every reference this PR reuses verbatim (Stage/Dependency manifests, Budget, Capacity,
// Concurrency, Freshness, Replay, Idempotency).
const { buildGoldenAdmissionBundle, evaluateRuntimeAdmissionRequest } = require('./runtime-readiness-admission-test-data');
const { buildRuntimeSchedulerPolicy } = require('../../src/core/runtime-scheduler-policy');
const { buildRuntimeSchedulerRequest } = require('../../src/core/runtime-scheduler-request');
const { buildRuntimeReadinessReplayReference } = require('../../src/core/runtime-readiness-replay-reference');
const { computeCanonicalContentDigest } = require('../../src/core/canonical-content-digest');
const {
  evaluateRuntimeSchedulerRequest, computeAdmissionRequestFingerprint, omitReplayReference
} = require('../../src/core/runtime-scheduler-boundary');

function buildGoldenSchedulerBundle(scenarioKey = 'prepared-no-llm-plan', overrides = {}) {
  const admissionGolden = buildGoldenAdmissionBundle(scenarioKey);
  const admissionOutcome = evaluateRuntimeAdmissionRequest(admissionGolden.admissionRequest, {});
  if (admissionOutcome.decision.status !== 'RUNTIME_ADMITTED_SIMULATION') {
    throw new Error(`golden admission bundle for ${scenarioKey} did not reach RUNTIME_ADMITTED_SIMULATION: ${admissionOutcome.decision.status}`);
  }

  const baseId = `${admissionGolden.runtimeRequestId}-scheduler`;
  const schedulerRequestId = `${baseId}-request`;

  const schedulerPolicy = buildRuntimeSchedulerPolicy({
    runtime_scheduler_policy_id: `${baseId}-policy`,
    allow_required_stage_reference: true, allow_optional_stage_reference: true, allow_parallel_group_reference: true,
    allow_human_approval_wait_reference: true, allow_model_stage_reference: true, allow_tool_stage_reference: true,
    allow_workflow_stage_reference: true, allow_state_change_reference: true,
    maximum_scheduler_stage_count: 1000, maximum_parallel_group_count: 50, maximum_stages_per_parallel_group: 50,
    maximum_waiting_approval_stage_count: 100, maximum_model_stage_count: 100, maximum_tool_stage_count: 100,
    maximum_workflow_stage_count: 100, maximum_estimated_tokens: 100000000, maximum_estimated_cost_minor_units: 100000000
  });

  function buildSchedulerRequestWith(replayRef) {
    return buildRuntimeSchedulerRequest({
      runtime_scheduler_request_id: schedulerRequestId,
      runtime_scheduler_policy: schedulerPolicy,
      runtime_admission_request_reference: admissionGolden.admissionRequest,
      runtime_admission_decision_reference: admissionOutcome.decision,
      runtime_admission_result_reference: admissionOutcome.result,
      runtime_readiness_decision_reference: admissionGolden.readinessDecision,
      runtime_execution_package_reference: admissionGolden.runtimePackage,
      runtime_stage_manifest_reference: admissionGolden.runtimeStageManifest,
      runtime_dependency_manifest_reference: admissionGolden.runtimeDependencyManifest,
      runtime_budget_reference: admissionGolden.runtimeBudgetReference,
      runtime_capacity_snapshot_reference: admissionGolden.capacitySnapshotRef,
      runtime_concurrency_reference: admissionGolden.concurrencyRef,
      runtime_freshness_reference: admissionGolden.freshnessRef,
      runtime_replay_reference: replayRef,
      idempotency_reference: admissionGolden.idempotencyReference,
      runtime_stop_references: admissionGolden.runtimeStopRefs,
      runtime_compensation_references: admissionGolden.runtimeCompensationRefs,
      runtime_artifact_plan_reference: admissionGolden.runtimeArtifactPlan,
      runtime_event_plan_reference: admissionGolden.runtimeEventPlan,
      correlation_id: 'corr-scheduler-1',
      causation_id: 'cause-scheduler-1',
      trace_id: 'trace-scheduler-1',
      logical_sequence: 0,
      expected_scheduler_registry_version: 1,
      simulation_context: admissionGolden.gatewayRequest.simulation_context,
      ...overrides
    });
  }

  // The scheduler request's own `runtime_replay_reference` reuses the exact same, already fully
  // self-consistent RuntimeReadinessReplayReference the admission golden bundle produced --
  // admission_request_id/admission_request_fingerprint already describe admissionGolden.
  // admissionRequest exactly (see runtime-readiness-admission-test-data.js's own two-pass build),
  // and runtime-scheduler-boundary.js's own computeAdmissionRequestFingerprint recomputes the
  // identical value. No further pass is needed here.
  const schedulerRequest = buildSchedulerRequestWith(admissionGolden.replayRef);

  return {
    ...admissionGolden,
    schedulerRequestId, schedulerPolicy, admissionOutcome, schedulerRequest
  };
}

// Mirrors resyncReadinessRequest/resyncAdmissionRequest from the PR #104 test suite: after
// tampering any field of a scheduler request directly, the carried replay reference's own
// admission_request_fingerprint copy stays valid (it describes the *admission* request, never the
// scheduler request itself, so scheduler-layer tampering never invalidates it) -- but the request's
// own top-level content changed, so any test that wants to reach a *different* check further down
// the precedence order than replay must rebuild through the real builder to re-validate structurally.
function rebuildSchedulerRequest(request) {
  const { buildRuntimeSchedulerRequest: rebuild } = require('../../src/core/runtime-scheduler-request');
  return rebuild(request);
}

module.exports = {
  buildGoldenSchedulerBundle,
  computeAdmissionRequestFingerprint,
  evaluateRuntimeAdmissionRequest,
  evaluateRuntimeSchedulerRequest,
  omitReplayReference,
  rebuildSchedulerRequest
};
