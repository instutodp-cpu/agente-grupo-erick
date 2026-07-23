'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_PLAN_RESULT_VALIDATOR_VERSION = 'execution_plan_result_validator_v1';

const EXECUTION_PLAN_RESULT_FIELDS = Object.freeze([
  'result_id', 'execution_plan_request_id', 'execution_plan_id', 'authorization_decision_id', 'planning_result_id',
  'orchestration_plan_id', 'task_reference_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id',
  'session_reference_id', 'status', 'decision', 'next_state', 'stage_ids', 'dependency_ids', 'binding_ids',
  'stop_condition_ids', 'compensation_reference_ids', 'request_fingerprint', 'authorization_fingerprint',
  'evidence_bundle_fingerprint', 'planning_result_fingerprint', 'orchestration_plan_fingerprint', 'task_fingerprint',
  'execution_plan_fingerprint', 'registry_version', 'stage_count', 'dependency_count', 'binding_count',
  'stop_condition_count', 'compensation_count', 'estimated_total_tokens', 'estimated_total_cost_minor_units',
  'blockers', 'reason_codes', 'request_validated', 'authorization_validated', 'evidence_validated',
  'bindings_validated', 'budget_validated', 'dependencies_validated', 'idempotency_validated',
  'stop_conditions_validated', 'compensations_validated', 'execution_plan_prepared', 'executable',
  'execution_authorized', 'execution_started', 'stage_started', 'stage_completed', 'tool_called',
  'workflow_executed', 'provider_called', 'model_called', 'network_used', 'memory_read', 'memory_written',
  'tokens_consumed', 'cost_consumed', 'runtime_enabled', 'executed', 'simulation', 'production_blocked',
  'rollout_percentage', 'validator_version'
]);

const RESULT_STATUSES = Object.freeze([
  'EXECUTION_PLAN_PREPARED_SIMULATION', 'WAITING_APPROVAL_REFERENCE', 'DENY', 'VALIDATION_FAILED', 'TENANT_BLOCKED',
  'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED', 'TASK_BLOCKED', 'AUTHORIZATION_BLOCKED',
  'EVIDENCE_BLOCKED', 'BINDING_BLOCKED', 'BUDGET_BLOCKED', 'DEPENDENCY_BLOCKED', 'IDEMPOTENCY_BLOCKED',
  'STOP_CONDITION_BLOCKED', 'COMPENSATION_BLOCKED', 'FINGERPRINT_BLOCKED', 'VERSION_BLOCKED', 'CONFLICT_BLOCKED'
]);

const RESULT_DECISIONS = Object.freeze([
  'PREPARE_EXECUTION_PLAN_REFERENCE', 'REQUEST_APPROVAL_REFERENCE', 'REQUEST_PLAN_REBUILD', 'BLOCKED'
]);

const NEXT_STATES = Object.freeze([
  'EXECUTION_PLAN_PREPARED_REFERENCE', 'WAITING_APPROVAL_REFERENCE', 'WAITING_PLAN_REBUILD_REFERENCE', 'BLOCKED_REFERENCE'
]);

// Single source of truth for status -> decision -> next_state, mirroring PR #95/#97's own
// pattern. REQUEST_PLAN_REBUILD/WAITING_PLAN_REBUILD_REFERENCE are legal enum values with no
// status in RESULT_STATUSES that reaches them in this PR -- see docs "Limitações", the same
// documented-but-unreachable pattern PR #96 established for WAITING_DEPENDENCY_REFERENCE.
const STATUS_OUTCOME_MAP = Object.freeze({
  EXECUTION_PLAN_PREPARED_SIMULATION: { decision: 'PREPARE_EXECUTION_PLAN_REFERENCE', next_state: 'EXECUTION_PLAN_PREPARED_REFERENCE' },
  WAITING_APPROVAL_REFERENCE: { decision: 'REQUEST_APPROVAL_REFERENCE', next_state: 'WAITING_APPROVAL_REFERENCE' }
});
const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'authorization_validated', 'evidence_validated', 'bindings_validated', 'budget_validated',
  'dependencies_validated', 'idempotency_validated', 'stop_conditions_validated', 'compensations_validated'
]);

