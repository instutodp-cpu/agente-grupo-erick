'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const {
  RUNTIME_ADMISSION_STATUSES, RUNTIME_ADMISSION_DECISIONS, RUNTIME_ADMISSION_NEXT_STATES, STATUS_OUTCOME_MAP,
  DEFAULT_OUTCOME
} = require('./runtime-admission-decision');

const RUNTIME_ADMISSION_RESULT_VALIDATOR_VERSION = 'runtime_admission_result_validator_v1';

const REQUESTED_SLOT_FIELDS = Object.freeze([
  'requested_package_slots', 'requested_stage_slots', 'requested_parallel_stage_slots',
  'requested_model_stage_slots', 'requested_tool_stage_slots', 'requested_workflow_stage_slots'
]);

const RUNTIME_ADMISSION_RESULT_FIELDS = Object.freeze([
  'runtime_admission_result_id', 'runtime_admission_request_id', 'runtime_admission_decision_id',
  'runtime_readiness_decision_id', 'runtime_execution_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  'runtime_admission_request_fingerprint', 'runtime_admission_decision_fingerprint',
  'runtime_readiness_decision_fingerprint', 'runtime_execution_package_fingerprint',
  'runtime_execution_package_digest', 'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint',
  'registry_version',
  ...REQUESTED_SLOT_FIELDS, 'estimated_total_tokens', 'estimated_total_cost_minor_units',
  'blockers', 'reason_codes',
  'runtime_readiness_evaluated', 'runtime_ready_in_simulation', 'runtime_admission_evaluated',
  'runtime_admitted_in_simulation',
  'runtime_enabled', 'execution_authorized', 'execution_started', 'stage_started', 'stage_completed',
  'stage_failed', 'agent_executed', 'model_called', 'provider_called', 'tool_called', 'workflow_executed',
  'network_used', 'memory_read', 'memory_written', 'tokens_reserved', 'tokens_consumed', 'cost_reserved',
  'cost_consumed', 'job_created', 'queue_used', 'worker_started', 'scheduler_started', 'dependency_satisfied',
  'dependency_applied', 'stop_condition_evaluated', 'stop_applied', 'compensation_executed', 'artifact_created',
  'event_emitted', 'executed',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  stage_started: false,
  stage_completed: false,
  stage_failed: false,
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
  dependency_satisfied: false,
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

function validateRuntimeAdmissionResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['runtime_admission_result_must_be_object'] };
  exactFields(result, RUNTIME_ADMISSION_RESULT_FIELDS, 'runtime_admission_result', errors);
  for (const field of [
    'runtime_admission_result_id', 'runtime_admission_request_id', 'runtime_admission_decision_id',
    'runtime_readiness_decision_id', 'runtime_execution_package_id', 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'agent_id', 'actor_id', 'runtime_admission_request_fingerprint',
    'runtime_admission_decision_fingerprint', 'runtime_readiness_decision_fingerprint',
    'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
    'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint', 'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_ADMISSION_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!RUNTIME_ADMISSION_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!RUNTIME_ADMISSION_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[result.status] || DEFAULT_OUTCOME;
  if (result.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (result.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  for (const field of [...REQUESTED_SLOT_FIELDS, 'estimated_total_tokens', 'estimated_total_cost_minor_units']) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }

  if (!isSanitizedList(result.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(result.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of ['runtime_readiness_evaluated', 'runtime_ready_in_simulation', 'runtime_admission_evaluated', 'runtime_admitted_in_simulation']) {
    if (typeof result[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (result.runtime_admission_evaluated !== true) errors.push('runtime_admission_evaluated_must_be_true');
  const expectedAdmitted = result.status === 'RUNTIME_ADMITTED_SIMULATION';
  if (result.runtime_admitted_in_simulation !== expectedAdmitted) errors.push('runtime_admitted_in_simulation_does_not_match_status');
  if (expectedAdmitted && result.runtime_ready_in_simulation !== true) errors.push('runtime_ready_in_simulation_must_be_true_when_admitted');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (result.validator_version !== RUNTIME_ADMISSION_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// A thin envelope over the RuntimeAdmissionDecision this evaluation already produced -- never an
// independent source of truth. status/decision/next_state are always copied, never re-derived.
function buildRuntimeAdmissionResult(input = {}) {
  const status = RUNTIME_ADMISSION_STATUSES.includes(input.status) ? input.status : 'RUNTIME_ADMISSION_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const result = {
    runtime_admission_result_id: input.runtime_admission_result_id,
    runtime_admission_request_id: input.runtime_admission_request_id,
    runtime_admission_decision_id: input.runtime_admission_decision_id,
    runtime_readiness_decision_id: input.runtime_readiness_decision_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    runtime_admission_request_fingerprint: input.runtime_admission_request_fingerprint || 'fingerprint_not_available',
    runtime_admission_decision_fingerprint: input.runtime_admission_decision_fingerprint || 'fingerprint_not_available',
    runtime_readiness_decision_fingerprint: input.runtime_readiness_decision_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_fingerprint: input.runtime_execution_package_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_digest: input.runtime_execution_package_digest || 'digest_not_available',
    runtime_capacity_snapshot_fingerprint: input.runtime_capacity_snapshot_fingerprint || 'fingerprint_not_available',
    runtime_concurrency_fingerprint: input.runtime_concurrency_fingerprint || 'fingerprint_not_available',
    registry_version: input.registry_version || 'registry_version_not_available',
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_total_cost_minor_units: Number.isInteger(input.estimated_total_cost_minor_units) ? input.estimated_total_cost_minor_units : 0,
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    runtime_readiness_evaluated: input.runtime_readiness_evaluated === true,
    runtime_ready_in_simulation: input.runtime_ready_in_simulation === true,
    runtime_admission_evaluated: true,
    runtime_admitted_in_simulation: status === 'RUNTIME_ADMITTED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_ADMISSION_RESULT_VALIDATOR_VERSION
  };
  for (const field of REQUESTED_SLOT_FIELDS) {
    result[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }

  const validation = validateRuntimeAdmissionResult(result);
  if (!validation.valid) {
    throw new Error(`runtime_admission_result_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(result);
}

module.exports = {
  MAX_BLOCKERS,
  MAX_COUNT,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  REQUESTED_SLOT_FIELDS,
  RUNTIME_ADMISSION_RESULT_FIELDS,
  RUNTIME_ADMISSION_RESULT_VALIDATOR_VERSION,
  buildRuntimeAdmissionResult,
  validateRuntimeAdmissionResult
};
