'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const {
  RUNTIME_EXECUTION_SIMULATION_STATUSES, RUNTIME_DECISIONS, RUNTIME_NEXT_STATES, STATUS_OUTCOME_MAP, DEFAULT_OUTCOME
} = require('./runtime-execution-simulation-decision');

const RUNTIME_EXECUTION_SIMULATION_RESULT_VALIDATOR_VERSION = 'runtime_execution_simulation_result_validator_v1';

const RUNTIME_EXECUTION_SIMULATION_RESULT_FIELDS = Object.freeze([
  'runtime_result_id', 'runtime_request_id', 'runtime_decision_id', 'runtime_execution_package_id',
  'execution_plan_id', 'gateway_decision_id', 'gateway_result_id', 'tenant_id', 'organization_id', 'project_id',
  'session_reference_id', 'agent_id', 'actor_id', 'status', 'decision', 'next_state', 'runtime_request_fingerprint',
  'runtime_decision_fingerprint', 'runtime_package_fingerprint', 'runtime_package_digest', 'registry_version',
  'runtime_stage_count', 'runtime_dependency_count', 'runtime_stop_count', 'runtime_compensation_count',
  'planned_artifact_count', 'planned_event_count', 'estimated_input_tokens', 'estimated_output_tokens',
  'estimated_total_tokens', 'estimated_total_cost_minor_units', 'blockers', 'reason_codes', 'runtime_evaluated',
  'runtime_package_prepared_in_simulation', 'runtime_admitted_in_simulation', 'runtime_enabled',
  'execution_authorized', 'execution_started', 'stage_started', 'stage_completed', 'agent_executed', 'model_called',
  'provider_called', 'tool_called', 'workflow_executed', 'network_used', 'memory_read', 'memory_written',
  'tokens_reserved', 'tokens_consumed', 'cost_reserved', 'cost_consumed', 'job_created', 'queue_used',
  'worker_started', 'scheduler_started', 'dependency_applied', 'stop_condition_evaluated', 'stop_applied',
  'compensation_executed', 'artifact_created', 'event_emitted', 'executed', 'simulation', 'production_blocked',
  'rollout_percentage', 'validator_version'
]);

const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  runtime_admitted_in_simulation: false,
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  stage_started: false,
  stage_completed: false,
  agent_executed: false,
  model_called: false,
  provider_called: false,
  tool_called: false,
  workflow_executed: false,
  network_used: false,
  memory_read: false,
  memory_written: false,
  tokens_reserved: false,
  tokens_consumed: false,
  cost_reserved: false,
  cost_consumed: false,
  job_created: false,
  queue_used: false,
  worker_started: false,
  scheduler_started: false,
  dependency_applied: false,
  stop_condition_evaluated: false,
  stop_applied: false,
  compensation_executed: false,
  artifact_created: false,
  event_emitted: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;
const MAX_COUNT = 100000;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeExecutionSimulationResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['runtime_execution_simulation_result_must_be_object'] };
  exactFields(result, RUNTIME_EXECUTION_SIMULATION_RESULT_FIELDS, 'runtime_execution_simulation_result', errors);
  for (const field of [
    'runtime_result_id', 'runtime_request_id', 'runtime_decision_id', 'runtime_execution_package_id',
    'execution_plan_id', 'gateway_decision_id', 'gateway_result_id', 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'agent_id', 'actor_id', 'runtime_request_fingerprint', 'runtime_decision_fingerprint',
    'runtime_package_fingerprint', 'runtime_package_digest', 'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_EXECUTION_SIMULATION_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!RUNTIME_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!RUNTIME_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[result.status] || DEFAULT_OUTCOME;
  if (result.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (result.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  for (const field of [
    'runtime_stage_count', 'runtime_dependency_count', 'runtime_stop_count', 'runtime_compensation_count',
    'planned_artifact_count', 'planned_event_count', 'estimated_input_tokens', 'estimated_output_tokens',
    'estimated_total_tokens', 'estimated_total_cost_minor_units'
  ]) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }

  if (!isSanitizedList(result.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(result.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  if (typeof result.runtime_evaluated !== 'boolean') errors.push('runtime_evaluated_must_be_boolean');
  if (result.runtime_evaluated !== true) errors.push('runtime_evaluated_must_be_true');
  if (typeof result.runtime_package_prepared_in_simulation !== 'boolean') errors.push('runtime_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = result.status === 'RUNTIME_PACKAGE_PREPARED_SIMULATION';
  if (result.runtime_package_prepared_in_simulation !== expectedPrepared) errors.push('runtime_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (result.validator_version !== RUNTIME_EXECUTION_SIMULATION_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// A thin envelope over the RuntimeExecutionSimulationDecision this evaluation already produced --
// never an independent source of truth. status/decision/next_state are always copied, never
// re-derived.
function buildRuntimeExecutionSimulationResult(input = {}) {
  const status = RUNTIME_EXECUTION_SIMULATION_STATUSES.includes(input.status) ? input.status : 'RUNTIME_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const result = {
    runtime_result_id: input.runtime_result_id,
    runtime_request_id: input.runtime_request_id,
    runtime_decision_id: input.runtime_decision_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    gateway_decision_id: input.gateway_decision_id,
    gateway_result_id: input.gateway_result_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    runtime_request_fingerprint: input.runtime_request_fingerprint || 'fingerprint_not_available',
    runtime_decision_fingerprint: input.runtime_decision_fingerprint || 'fingerprint_not_available',
    runtime_package_fingerprint: input.runtime_package_fingerprint || 'fingerprint_not_available',
    runtime_package_digest: input.runtime_package_digest || 'digest_not_available',
    registry_version: input.registry_version || 'registry_version_not_available',
    runtime_stage_count: Number.isInteger(input.runtime_stage_count) ? input.runtime_stage_count : 0,
    runtime_dependency_count: Number.isInteger(input.runtime_dependency_count) ? input.runtime_dependency_count : 0,
    runtime_stop_count: Number.isInteger(input.runtime_stop_count) ? input.runtime_stop_count : 0,
    runtime_compensation_count: Number.isInteger(input.runtime_compensation_count) ? input.runtime_compensation_count : 0,
    planned_artifact_count: Number.isInteger(input.planned_artifact_count) ? input.planned_artifact_count : 0,
    planned_event_count: Number.isInteger(input.planned_event_count) ? input.planned_event_count : 0,
    estimated_input_tokens: Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0,
    estimated_output_tokens: Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0,
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_total_cost_minor_units: Number.isInteger(input.estimated_total_cost_minor_units) ? input.estimated_total_cost_minor_units : 0,
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    runtime_evaluated: true,
    runtime_package_prepared_in_simulation: status === 'RUNTIME_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_SIMULATION_RESULT_VALIDATOR_VERSION
  };

  const validation = validateRuntimeExecutionSimulationResult(result);
  if (!validation.valid) {
    throw new Error(`runtime_execution_simulation_result_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(result);
}

module.exports = {
  MAX_BLOCKERS,
  MAX_COUNT,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  RUNTIME_EXECUTION_SIMULATION_RESULT_FIELDS,
  RUNTIME_EXECUTION_SIMULATION_RESULT_VALIDATOR_VERSION,
  buildRuntimeExecutionSimulationResult,
  validateRuntimeExecutionSimulationResult
};