const COUNT_FIELDS = Object.freeze(['stage_count', 'dependency_count', 'binding_count', 'stop_condition_count', 'compensation_count']);

const FINGERPRINT_FIELDS = Object.freeze([
  'request_fingerprint', 'authorization_fingerprint', 'evidence_bundle_fingerprint', 'planning_result_fingerprint',
  'orchestration_plan_fingerprint', 'task_fingerprint', 'execution_plan_fingerprint'
]);

const ORDERED_LIST_FIELDS = Object.freeze(['stage_ids', 'dependency_ids', 'binding_ids', 'stop_condition_ids', 'compensation_reference_ids']);

// Even EXECUTION_PLAN_PREPARED_SIMULATION never touches anything operational.
const EXECUTION_PLAN_RESULT_SAFE_FLAGS = Object.freeze({
  executable: false,
  execution_authorized: false,
  execution_started: false,
  stage_started: false,
  stage_completed: false,
  tool_called: false,
  workflow_executed: false,
  provider_called: false,
  model_called: false,
  network_used: false,
  memory_read: false,
  memory_written: false,
  tokens_consumed: false,
  cost_consumed: false,
  runtime_enabled: false,
  executed: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});

const MAX_COUNT = 1000;
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;
const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isOrderedUniqueStringList(list, maxItems = 500) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateExecutionPlanResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['execution_plan_result_must_be_object'] };
  exactFields(result, EXECUTION_PLAN_RESULT_FIELDS, 'execution_plan_result', errors);
  for (const field of [
    'result_id', 'execution_plan_request_id', 'execution_plan_id', 'authorization_decision_id', 'planning_result_id',
    'orchestration_plan_id', 'task_reference_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'registry_version', 'validator_version', ...FINGERPRINT_FIELDS
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!RESULT_STATUSES.includes(result.status)) errors.push(`status_not_allowed::${result.status}`);
  if (!RESULT_DECISIONS.includes(result.decision)) errors.push(`decision_not_allowed::${result.decision}`);
  if (!NEXT_STATES.includes(result.next_state)) errors.push(`next_state_not_allowed::${result.next_state}`);
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(result[field])) errors.push(`${field}_invalid`);
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(result.estimated_total_tokens) || result.estimated_total_tokens < 0 || result.estimated_total_tokens > MAX_TOKENS_REFERENCE) {
    errors.push('estimated_total_tokens_invalid');
  }
  if (!Number.isInteger(result.estimated_total_cost_minor_units) || result.estimated_total_cost_minor_units < 0 || result.estimated_total_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_total_cost_minor_units_invalid');
  }
  if (!isOrderedUniqueStringList(result.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isOrderedUniqueStringList(result.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');
  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof result[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof result.execution_plan_prepared !== 'boolean') errors.push('execution_plan_prepared_must_be_boolean');
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_RESULT_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (result.status === 'EXECUTION_PLAN_PREPARED_SIMULATION' && result.execution_plan_prepared !== true) {
    errors.push('execution_plan_prepared_must_be_true_when_status_is_prepared_simulation');
  }
  if (result.status !== 'EXECUTION_PLAN_PREPARED_SIMULATION' && result.execution_plan_prepared !== false) {
    errors.push('execution_plan_prepared_must_be_false_unless_status_is_prepared_simulation');
  }
  const expectedOutcome = STATUS_OUTCOME_MAP[result.status] || DEFAULT_OUTCOME;
  if (result.decision !== expectedOutcome.decision) errors.push(`decision_inconsistent_with_status::${result.status}`);
  if (result.next_state !== expectedOutcome.next_state) errors.push(`next_state_inconsistent_with_status::${result.status}`);

  if (result.validator_version !== EXECUTION_PLAN_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionPlanResult(input = {}) {
  const status = RESULT_STATUSES.includes(input.status) ? input.status : 'VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;
  const notAvailable = 'not_available';
  const fingerprintNotAvailable = 'fingerprint_not_available';

  const result = {
    result_id: input.result_id || notAvailable,
    execution_plan_request_id: input.execution_plan_request_id || notAvailable,
    execution_plan_id: input.execution_plan_id || notAvailable,
    authorization_decision_id: input.authorization_decision_id || notAvailable,
    planning_result_id: input.planning_result_id || notAvailable,
    orchestration_plan_id: input.orchestration_plan_id || notAvailable,
    task_reference_id: input.task_reference_id || notAvailable,
    agent_id: input.agent_id || notAvailable,
    tenant_id: input.tenant_id || notAvailable,
    organization_id: input.organization_id || notAvailable,
    project_id: input.project_id || notAvailable,
    session_reference_id: input.session_reference_id || notAvailable,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    stage_ids: Array.isArray(input.stage_ids) ? uniqueSorted(input.stage_ids) : [],
    dependency_ids: Array.isArray(input.dependency_ids) ? uniqueSorted(input.dependency_ids) : [],
    binding_ids: Array.isArray(input.binding_ids) ? uniqueSorted(input.binding_ids) : [],
    stop_condition_ids: Array.isArray(input.stop_condition_ids) ? uniqueSorted(input.stop_condition_ids) : [],
    compensation_reference_ids: Array.isArray(input.compensation_reference_ids) ? uniqueSorted(input.compensation_reference_ids) : [],
    request_fingerprint: input.request_fingerprint || fingerprintNotAvailable,
    authorization_fingerprint: input.authorization_fingerprint || fingerprintNotAvailable,
    evidence_bundle_fingerprint: input.evidence_bundle_fingerprint || fingerprintNotAvailable,
    planning_result_fingerprint: input.planning_result_fingerprint || fingerprintNotAvailable,
    orchestration_plan_fingerprint: input.orchestration_plan_fingerprint || fingerprintNotAvailable,
    task_fingerprint: input.task_fingerprint || fingerprintNotAvailable,
    execution_plan_fingerprint: input.execution_plan_fingerprint || fingerprintNotAvailable,
    registry_version: input.registry_version || notAvailable,
    stage_count: Number.isInteger(input.stage_count) ? input.stage_count : 0,
    dependency_count: Number.isInteger(input.dependency_count) ? input.dependency_count : 0,
    binding_count: Number.isInteger(input.binding_count) ? input.binding_count : 0,
    stop_condition_count: Number.isInteger(input.stop_condition_count) ? input.stop_condition_count : 0,
    compensation_count: Number.isInteger(input.compensation_count) ? input.compensation_count : 0,
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_total_cost_minor_units: Number.isInteger(input.estimated_total_cost_minor_units) ? input.estimated_total_cost_minor_units : 0,
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    request_validated: input.request_validated === true,
    authorization_validated: input.authorization_validated === true,
    evidence_validated: input.evidence_validated === true,
    bindings_validated: input.bindings_validated === true,
    budget_validated: input.budget_validated === true,
    dependencies_validated: input.dependencies_validated === true,
    idempotency_validated: input.idempotency_validated === true,
    stop_conditions_validated: input.stop_conditions_validated === true,
    compensations_validated: input.compensations_validated === true,
    execution_plan_prepared: status === 'EXECUTION_PLAN_PREPARED_SIMULATION',
    ...EXECUTION_PLAN_RESULT_SAFE_FLAGS,
    validator_version: EXECUTION_PLAN_RESULT_VALIDATOR_VERSION
  };

  const validation = validateExecutionPlanResult(result);
  if (!validation.valid) {
    return cloneFrozen({
      ...result,
      status: 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      next_state: 'BLOCKED_REFERENCE',
      execution_plan_prepared: false
    });
  }
  return cloneFrozen(result);
}

module.exports = {
  COUNT_FIELDS,
  DEFAULT_OUTCOME,
  EXECUTION_PLAN_RESULT_FIELDS,
  EXECUTION_PLAN_RESULT_SAFE_FLAGS,
  EXECUTION_PLAN_RESULT_VALIDATOR_VERSION,
  FINGERPRINT_FIELDS,
  MAX_BLOCKERS,
  MAX_COST_MINOR_UNITS,
  MAX_COUNT,
  MAX_REASON_CODES,
  MAX_TOKENS_REFERENCE,
  NEXT_STATES,
  ORDERED_LIST_FIELDS,
  RESULT_DECISIONS,
  RESULT_STATUSES,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildExecutionPlanResult,
  isOrderedUniqueStringList,
  validateExecutionPlanResult
};
