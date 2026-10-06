'use strict';

const { buildRuntimeQueueAdmissionPolicy } = require('./runtime-queue-admission-policy');
const { buildRuntimeQueueClassReference } = require('./runtime-queue-class-reference');
const { buildRuntimeQueueCapacitySnapshotReference } = require('./runtime-queue-capacity-snapshot-reference');
const { buildRuntimeQueueQuotaReference } = require('./runtime-queue-quota-reference');
const { buildRuntimeQueueAdmissionReplayReference } = require('./runtime-queue-admission-replay-reference');
const { buildRuntimeQueueAdmissionRequest, RUNTIME_QUEUE_ADMISSION_REQUEST_VALIDATOR_VERSION } = require('./runtime-queue-admission-request');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');

function assembleRuntimeQueueAdmissionRequest(input = {}) {
  const { dispatchRequest, dispatchOutcome, officialModelSelectionDecisionReferences = [] } = input;
  if (!dispatchRequest || !dispatchOutcome || !Array.isArray(officialModelSelectionDecisionReferences)) throw new Error('runtime_queue_admission_assembler_missing_input');
  const { decision, result, package: dispatchPackage } = dispatchOutcome;
  if (!decision || !result || !dispatchPackage || decision.status !== 'DISPATCH_PACKAGE_PREPARED_SIMULATION') throw new Error('runtime_queue_admission_assembler_dispatch_not_prepared');
  for (const field of ['dispatch_applied', 'worker_reserved', 'worker_started', 'stage_dispatched', 'stage_started', 'executed']) {
    if (decision[field] !== false) throw new Error('runtime_queue_admission_assembler_dispatch_safety_invariant_failed');
  }
  if (decision.production_blocked !== true) throw new Error('runtime_queue_admission_assembler_dispatch_safety_invariant_failed');
  if (!dispatchRequest.registry_snapshot_reference) throw new Error('runtime_queue_admission_assembler_registry_snapshot_required');

  const baseId = `${dispatchRequest.runtime_dispatch_request_id}-queue-admission`;
  const requestId = `${baseId}-request`;
  const queueClassId = `${baseId}-queue-class-shared`;
  const queueClass = buildRuntimeQueueClassReference({
    runtime_queue_class_reference_id: queueClassId, queue_class_name: 'same-run-shared-queue-class',
    queue_class_type: 'SHARED_QUEUE_REFERENCE', queue_domain: 'GENERIC_DOMAIN', queue_priority_class: 'NORMAL_REFERENCE',
    queue_partition_strategy: 'TENANT_PARTITION_REFERENCE', queue_fairness_strategy: 'FIFO_WITHIN_PRIORITY_REFERENCE', queue_retry_class: 'NO_RETRY_REFERENCE',
    supported_stage_types: ['DETERMINISTIC_STAGE'], supported_capability_ids: [], supported_modality_ids: [], supported_model_provider_ids: [], supported_model_ids: [], supported_tool_ids: [], supported_workflow_ids: [],
    supports_no_llm: true, supports_model: false, supports_tool: false, supports_workflow: false, supports_parallel: true, supports_optional: true, supports_state_change: false,
    maximum_backlog_count: 1000, maximum_inflight_count: 1000, maximum_parallel_count: 100, maximum_model_count: 0, maximum_tool_count: 0, maximum_workflow_count: 0,
    maximum_tokens: 100000000, maximum_cost_minor_units: 100000000, maximum_logical_age_sequences: 100000, queue_class_active: true
  });
  const capacity = buildRuntimeQueueCapacitySnapshotReference({
    runtime_queue_capacity_snapshot_reference_id: `${baseId}-queue-capacity`, runtime_queue_class_reference_id: queueClassId,
    logical_sequence: dispatchRequest.logical_sequence, snapshot_valid_sequences: 100000, capacity_available: true,
    maximum_backlog_count: 1000, current_backlog_count: 0, available_backlog_count: 1000,
    maximum_inflight_count: 1000, current_inflight_count: 0, available_inflight_count: 1000,
    maximum_parallel_count: 100, current_parallel_count: 0, available_parallel_count: 100,
    maximum_model_count: 0, current_model_count: 0, available_model_count: 0,
    maximum_tool_count: 0, current_tool_count: 0, available_tool_count: 0,
    maximum_workflow_count: 0, current_workflow_count: 0, available_workflow_count: 0,
    maximum_tokens: 100000000, current_tokens: 0, available_tokens: 100000000,
    maximum_cost_minor_units: 100000000, current_cost_minor_units: 0, available_cost_minor_units: 100000000
  });
  const identities = [['tenant', dispatchPackage.tenant_id], ['organization', dispatchPackage.organization_id], ['project', dispatchPackage.project_id], ['agent', dispatchPackage.agent_id]];
  const quotas = identities.map(([scope, id]) => buildRuntimeQueueQuotaReference({
    runtime_queue_quota_reference_id: `${baseId}-quota-${scope}`, runtime_queue_class_reference_id: queueClassId,
    tenant_id: scope === 'tenant' ? id : null, organization_id: scope === 'organization' ? id : null,
    project_id: scope === 'project' ? id : null, agent_id: scope === 'agent' ? id : null,
    maximum_admission_count: 1000, current_admission_count: 0, available_admission_count: 1000,
    maximum_backlog_count: 1000, current_backlog_count: 0, available_backlog_count: 1000,
    maximum_parallel_count: 100, current_parallel_count: 0, available_parallel_count: 100,
    maximum_model_count: 0, current_model_count: 0, available_model_count: 0,
    maximum_tool_count: 0, current_tool_count: 0, available_tool_count: 0,
    maximum_workflow_count: 0, current_workflow_count: 0, available_workflow_count: 0,
    maximum_tokens: 100000000, current_tokens: 0, available_tokens: 100000000,
    maximum_cost_minor_units: 100000000, current_cost_minor_units: 0, available_cost_minor_units: 100000000
  }));
  const policy = buildRuntimeQueueAdmissionPolicy({
    runtime_queue_admission_policy_id: `${baseId}-policy`, allow_no_llm_queue_reference: true,
    allow_model_queue_reference: false, allow_tool_queue_reference: false, allow_workflow_queue_reference: false,
    allow_parallel_queue_reference: true, allow_shared_queue_reference: true, allow_dedicated_queue_reference: false,
    allow_optional_queue_reference: true, allow_retry_queue_reference: false, allow_dead_letter_reference: false, allow_state_change_reference: false,
    maximum_admission_entry_count: 1000, maximum_model_admission_count: 0, maximum_tool_admission_count: 0, maximum_workflow_admission_count: 0,
    maximum_parallel_admission_count: 1000, maximum_per_tenant_admission_count: 1000, maximum_per_organization_admission_count: 1000,
    maximum_per_project_admission_count: 1000, maximum_per_agent_admission_count: 1000, maximum_estimated_tokens: 100000000, maximum_estimated_cost_minor_units: 100000000
  });
  function buildRequest(replay) {
    return buildRuntimeQueueAdmissionRequest({
      runtime_queue_admission_request_id: requestId, runtime_queue_admission_policy: policy,
      runtime_dispatch_request_reference: dispatchRequest, runtime_dispatch_decision_reference: decision, runtime_dispatch_result_reference: result,
      runtime_dispatch_package_reference: dispatchPackage, runtime_dispatch_stage_references: dispatchOutcome.dispatchStageRefs,
      runtime_dispatch_worker_binding_references: dispatchOutcome.workerBindingRefs, runtime_dispatch_dependency_gate_references: dispatchOutcome.dependencyGateRefs,
      runtime_dispatch_approval_gate_references: dispatchOutcome.approvalGateRefs, runtime_dispatch_capacity_references: dispatchOutcome.capacityRefs,
      runtime_dispatch_budget_references: dispatchOutcome.budgetRefs, runtime_dispatch_payload_references: dispatchOutcome.payloadRefs,
      runtime_dispatch_intent_references: dispatchOutcome.intentRefs, runtime_dispatch_order_reference: dispatchOutcome.orderRef,
      runtime_dispatch_replay_reference: dispatchRequest.runtime_dispatch_replay_reference,
      runtime_queue_class_references: [queueClass], runtime_queue_capacity_snapshot_references: [capacity], runtime_queue_quota_references: quotas, runtime_queue_partition_references: [],
      runtime_capacity_snapshot_reference: dispatchRequest.runtime_capacity_snapshot_reference, runtime_concurrency_reference: dispatchRequest.runtime_concurrency_reference,
      runtime_budget_reference: dispatchRequest.runtime_budget_reference, runtime_freshness_reference: dispatchRequest.runtime_freshness_reference,
      idempotency_reference: dispatchRequest.idempotency_reference, registry_snapshot_reference: dispatchRequest.registry_snapshot_reference,
      network_permission_policy_references: dispatchRequest.network_permission_policy_references, secret_resolution_policy_references: dispatchRequest.secret_resolution_policy_references,
      runtime_worker_stage_policy_requirement_references: dispatchRequest.runtime_worker_stage_policy_requirement_references,
      runtime_scheduler_dependency_references: dispatchRequest.runtime_scheduler_dependency_references,
      official_model_selection_decision_references: officialModelSelectionDecisionReferences, runtime_queue_admission_replay_reference: replay,
      correlation_id: dispatchRequest.correlation_id, causation_id: dispatchRequest.causation_id, trace_id: dispatchRequest.trace_id,
      logical_sequence: dispatchRequest.logical_sequence, expected_queue_admission_registry_version: 1, simulation_context: dispatchRequest.simulation_context
    });
  }
  function buildReplay(fingerprint) {
    return buildRuntimeQueueAdmissionReplayReference({
      runtime_queue_admission_replay_reference_id: `${baseId}-replay`, runtime_queue_admission_request_id: requestId,
      runtime_queue_admission_request_fingerprint: fingerprint, runtime_dispatch_package_id: dispatchPackage.runtime_dispatch_package_id,
      runtime_dispatch_package_fingerprint: dispatchPackage.dispatch_package_fingerprint, runtime_dispatch_package_digest: dispatchPackage.dispatch_package_digest,
      runtime_dispatch_replay_reference_id: dispatchRequest.runtime_dispatch_replay_reference.runtime_dispatch_replay_reference_id,
      runtime_dispatch_replay_fingerprint: dispatchRequest.runtime_dispatch_replay_reference.replay_fingerprint,
      idempotency_reference_id: dispatchRequest.idempotency_reference.idempotency_reference_id,
      idempotency_fingerprint: dispatchRequest.idempotency_reference.idempotency_fingerprint,
      expected_queue_admission_attempt: 1, maximum_queue_admission_attempts: 5, replay_validated: true
    });
  }
  // The replay fingerprint excludes the replay reference itself. Building a fully validated
  // provisional Queue Admission request here duplicates the complete Planner→Dispatch lineage
  // only to omit replay again. Build the replay-free canonical envelope once, hash it, then
  // construct/validate the final request exactly once.
  const replayFreeEnvelope = {
    runtime_queue_admission_request_id: requestId, runtime_queue_admission_policy: policy,
    runtime_dispatch_request_reference: dispatchRequest, runtime_dispatch_decision_reference: decision, runtime_dispatch_result_reference: result,
    runtime_dispatch_package_reference: dispatchPackage, runtime_dispatch_stage_references: dispatchOutcome.dispatchStageRefs,
    runtime_dispatch_worker_binding_references: dispatchOutcome.workerBindingRefs, runtime_dispatch_dependency_gate_references: dispatchOutcome.dependencyGateRefs,
    runtime_dispatch_approval_gate_references: dispatchOutcome.approvalGateRefs, runtime_dispatch_capacity_references: dispatchOutcome.capacityRefs,
    runtime_dispatch_budget_references: dispatchOutcome.budgetRefs, runtime_dispatch_payload_references: dispatchOutcome.payloadRefs,
    runtime_dispatch_intent_references: dispatchOutcome.intentRefs, runtime_dispatch_order_reference: dispatchOutcome.orderRef,
    runtime_dispatch_replay_reference: dispatchRequest.runtime_dispatch_replay_reference,
    runtime_queue_class_references: [queueClass], runtime_queue_capacity_snapshot_references: [capacity], runtime_queue_quota_references: quotas, runtime_queue_partition_references: [],
    runtime_capacity_snapshot_reference: dispatchRequest.runtime_capacity_snapshot_reference, runtime_concurrency_reference: dispatchRequest.runtime_concurrency_reference,
    runtime_budget_reference: dispatchRequest.runtime_budget_reference, runtime_freshness_reference: dispatchRequest.runtime_freshness_reference,
    idempotency_reference: dispatchRequest.idempotency_reference, registry_snapshot_reference: dispatchRequest.registry_snapshot_reference,
    network_permission_policy_references: dispatchRequest.network_permission_policy_references, secret_resolution_policy_references: dispatchRequest.secret_resolution_policy_references,
    runtime_worker_stage_policy_requirement_references: dispatchRequest.runtime_worker_stage_policy_requirement_references,
    runtime_scheduler_dependency_references: dispatchRequest.runtime_scheduler_dependency_references,
    official_model_selection_decision_references: officialModelSelectionDecisionReferences,
    correlation_id: dispatchRequest.correlation_id, causation_id: dispatchRequest.causation_id, trace_id: dispatchRequest.trace_id,
    logical_sequence: dispatchRequest.logical_sequence, expected_queue_admission_registry_version: 1,
    simulation_context: dispatchRequest.simulation_context, validator_version: RUNTIME_QUEUE_ADMISSION_REQUEST_VALIDATOR_VERSION
  };
  const fingerprint = computeCanonicalContentDigest(replayFreeEnvelope);
  const finalReplay = buildReplay(fingerprint);
  return buildRequest(finalReplay);
}

module.exports = { assembleRuntimeQueueAdmissionRequest };
