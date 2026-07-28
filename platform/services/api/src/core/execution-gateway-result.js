'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { GATEWAY_STATUSES, GATEWAY_DECISIONS, GATEWAY_NEXT_STATES, STATUS_OUTCOME_MAP, DEFAULT_OUTCOME } = require('./execution-gateway-decision');

const EXECUTION_GATEWAY_RESULT_VALIDATOR_VERSION = 'execution_gateway_result_validator_v1';

const EXECUTION_GATEWAY_RESULT_FIELDS = Object.freeze([
  'gateway_result_id', 'gateway_request_id', 'gateway_decision_id', 'gateway_package_reference_id',
  'execution_plan_id', 'execution_plan_result_id', 'tenant_id', 'organization_id', 'project_id',
  'session_reference_id', 'agent_id', 'actor_id', 'status', 'decision', 'next_state',
  'gateway_request_fingerprint', 'gateway_decision_fingerprint', 'gateway_package_fingerprint',
  'execution_plan_fingerprint', 'architecture_gate_evidence_fingerprint', 'package_digest', 'registry_version',
  'blockers', 'reason_codes', 'validation_ledger_id', 'validation_ledger_fingerprint', 'gateway_evaluated',
  'gateway_accepted_in_simulation', 'runtime_enabled', 'execution_authorized', 'execution_started',
  'stage_started', 'stage_completed', 'agent_executed', 'tool_called', 'workflow_executed', 'provider_called',
  'model_called', 'network_used', 'memory_read', 'memory_written', 'tokens_consumed', 'cost_consumed',
  'job_created', 'queue_used', 'worker_started', 'executed', 'simulation', 'production_blocked',
  'rollout_percentage', 'validator_version'
]);

const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  stage_started: false,
  stage_completed: false,
  agent_executed: false,
  tool_called: false,
  workflow_executed: false,
  provider_called: false,
  model_called: false,
  network_used: false,
  memory_read: false,
  memory_written: false,
  tokens_consumed: false,
  cost_consumed: false,
  job_created: false,
  queue_used: false,
  worker_started: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateExecutionGatewayResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['execution_gateway_result_must_be_object'] };
  exactFields(result, EXECUTION_GATEWAY_RESULT_FIELDS, 'execution_gateway_result', errors);
  for (const field of [
    'gateway_result_id', 'gateway_request_id', 'gateway_decision_id', 'gateway_package_reference_id',
    'execution_plan_id', 'execution_plan_result_id', 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'agent_id', 'actor_id', 'gateway_request_fingerprint', 'gateway_decision_fingerprint',
    'gateway_package_fingerprint', 'execution_plan_fingerprint', 'architecture_gate_evidence_fingerprint',
    'package_digest', 'registry_version', 'validation_ledger_id', 'validation_ledger_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!GATEWAY_STATUSES.includes(result.status)) errors.push('status_invalid');
  if (!GATEWAY_DECISIONS.includes(result.decision)) errors.push('decision_invalid');
  if (!GATEWAY_NEXT_STATES.includes(result.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[result.status] || DEFAULT_OUTCOME;
  if (result.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (result.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(result.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(result.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  if (typeof result.gateway_evaluated !== 'boolean') errors.push('gateway_evaluated_must_be_boolean');
  if (result.gateway_evaluated !== true) errors.push('gateway_evaluated_must_be_true');
  if (typeof result.gateway_accepted_in_simulation !== 'boolean') errors.push('gateway_accepted_in_simulation_must_be_boolean');
  const expectedAccepted = result.status === 'GATEWAY_ACCEPTED_SIMULATION';
  if (result.gateway_accepted_in_simulation !== expectedAccepted) errors.push('gateway_accepted_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (result.validator_version !== EXECUTION_GATEWAY_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// A thin envelope over the ExecutionGatewayDecision this evaluation already produced -- never an
// independent source of truth. status/decision/next_state are always copied from the decision,
// never re-derived.
function buildExecutionGatewayResult(input = {}) {
  const status = GATEWAY_STATUSES.includes(input.status) ? input.status : 'UNKNOWN_STATUS_BLOCKED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const result = {
    gateway_result_id: input.gateway_result_id,
    gateway_request_id: input.gateway_request_id,
    gateway_decision_id: input.gateway_decision_id,
    gateway_package_reference_id: input.gateway_package_reference_id,
    execution_plan_id: input.execution_plan_id,
    execution_plan_result_id: input.execution_plan_result_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    gateway_request_fingerprint: input.gateway_request_fingerprint || 'fingerprint_not_available',
    gateway_decision_fingerprint: input.gateway_decision_fingerprint || 'fingerprint_not_available',
    gateway_package_fingerprint: input.gateway_package_fingerprint || 'fingerprint_not_available',
    execution_plan_fingerprint: input.execution_plan_fingerprint || 'fingerprint_not_available',
    architecture_gate_evidence_fingerprint: input.architecture_gate_evidence_fingerprint || 'fingerprint_not_available',
    package_digest: input.package_digest || 'digest_not_available',
    registry_version: input.registry_version || 'registry_version_not_available',
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    validation_ledger_id: input.validation_ledger_id || 'validation_ledger_not_available',
    validation_ledger_fingerprint: input.validation_ledger_fingerprint || 'fingerprint_not_available',
    gateway_evaluated: true,
    gateway_accepted_in_simulation: status === 'GATEWAY_ACCEPTED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: EXECUTION_GATEWAY_RESULT_VALIDATOR_VERSION
  };

  const validation = validateExecutionGatewayResult(result);
  if (!validation.valid) {
    throw new Error(`execution_gateway_result_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(result);
}

module.exports = {
  EXECUTION_GATEWAY_RESULT_FIELDS,
  EXECUTION_GATEWAY_RESULT_VALIDATOR_VERSION,
  OPERATIONAL_SAFE_FLAGS,
  buildExecutionGatewayResult,
  validateExecutionGatewayResult
};
