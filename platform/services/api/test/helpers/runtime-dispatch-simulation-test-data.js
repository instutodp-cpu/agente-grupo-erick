'use strict';

// Test-only helper that builds a fully self-consistent "golden" RuntimeDispatchRequest on top of
// PR #106's own golden RuntimeWorkerAssignmentRequest bundle -- the already-
// WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION chain plus every worker/compatibility/candidate-set/
// assignment/policy-requirement reference that layer already produced, reused verbatim.
const {
  buildGoldenWorkerAssignmentBundle, evaluateRuntimeWorkerAssignmentRequest
} = require('./runtime-worker-assignment-test-data');
const { buildRuntimeDispatchPolicy } = require('../../src/core/runtime-dispatch-policy');
const { buildRuntimeDispatchRequest, omitDispatchReplayReference } = require('../../src/core/runtime-dispatch-request');
const { buildRuntimeDispatchReplayReference } = require('../../src/core/runtime-dispatch-replay-reference');
const { evaluateRuntimeDispatchRequest } = require('../../src/core/runtime-dispatch-boundary');
const { computeCanonicalContentDigest } = require('../../src/core/canonical-content-digest');

function buildGoldenDispatchBundle(scenarioKey = 'prepared-no-llm-plan', overrides = {}) {
  const workerAssignmentGolden = buildGoldenWorkerAssignmentBundle(scenarioKey, overrides.workerAssignment);
  const workerAssignmentOutcome = evaluateRuntimeWorkerAssignmentRequest(workerAssignmentGolden.workerAssignmentRequest, {});
  if (workerAssignmentOutcome.decision.status !== 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION') {
    throw new Error(`golden worker assignment bundle for ${scenarioKey} did not reach WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION: ${workerAssignmentOutcome.decision.status}`);
  }

  const baseId = `${workerAssignmentGolden.baseId}-dispatch`;
  const requestId = `${baseId}-request`;

  const dispatchPolicy = buildRuntimeDispatchPolicy({
    runtime_dispatch_policy_id: `${baseId}-policy`,
    allow_no_llm_dispatch_reference: true, allow_model_dispatch_reference: true, allow_tool_dispatch_reference: true,
    allow_workflow_dispatch_reference: true, allow_optional_stage_dispatch_reference: true,
    allow_parallel_stage_dispatch_reference: true, allow_state_change_reference: true,
    maximum_dispatch_intent_count: 1000, maximum_model_dispatch_intent_count: 1000, maximum_tool_dispatch_intent_count: 1000,
    maximum_workflow_dispatch_intent_count: 1000, maximum_parallel_dispatch_intent_count: 1000,
    maximum_estimated_tokens: 100000000, maximum_estimated_cost_minor_units: 100000000
  });

  const registrySnapshotRef = overrides.registrySnapshotRef === undefined ? null : overrides.registrySnapshotRef;

  function buildDispatchRequestWith(dispatchReplayRef) {
    return buildRuntimeDispatchRequest({
      runtime_dispatch_request_id: requestId,
      runtime_dispatch_policy: dispatchPolicy,
      runtime_worker_assignment_request_reference: workerAssignmentGolden.workerAssignmentRequest,
      runtime_worker_assignment_decision_reference: workerAssignmentOutcome.decision,
      runtime_worker_assignment_result_reference: workerAssignmentOutcome.result,
      runtime_worker_assignment_package_reference: workerAssignmentOutcome.package,
      runtime_scheduler_request_reference: workerAssignmentGolden.schedulerRequest,
      runtime_scheduler_decision_reference: workerAssignmentGolden.schedulerOutcome.decision,
      runtime_scheduler_result_reference: workerAssignmentGolden.schedulerOutcome.result,
      runtime_scheduler_package_reference: workerAssignmentGolden.schedulerOutcome.package,
      runtime_execution_package_reference: workerAssignmentGolden.runtimePackage,
      runtime_capacity_snapshot_reference: workerAssignmentGolden.capacitySnapshotRef,
      runtime_concurrency_reference: workerAssignmentGolden.concurrencyRef,
      runtime_budget_reference: workerAssignmentGolden.runtimeBudgetReference,
      runtime_freshness_reference: workerAssignmentGolden.freshnessRef,
      runtime_replay_reference: workerAssignmentGolden.schedulerRequest.runtime_replay_reference,
      idempotency_reference: workerAssignmentGolden.schedulerRequest.idempotency_reference,
      registry_snapshot_reference: registrySnapshotRef,
      runtime_dispatch_replay_reference: dispatchReplayRef,
      runtime_worker_references: workerAssignmentGolden.workerAssignmentRequest.runtime_worker_references,
      runtime_worker_capability_references: workerAssignmentGolden.workerAssignmentRequest.runtime_worker_capability_references,
      runtime_worker_capacity_references: workerAssignmentGolden.workerAssignmentRequest.runtime_worker_capacity_references,
      runtime_worker_health_references: workerAssignmentGolden.workerAssignmentRequest.runtime_worker_health_references,
      runtime_worker_compatibility_references: workerAssignmentOutcome.compatibilityRefs,
      runtime_worker_candidate_set_references: workerAssignmentOutcome.candidateSets,
      runtime_worker_stage_assignment_references: workerAssignmentOutcome.assignmentRefs,
      runtime_worker_stage_policy_requirement_references: workerAssignmentGolden.workerAssignmentRequest.stage_policy_requirement_references,
      network_permission_policy_references: workerAssignmentGolden.workerAssignmentRequest.network_permission_policy_references,
      secret_resolution_policy_references: workerAssignmentGolden.workerAssignmentRequest.secret_resolution_policy_references,
      correlation_id: 'corr-dispatch-1',
      causation_id: 'cause-dispatch-1',
      trace_id: 'trace-dispatch-1',
      logical_sequence: 0,
      expected_dispatch_registry_version: 1,
      simulation_context: workerAssignmentGolden.gatewayRequest.simulation_context,
      ...overrides.request
    });
  }

  // A dispatch replay reference genuinely bound to the exact fingerprints/digests this evaluation
  // will use -- built via a throwaway request pass first (mirroring the "two-pass build" pattern
  // already established for replay-bearing requests throughout this lineage) so the replay
  // reference's own claimed request fingerprint is byte-identical to the final request's own.
  const throwawayRequest = buildDispatchRequestWith(buildRuntimeDispatchReplayReference({
    runtime_dispatch_replay_reference_id: `${baseId}-replay`,
    runtime_dispatch_request_id: requestId,
    runtime_dispatch_request_fingerprint: 'placeholder',
    runtime_worker_assignment_package_id: workerAssignmentOutcome.package.runtime_worker_assignment_package_id,
    runtime_worker_assignment_package_fingerprint: workerAssignmentOutcome.package.worker_assignment_package_fingerprint,
    runtime_worker_assignment_package_digest: workerAssignmentOutcome.package.worker_assignment_package_digest,
    runtime_scheduler_package_id: workerAssignmentGolden.schedulerOutcome.package.runtime_scheduler_package_id,
    runtime_scheduler_package_fingerprint: workerAssignmentGolden.schedulerOutcome.decision.runtime_scheduler_package_fingerprint,
    runtime_scheduler_package_digest: workerAssignmentGolden.schedulerOutcome.decision.runtime_scheduler_package_digest,
    runtime_execution_package_id: workerAssignmentGolden.runtimePackage.runtime_execution_package_id,
    runtime_execution_package_fingerprint: workerAssignmentGolden.runtimePackage.package_fingerprint,
    runtime_execution_package_digest: workerAssignmentGolden.runtimePackage.package_digest,
    idempotency_reference_id: workerAssignmentGolden.schedulerRequest.idempotency_reference.idempotency_reference_id,
    idempotency_fingerprint: workerAssignmentGolden.schedulerRequest.idempotency_reference.idempotency_fingerprint,
    expected_dispatch_attempt: 1, maximum_dispatch_attempts: 5, replay_validated: true
  }));
  void throwawayRequest;

  // pr107: `runtime_dispatch_request_fingerprint` on the Dispatch Replay Reference genuinely
  // describes the final request (minus the replay reference field itself, the same canonical
  // exclusion `omitDispatchReplayReference` already applies) -- computed here exactly the way
  // runtime-dispatch-boundary.js itself will recompute it.
  const requestFingerprint = computeCanonicalContentDigest(omitDispatchReplayReference(throwawayRequest));

  const dispatchReplayRef = buildRuntimeDispatchReplayReference({
    runtime_dispatch_replay_reference_id: `${baseId}-replay`,
    runtime_dispatch_request_id: requestId,
    runtime_dispatch_request_fingerprint: requestFingerprint,
    runtime_worker_assignment_package_id: workerAssignmentOutcome.package.runtime_worker_assignment_package_id,
    runtime_worker_assignment_package_fingerprint: workerAssignmentOutcome.package.worker_assignment_package_fingerprint,
    runtime_worker_assignment_package_digest: workerAssignmentOutcome.package.worker_assignment_package_digest,
    runtime_scheduler_package_id: workerAssignmentGolden.schedulerOutcome.package.runtime_scheduler_package_id,
    runtime_scheduler_package_fingerprint: workerAssignmentGolden.schedulerOutcome.decision.runtime_scheduler_package_fingerprint,
    runtime_scheduler_package_digest: workerAssignmentGolden.schedulerOutcome.decision.runtime_scheduler_package_digest,
    runtime_execution_package_id: workerAssignmentGolden.runtimePackage.runtime_execution_package_id,
    runtime_execution_package_fingerprint: workerAssignmentGolden.runtimePackage.package_fingerprint,
    runtime_execution_package_digest: workerAssignmentGolden.runtimePackage.package_digest,
    idempotency_reference_id: workerAssignmentGolden.schedulerRequest.idempotency_reference.idempotency_reference_id,
    idempotency_fingerprint: workerAssignmentGolden.schedulerRequest.idempotency_reference.idempotency_fingerprint,
    expected_dispatch_attempt: 1, maximum_dispatch_attempts: 5, replay_validated: true
  });

  const request = buildDispatchRequestWith(dispatchReplayRef);

  return {
    ...workerAssignmentGolden, workerAssignmentOutcome, baseId, requestId, dispatchPolicy, dispatchReplayRef,
    dispatchRequest: request
  };
}

module.exports = {
  buildGoldenDispatchBundle,
  evaluateRuntimeDispatchRequest
};
