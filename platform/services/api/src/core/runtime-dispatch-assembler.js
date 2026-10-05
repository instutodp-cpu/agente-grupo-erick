'use strict';

const { buildRuntimeDispatchPolicy } = require('./runtime-dispatch-policy');
const { buildRuntimeDispatchRequest, omitDispatchReplayReference } = require('./runtime-dispatch-request');
const { buildRuntimeDispatchReplayReference } = require('./runtime-dispatch-replay-reference');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');

function assembleRuntimeDispatchRequest(input = {}) {
  const { workerAssignmentRequest, workerAssignmentOutcome, schedulerDependencyRefs } = input;
  if (!workerAssignmentRequest || !workerAssignmentOutcome || !Array.isArray(schedulerDependencyRefs)) throw new Error('runtime_dispatch_assembler_missing_input');
  const { decision, result, package: workerPackage } = workerAssignmentOutcome;
  if (!decision || !result || !workerPackage || decision.status !== 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION') throw new Error('runtime_dispatch_assembler_worker_assignment_not_prepared');
  for (const field of ['worker_assignment_applied', 'worker_reserved', 'worker_started', 'stage_dispatched', 'stage_started', 'executed']) {
    if (decision[field] !== false) throw new Error('runtime_dispatch_assembler_worker_assignment_safety_invariant_failed');
  }
  if (decision.production_blocked !== true) throw new Error('runtime_dispatch_assembler_worker_assignment_safety_invariant_failed');

  const schedulerRequest = workerAssignmentRequest.runtime_scheduler_request_reference;
  const schedulerDecision = workerAssignmentRequest.runtime_scheduler_decision_reference;
  const schedulerResult = workerAssignmentRequest.runtime_scheduler_result_reference;
  const schedulerPackage = workerAssignmentRequest.runtime_scheduler_package_reference;
  const runtimePackage = workerAssignmentRequest.runtime_execution_package_reference;
  if (workerPackage.runtime_scheduler_package_id !== schedulerPackage.runtime_scheduler_package_id || workerPackage.runtime_execution_package_id !== runtimePackage.runtime_execution_package_id) throw new Error('runtime_dispatch_assembler_package_drift');

  const baseId = workerAssignmentRequest.runtime_worker_assignment_request_id + '-dispatch';
  const requestId = baseId + '-request';
  const policy = buildRuntimeDispatchPolicy({
    runtime_dispatch_policy_id: baseId + '-policy',
    allow_no_llm_dispatch_reference: true, allow_model_dispatch_reference: false,
    allow_tool_dispatch_reference: false, allow_workflow_dispatch_reference: false,
    allow_optional_stage_dispatch_reference: true, allow_parallel_stage_dispatch_reference: true,
    allow_state_change_reference: false, maximum_dispatch_intent_count: 1000,
    maximum_model_dispatch_intent_count: 0, maximum_tool_dispatch_intent_count: 0,
    maximum_workflow_dispatch_intent_count: 0, maximum_parallel_dispatch_intent_count: 1000,
    maximum_estimated_tokens: 100000000, maximum_estimated_cost_minor_units: 100000000
  });

  function buildRequest(replay) {
    return buildRuntimeDispatchRequest({
      runtime_dispatch_request_id: requestId, runtime_dispatch_policy: policy,
      runtime_worker_assignment_request_reference: workerAssignmentRequest,
      runtime_worker_assignment_decision_reference: decision, runtime_worker_assignment_result_reference: result,
      runtime_worker_assignment_package_reference: workerPackage, runtime_scheduler_request_reference: schedulerRequest,
      runtime_scheduler_decision_reference: schedulerDecision, runtime_scheduler_result_reference: schedulerResult,
      runtime_scheduler_package_reference: schedulerPackage, runtime_execution_package_reference: runtimePackage,
      runtime_capacity_snapshot_reference: workerAssignmentRequest.runtime_capacity_snapshot_reference,
      runtime_concurrency_reference: workerAssignmentRequest.runtime_concurrency_reference,
      runtime_budget_reference: schedulerRequest.runtime_budget_reference,
      runtime_freshness_reference: workerAssignmentRequest.runtime_freshness_reference,
      runtime_replay_reference: workerAssignmentRequest.runtime_replay_reference,
      idempotency_reference: workerAssignmentRequest.idempotency_reference,
      registry_snapshot_reference: workerAssignmentRequest.registry_snapshot_reference,
      runtime_dispatch_replay_reference: replay, runtime_worker_references: workerAssignmentRequest.runtime_worker_references,
      runtime_worker_capability_references: workerAssignmentRequest.runtime_worker_capability_references,
      runtime_worker_capacity_references: workerAssignmentRequest.runtime_worker_capacity_references,
      runtime_worker_health_references: workerAssignmentRequest.runtime_worker_health_references,
      runtime_worker_compatibility_references: workerAssignmentOutcome.compatibilityRefs,
      runtime_worker_candidate_set_references: workerAssignmentOutcome.candidateSets,
      runtime_worker_stage_assignment_references: workerAssignmentOutcome.assignmentRefs,
      runtime_worker_stage_policy_requirement_references: workerAssignmentRequest.stage_policy_requirement_references,
      network_permission_policy_references: workerAssignmentRequest.network_permission_policy_references,
      secret_resolution_policy_references: workerAssignmentRequest.secret_resolution_policy_references,
      runtime_scheduler_dependency_references: schedulerDependencyRefs,
      correlation_id: workerAssignmentRequest.correlation_id, causation_id: workerAssignmentRequest.causation_id,
      trace_id: workerAssignmentRequest.trace_id, logical_sequence: workerAssignmentRequest.logical_sequence,
      expected_dispatch_registry_version: 1, simulation_context: workerAssignmentRequest.simulation_context
    });
  }

  function buildReplay(requestFingerprint) {
    return buildRuntimeDispatchReplayReference({
      runtime_dispatch_replay_reference_id: baseId + '-replay', runtime_dispatch_request_id: requestId,
      runtime_dispatch_request_fingerprint: requestFingerprint,
      runtime_worker_assignment_package_id: workerPackage.runtime_worker_assignment_package_id,
      runtime_worker_assignment_package_fingerprint: decision.runtime_worker_assignment_package_fingerprint,
      runtime_worker_assignment_package_digest: decision.runtime_worker_assignment_package_digest,
      runtime_scheduler_package_id: schedulerPackage.runtime_scheduler_package_id,
      runtime_scheduler_package_fingerprint: schedulerDecision.runtime_scheduler_package_fingerprint,
      runtime_scheduler_package_digest: schedulerDecision.runtime_scheduler_package_digest,
      runtime_execution_package_id: runtimePackage.runtime_execution_package_id,
      runtime_execution_package_fingerprint: runtimePackage.package_fingerprint,
      runtime_execution_package_digest: runtimePackage.package_digest,
      idempotency_reference_id: workerAssignmentRequest.idempotency_reference.idempotency_reference_id,
      idempotency_fingerprint: workerAssignmentRequest.idempotency_reference.idempotency_fingerprint,
      expected_dispatch_attempt: 1, maximum_dispatch_attempts: 5, replay_validated: true
    });
  }

  const provisionalRequest = buildRequest(buildReplay('placeholder'));
  const requestFingerprint = computeCanonicalContentDigest(omitDispatchReplayReference(provisionalRequest));
  return buildRequest(buildReplay(requestFingerprint));
}

module.exports = { assembleRuntimeDispatchRequest };
