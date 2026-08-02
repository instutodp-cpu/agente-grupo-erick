'use strict';

// Test-only helper that builds a fully self-consistent "golden" RuntimeQueueAdmissionRequest bundle
// on top of PR #107's own golden RuntimeDispatchRequest bundle -- the already-
// DISPATCH_PACKAGE_PREPARED_SIMULATION chain plus a single deterministic, generously-capacitied
// SHARED Queue Class compatible with the golden bundle's own (deterministic, no-LLM) stage
// composition.
const { buildGoldenDispatchBundle, evaluateRuntimeDispatchRequest } = require('./runtime-dispatch-simulation-test-data');
const { buildRuntimeQueueAdmissionPolicy } = require('../../src/core/runtime-queue-admission-policy');
const { buildRuntimeQueueClassReference } = require('../../src/core/runtime-queue-class-reference');
const { buildRuntimeQueueCapacitySnapshotReference } = require('../../src/core/runtime-queue-capacity-snapshot-reference');
const { buildRuntimeQueueQuotaReference } = require('../../src/core/runtime-queue-quota-reference');
const { buildRuntimeQueueAdmissionReplayReference } = require('../../src/core/runtime-queue-admission-replay-reference');
const { buildRuntimeQueueAdmissionRequest, omitQueueAdmissionReplayReference } = require('../../src/core/runtime-queue-admission-request');
const { evaluateRuntimeQueueAdmissionRequest } = require('../../src/core/runtime-queue-admission-boundary');
const { computeCanonicalContentDigest } = require('../../src/core/canonical-content-digest');

function buildGoldenQueueClassCatalog(baseId, canonical) {
  const queueClassId = `${baseId}-queue-class-shared`;
  const queueClass = buildRuntimeQueueClassReference({
    runtime_queue_class_reference_id: queueClassId,
    queue_class_name: 'golden-shared-queue-class',
    queue_class_type: 'SHARED_QUEUE_REFERENCE',
    queue_domain: 'GENERIC_DOMAIN',
    queue_priority_class: 'NORMAL_REFERENCE',
    queue_partition_strategy: 'TENANT_PARTITION_REFERENCE',
    queue_fairness_strategy: 'FIFO_WITHIN_PRIORITY_REFERENCE',
    queue_retry_class: 'NO_RETRY_REFERENCE',
    supports_no_llm: true, supports_model: true, supports_tool: true, supports_workflow: true,
    supports_parallel: true, supports_optional: true, supports_state_change: true,
    supported_stage_types: ['DETERMINISTIC_STAGE', 'MODEL_REFERENCE_STAGE', 'TOOL_REFERENCE_STAGE', 'WORKFLOW_REFERENCE_STAGE'],
    supported_capability_ids: [], supported_modality_ids: [], supported_model_provider_ids: [], supported_model_ids: [],
    supported_tool_ids: [], supported_workflow_ids: [],
    maximum_backlog_count: 1000, maximum_inflight_count: 1000, maximum_parallel_count: 100, maximum_model_count: 100,
    maximum_tool_count: 100, maximum_workflow_count: 100, maximum_tokens: 100000000, maximum_cost_minor_units: 100000000,
    maximum_logical_age_sequences: 100000,
    queue_class_active: true
  });

  const capacityId = `${baseId}-queue-capacity`;
  const capacitySnapshot = buildRuntimeQueueCapacitySnapshotReference({
    runtime_queue_capacity_snapshot_reference_id: capacityId,
    runtime_queue_class_reference_id: queueClassId,
    logical_sequence: 0,
    snapshot_valid_sequences: 100000,
    capacity_available: true,
    maximum_backlog_count: 1000, current_backlog_count: 0, available_backlog_count: 1000,
    maximum_inflight_count: 1000, current_inflight_count: 0, available_inflight_count: 1000,
    maximum_parallel_count: 100, current_parallel_count: 0, available_parallel_count: 100,
    maximum_model_count: 100, current_model_count: 0, available_model_count: 100,
    maximum_tool_count: 100, current_tool_count: 0, available_tool_count: 100,
    maximum_workflow_count: 100, current_workflow_count: 0, available_workflow_count: 100,
    maximum_tokens: 100000000, current_tokens: 0, available_tokens: 100000000,
    maximum_cost_minor_units: 100000000, current_cost_minor_units: 0, available_cost_minor_units: 100000000
  });

  const quotaId = `${baseId}-queue-quota-tenant`;
  const quota = buildRuntimeQueueQuotaReference({
    runtime_queue_quota_reference_id: quotaId,
    runtime_queue_class_reference_id: queueClassId,
    tenant_id: canonical.tenantId,
    maximum_admission_count: 1000, current_admission_count: 0, available_admission_count: 1000,
    maximum_backlog_count: 1000, current_backlog_count: 0, available_backlog_count: 1000,
    maximum_parallel_count: 100, current_parallel_count: 0, available_parallel_count: 100,
    maximum_model_count: 100, current_model_count: 0, available_model_count: 100,
    maximum_tool_count: 100, current_tool_count: 0, available_tool_count: 100,
    maximum_workflow_count: 100, current_workflow_count: 0, available_workflow_count: 100,
    maximum_tokens: 100000000, current_tokens: 0, available_tokens: 100000000,
    maximum_cost_minor_units: 100000000, current_cost_minor_units: 0, available_cost_minor_units: 100000000
  });

  return { queueClass, capacitySnapshot, quota };
}

