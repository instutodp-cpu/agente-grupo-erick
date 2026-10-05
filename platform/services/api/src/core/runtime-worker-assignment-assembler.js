'use strict';

const { buildRuntimeWorkerAssignmentPolicy } = require('./runtime-worker-assignment-policy');
const { buildRuntimeWorkerReference } = require('./runtime-worker-reference');
const { buildRuntimeWorkerCapabilityReference } = require('./runtime-worker-capability-reference');
const { buildRuntimeWorkerCapacityReference } = require('./runtime-worker-capacity-reference');
const { buildRuntimeWorkerHealthReference } = require('./runtime-worker-health-reference');
const { buildRuntimeWorkerAssignmentRequest } = require('./runtime-worker-assignment-request');

function assembleRuntimeWorkerAssignmentRequest(input = {}) {
  const { schedulerRequest, schedulerOutcome } = input;
  if (!schedulerRequest || !schedulerOutcome) throw new Error('runtime_worker_assignment_assembler_missing_input');
  if (schedulerOutcome.decision.status !== 'SCHEDULER_PACKAGE_PREPARED_SIMULATION') {
    throw new Error('runtime_worker_assignment_assembler_scheduler_not_prepared');
  }
  for (const field of ['scheduler_started', 'queue_created', 'worker_started', 'stage_dispatched', 'executed']) {
    if (schedulerOutcome.decision[field] !== false) throw new Error('runtime_worker_assignment_assembler_scheduler_safety_invariant_failed');
  }
  if (schedulerOutcome.decision.production_blocked !== true) throw new Error('runtime_worker_assignment_assembler_scheduler_safety_invariant_failed');

  const runtimePackage = schedulerRequest.runtime_execution_package_reference;
  if (schedulerOutcome.package.runtime_execution_package_id !== runtimePackage.runtime_execution_package_id) {
    throw new Error('runtime_worker_assignment_assembler_package_drift');
  }

  const baseId = `${schedulerRequest.runtime_scheduler_request_id}-worker-assignment`;
  const workerId = `${baseId}-worker`;
  const stages = schedulerRequest.runtime_stage_manifest_reference.runtime_stage_references;
  const deterministicStageTypes = [...new Set(stages
    .filter((stage) => stage.model_selection_reference_id === null && stage.tool_reference_ids.length === 0 && stage.workflow_reference_id === null)
    .map((stage) => stage.stage_type))].sort();
  const capability = buildRuntimeWorkerCapabilityReference({
    worker_capability_reference_id: `${baseId}-capability`, runtime_worker_reference_id: workerId,
    capability_ids: [], modality_ids: [], stage_type_ids: deterministicStageTypes, model_provider_ids: [], model_ids: [], tool_ids: [], workflow_ids: [],
    supports_no_llm: true, supports_model_reference: false, supports_tool_reference: false, supports_workflow_reference: false,
    supports_parallel_reference: true, supports_state_change_reference: false
  });
  const capacity = buildRuntimeWorkerCapacityReference({
    worker_capacity_reference_id: `${baseId}-capacity`, runtime_worker_reference_id: workerId,
    maximum_stage_assignments: 100, current_stage_assignments: 0, available_stage_assignments: 100,
    maximum_parallel_assignments: 50, current_parallel_assignments: 0, available_parallel_assignments: 50,
    maximum_model_assignments: 0, current_model_assignments: 0, available_model_assignments: 0,
    maximum_tool_assignments: 0, current_tool_assignments: 0, available_tool_assignments: 0,
    maximum_workflow_assignments: 0, current_workflow_assignments: 0, available_workflow_assignments: 0,
    maximum_token_capacity: 10000000, used_token_capacity: 0, available_token_capacity: 10000000,
    maximum_cost_capacity_minor_units: 10000000, used_cost_capacity_minor_units: 0, available_cost_capacity_minor_units: 10000000,
    capacity_available: true
  });
  const health = buildRuntimeWorkerHealthReference({
    worker_health_reference_id: `${baseId}-health`, runtime_worker_reference_id: workerId,
    health_status: 'HEALTHY_REFERENCE_SIMULATION', health_source_type: 'simulation_declared_reference',
    health_created_logical_sequence: 0, current_logical_sequence: 0, maximum_valid_sequences: 1000,
    configuration_valid: true, registration_valid: true, capability_reference_valid: true, capacity_reference_valid: true, policy_references_valid: true
  });
  const worker = buildRuntimeWorkerReference({
    runtime_worker_reference_id: workerId, runtime_environment_reference_id: `${baseId}-environment`, runtime_registry_snapshot_reference_id: `${baseId}-registry-snapshot`,
    worker_type: 'SHARED_REFERENCE', worker_classification: 'DETERMINISTIC_WORKER_REFERENCE', worker_status: 'WORKER_AVAILABLE_REFERENCE_SIMULATION',
    agent_scope_ids: [], supported_stage_types: deterministicStageTypes, supported_modalities: [], supported_capability_ids: [], supported_model_provider_ids: [], supported_model_ids: [], supported_tool_ids: [], supported_workflow_ids: [],
    network_policy_reference_id: `${baseId}-network-policy`, secret_policy_reference_id: `${baseId}-secpolicy-reference`, effect_policy_reference_id: `${baseId}-effect-policy`,
    worker_capability_reference_id: capability.worker_capability_reference_id, worker_capacity_reference_id: capacity.worker_capacity_reference_id, worker_health_reference_id: health.worker_health_reference_id,
    maximum_parallel_assignments: 50, current_parallel_assignments: 0
  });
  const policy = buildRuntimeWorkerAssignmentPolicy({
    runtime_worker_assignment_policy_id: `${baseId}-policy`, allow_local_worker_reference: true, allow_remote_worker_reference: true,
    allow_shared_worker_reference: true, allow_dedicated_worker_reference: true, allow_no_llm_stage: true, allow_model_stage: false,
    allow_tool_stage: false, allow_workflow_stage: false, allow_parallel_stage: true, allow_state_change_reference: false,
    maximum_worker_candidates_per_stage: 100, maximum_stages_per_worker_reference: 1000, maximum_parallel_stages_per_worker_reference: 1000,
    maximum_model_stages_per_worker_reference: 0, maximum_tool_stages_per_worker_reference: 0, maximum_workflow_stages_per_worker_reference: 0,
    maximum_estimated_tokens_per_worker_reference: 100000000, maximum_estimated_cost_minor_units_per_worker_reference: 100000000
  });

  return buildRuntimeWorkerAssignmentRequest({
    runtime_worker_assignment_request_id: `${baseId}-request`, runtime_worker_assignment_policy: policy,
    runtime_scheduler_request_reference: schedulerRequest, runtime_scheduler_decision_reference: schedulerOutcome.decision,
    runtime_scheduler_result_reference: schedulerOutcome.result, runtime_scheduler_package_reference: schedulerOutcome.package,
    runtime_execution_package_reference: runtimePackage, runtime_stage_manifest_reference: schedulerRequest.runtime_stage_manifest_reference,
    runtime_capacity_snapshot_reference: schedulerRequest.runtime_capacity_snapshot_reference, runtime_concurrency_reference: schedulerRequest.runtime_concurrency_reference,
    runtime_freshness_reference: schedulerRequest.runtime_freshness_reference, runtime_replay_reference: schedulerRequest.runtime_replay_reference,
    idempotency_reference: schedulerRequest.idempotency_reference, runtime_worker_references: [worker], runtime_worker_capability_references: [capability],
    runtime_worker_capacity_references: [capacity], runtime_worker_health_references: [health], runtime_worker_network_policy_references: [],
    runtime_worker_secret_policy_references: [], network_permission_policy_references: [], secret_resolution_policy_references: [], stage_policy_requirement_references: [],
    model_selection_decision_references: [], tool_contract_references: [], workflow_contract_references: [], registry_snapshot_reference: null,
    correlation_id: schedulerRequest.correlation_id, causation_id: schedulerRequest.causation_id, trace_id: schedulerRequest.trace_id,
    logical_sequence: schedulerRequest.logical_sequence, expected_worker_assignment_registry_version: 1, simulation_context: schedulerRequest.simulation_context
  });
}

module.exports = { assembleRuntimeWorkerAssignmentRequest };
