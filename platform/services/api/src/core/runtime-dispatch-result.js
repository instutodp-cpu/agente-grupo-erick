'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const {
  DISPATCH_STATUSES, DISPATCH_DECISIONS, DISPATCH_NEXT_STATES, STATUS_OUTCOME_MAP, DEFAULT_OUTCOME
} = require('./runtime-dispatch-decision');

const RUNTIME_DISPATCH_RESULT_VALIDATOR_VERSION = 'runtime_dispatch_result_validator_v1';

const COUNT_FIELDS = Object.freeze([
  'dispatch_stage_count', 'dispatch_intent_count', 'prepared_intent_count', 'waiting_dependency_count',
  'waiting_approval_count', 'optional_count', 'blocked_count'
]);

const ESTIMATE_FIELDS = Object.freeze([
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_total_cost_minor_units'
]);

// The full 27-flag operational surface -- the outward-facing envelope every downstream consumer
// reads, mirroring runtime-worker-assignment-result.js's own broader-than-decision flag set one
// layer below.
const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  dispatch_authorized: false,
  dispatch_applied: false,
  dispatch_sent: false,
  dispatch_acknowledged: false,
  dispatch_lease_created: false,
  worker_reserved: false,
  worker_started: false,
  worker_connection_opened: false,
  worker_process_created: false,
  worker_thread_created: false,
  container_started: false,
  scheduler_started: false,
  job_created: false,
  queue_created: false,
  queue_item_created: false,
  queue_used: false,
  stage_dispatched: false,
  stage_started: false,
  stage_completed: false,
  stage_failed: false,
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  network_used: false,
  secret_resolved: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const RUNTIME_DISPATCH_RESULT_FIELDS = Object.freeze([
  'runtime_dispatch_result_id', 'runtime_dispatch_request_id', 'runtime_dispatch_decision_id', 'runtime_dispatch_package_id',
  'runtime_worker_assignment_package_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  'runtime_dispatch_request_fingerprint', 'runtime_dispatch_decision_fingerprint', 'runtime_dispatch_package_fingerprint',
  'runtime_dispatch_package_digest',
  'registry_version',
  ...COUNT_FIELDS,
  ...ESTIMATE_FIELDS,
  'blockers', 'reason_codes',
  'dispatch_evaluated', 'dispatch_package_prepared_in_simulation',
  ...Object.keys(OPERATIONAL_SAFE_FLAGS),
  'rollout_percentage', 'validator_version'
]);

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;
const MAX_COUNT = 100000;
const MAX_TOKEN_BOUND = 1000000000;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeDispatchResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['runtime_dispatch_result_must_be_object'] };
  exactFields(result, RUNTIME_DISPATCH_RESULT_FIELDS, 'runtime_dispatch_result', errors);
  for (const field of [
    'runtime_dispatch_result_id', 'runtime_dispatch_request_id', 'runtime_dispatch_decision_id', 'runtime_dispatch_package_id',
    'runtime_worker_assignment_package_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
    'runtime_dispatch_request_fingerprint', 'runtime_dispatch_decision_fingerprint', 'runtime_dispatch_package_fingerprint',
    'runtime_dispatch_package_digest', 'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!DISPATCH_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!DISPATCH_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!DISPATCH_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[result.status] || DEFAULT_OUTCOME;
  if (result.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (result.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  for (const field of ESTIMATE_FIELDS) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_TOKEN_BOUND) errors.push(`${field}_invalid`);
  }
  if (!isSanitizedList(result.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(result.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  if (result.dispatch_evaluated !== true) errors.push('dispatch_evaluated_must_be_true');
  if (typeof result.dispatch_package_prepared_in_simulation !== 'boolean') errors.push('dispatch_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = result.status === 'DISPATCH_PACKAGE_PREPARED_SIMULATION';
  if (result.dispatch_package_prepared_in_simulation !== expectedPrepared) errors.push('dispatch_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (result.validator_version !== RUNTIME_DISPATCH_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// A thin envelope over the RuntimeDispatchDecision this evaluation already produced -- never an
// independent source of truth.
function buildRuntimeDispatchResult(input = {}) {
  const status = DISPATCH_STATUSES.includes(input.status) ? input.status : 'DISPATCH_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const result = {
    runtime_dispatch_result_id: input.runtime_dispatch_result_id,
    runtime_dispatch_request_id: input.runtime_dispatch_request_id,
    runtime_dispatch_decision_id: input.runtime_dispatch_decision_id,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_worker_assignment_package_id: input.runtime_worker_assignment_package_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
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
    runtime_dispatch_request_fingerprint: input.runtime_dispatch_request_fingerprint || 'fingerprint_not_available',
    runtime_dispatch_decision_fingerprint: input.runtime_dispatch_decision_fingerprint || 'fingerprint_not_available',
    runtime_dispatch_package_fingerprint: input.runtime_dispatch_package_fingerprint || 'fingerprint_not_available',
    runtime_dispatch_package_digest: input.runtime_dispatch_package_digest || 'digest_not_available',
    registry_version: input.registry_version || 'registry_version_not_available',
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    dispatch_evaluated: true,
    dispatch_package_prepared_in_simulation: status === 'DISPATCH_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_RESULT_VALIDATOR_VERSION
  };
  for (const field of [...COUNT_FIELDS, ...ESTIMATE_FIELDS]) {
    result[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }

  const validation = validateRuntimeDispatchResult(result);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_result_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(result);
}

module.exports = {
  COUNT_FIELDS,
  ESTIMATE_FIELDS,
  MAX_BLOCKERS,
  MAX_COUNT,
  MAX_REASON_CODES,
  MAX_TOKEN_BOUND,
  OPERATIONAL_SAFE_FLAGS,
  RUNTIME_DISPATCH_RESULT_FIELDS,
  RUNTIME_DISPATCH_RESULT_VALIDATOR_VERSION,
  buildRuntimeDispatchResult,
  validateRuntimeDispatchResult
};