function buildGoldenQueueAdmissionBundle(scenarioKey = 'prepared-no-llm-plan', overrides = {}) {
  const dispatchGolden = buildGoldenDispatchBundle(scenarioKey, overrides.dispatch);
  const dispatchOutcome = evaluateRuntimeDispatchRequest(dispatchGolden.dispatchRequest, {});
  if (dispatchOutcome.decision.status !== 'DISPATCH_PACKAGE_PREPARED_SIMULATION') {
    throw new Error(`golden dispatch bundle for ${scenarioKey} did not reach DISPATCH_PACKAGE_PREPARED_SIMULATION: ${dispatchOutcome.decision.status}`);
  }

  const baseId = `${dispatchGolden.baseId}-queue-admission`;
  const requestId = `${baseId}-request`;

  const canonical = {
    tenantId: dispatchOutcome.package.tenant_id, organizationId: dispatchOutcome.package.organization_id,
    projectId: dispatchOutcome.package.project_id, agentId: dispatchOutcome.package.agent_id
  };

  const policy = buildRuntimeQueueAdmissionPolicy({
    runtime_queue_admission_policy_id: `${baseId}-policy`,
    allow_no_llm_queue_reference: true, allow_model_queue_reference: true, allow_tool_queue_reference: true,
    allow_workflow_queue_reference: true, allow_parallel_queue_reference: true, allow_shared_queue_reference: true,
    allow_dedicated_queue_reference: true, allow_optional_queue_reference: true, allow_retry_queue_reference: true,
    allow_dead_letter_reference: true, allow_state_change_reference: true,
    maximum_admission_entry_count: 1000, maximum_model_admission_count: 1000, maximum_tool_admission_count: 1000,
    maximum_workflow_admission_count: 1000, maximum_parallel_admission_count: 1000,
    maximum_per_tenant_admission_count: 1000, maximum_per_organization_admission_count: 1000,
    maximum_per_project_admission_count: 1000, maximum_per_agent_admission_count: 1000,
    maximum_estimated_tokens: 100000000, maximum_estimated_cost_minor_units: 100000000,
    ...overrides.policy
  });

  const { queueClass, capacitySnapshot, quota } = buildGoldenQueueClassCatalog(baseId, canonical);

  const registrySnapshotRef = overrides.registrySnapshotRef === undefined ? null : overrides.registrySnapshotRef;

  function buildRequestWith(queueAdmissionReplayRef) {
    return buildRuntimeQueueAdmissionRequest({
      runtime_queue_admission_request_id: requestId,
      runtime_queue_admission_policy: policy,
      runtime_dispatch_request_reference: dispatchGolden.dispatchRequest,
      runtime_dispatch_decision_reference: dispatchOutcome.decision,
      runtime_dispatch_result_reference: dispatchOutcome.result,
      runtime_dispatch_package_reference: dispatchOutcome.package,
      runtime_dispatch_stage_references: dispatchOutcome.dispatchStageRefs,
      runtime_dispatch_worker_binding_references: dispatchOutcome.workerBindingRefs,
      runtime_dispatch_dependency_gate_references: dispatchOutcome.dependencyGateRefs,
      runtime_dispatch_approval_gate_references: dispatchOutcome.approvalGateRefs,
      runtime_dispatch_capacity_references: dispatchOutcome.capacityRefs,
      runtime_dispatch_budget_references: dispatchOutcome.budgetRefs,
      runtime_dispatch_payload_references: dispatchOutcome.payloadRefs,
      runtime_dispatch_intent_references: dispatchOutcome.intentRefs,
      runtime_dispatch_order_reference: dispatchOutcome.orderRef,
      runtime_dispatch_replay_reference: dispatchGolden.dispatchReplayRef,
      runtime_queue_class_references: [queueClass],
      runtime_queue_capacity_snapshot_references: [capacitySnapshot],
      runtime_queue_quota_references: [quota],
      runtime_queue_partition_references: [],
      runtime_capacity_snapshot_reference: dispatchGolden.capacitySnapshotRef,
      runtime_concurrency_reference: dispatchGolden.concurrencyRef,
      runtime_budget_reference: dispatchGolden.runtimeBudgetReference,
      runtime_freshness_reference: dispatchGolden.freshnessRef,
      idempotency_reference: dispatchGolden.schedulerRequest.idempotency_reference,
      registry_snapshot_reference: registrySnapshotRef,
      network_permission_policy_references: dispatchGolden.workerAssignmentRequest.network_permission_policy_references,
      secret_resolution_policy_references: dispatchGolden.workerAssignmentRequest.secret_resolution_policy_references,
      runtime_worker_stage_policy_requirement_references: dispatchGolden.workerAssignmentRequest.stage_policy_requirement_references,
      runtime_scheduler_dependency_references: dispatchGolden.dispatchRequest.runtime_scheduler_dependency_references,
      runtime_queue_admission_replay_reference: queueAdmissionReplayRef,
      correlation_id: 'corr-queue-admission-1',
      causation_id: 'cause-queue-admission-1',
      trace_id: 'trace-queue-admission-1',
      logical_sequence: 0,
      expected_queue_admission_registry_version: 1,
      simulation_context: dispatchGolden.gatewayRequest.simulation_context,
      ...overrides.request
    });
  }

  // Two-pass build: a throwaway request first (placeholder replay-bound request fingerprint) to
  // compute the genuine request fingerprint, then the real Queue Admission Replay Reference, then
  // the final request -- the same "self-referential validated-after-construction" pattern already
  // established throughout this whole lineage.
  const throwawayRequest = buildRequestWith(buildRuntimeQueueAdmissionReplayReference({
    runtime_queue_admission_replay_reference_id: `${baseId}-replay`,
    runtime_queue_admission_request_id: requestId,
    runtime_queue_admission_request_fingerprint: 'placeholder',
    runtime_dispatch_package_id: dispatchOutcome.package.runtime_dispatch_package_id,
    runtime_dispatch_package_fingerprint: dispatchOutcome.package.dispatch_package_fingerprint,
    runtime_dispatch_package_digest: dispatchOutcome.package.dispatch_package_digest,
    runtime_dispatch_replay_reference_id: dispatchGolden.dispatchReplayRef.runtime_dispatch_replay_reference_id,
    runtime_dispatch_replay_fingerprint: dispatchGolden.dispatchReplayRef.replay_fingerprint,
    idempotency_reference_id: dispatchGolden.schedulerRequest.idempotency_reference.idempotency_reference_id,
    idempotency_fingerprint: dispatchGolden.schedulerRequest.idempotency_reference.idempotency_fingerprint,
    expected_queue_admission_attempt: 1, maximum_queue_admission_attempts: 5, replay_validated: true
  }));
  void throwawayRequest;

  const requestFingerprint = computeCanonicalContentDigest(omitQueueAdmissionReplayReference(throwawayRequest));

  const queueAdmissionReplayRef = buildRuntimeQueueAdmissionReplayReference({
    runtime_queue_admission_replay_reference_id: `${baseId}-replay`,
    runtime_queue_admission_request_id: requestId,
    runtime_queue_admission_request_fingerprint: requestFingerprint,
    runtime_dispatch_package_id: dispatchOutcome.package.runtime_dispatch_package_id,
    runtime_dispatch_package_fingerprint: dispatchOutcome.package.dispatch_package_fingerprint,
    runtime_dispatch_package_digest: dispatchOutcome.package.dispatch_package_digest,
    runtime_dispatch_replay_reference_id: dispatchGolden.dispatchReplayRef.runtime_dispatch_replay_reference_id,
    runtime_dispatch_replay_fingerprint: dispatchGolden.dispatchReplayRef.replay_fingerprint,
    idempotency_reference_id: dispatchGolden.schedulerRequest.idempotency_reference.idempotency_reference_id,
    idempotency_fingerprint: dispatchGolden.schedulerRequest.idempotency_reference.idempotency_fingerprint,
    expected_queue_admission_attempt: 1, maximum_queue_admission_attempts: 5, replay_validated: true
  });

  const request = buildRequestWith(queueAdmissionReplayRef);

  return {
    ...dispatchGolden, dispatchOutcome, baseId, requestId, policy, queueClass, capacitySnapshot, quota,
    queueAdmissionReplayRef, queueAdmissionRequest: request
  };
}

module.exports = {
  buildGoldenQueueAdmissionBundle,
  buildGoldenQueueClassCatalog,
  evaluateRuntimeQueueAdmissionRequest
};
