'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const RUNTIME_WORKER_ASSIGNMENT_DECISION_VALIDATOR_VERSION = 'runtime_worker_assignment_decision_validator_v1';

// 19 own statuses, matching the spec's own "Worker Assignment Status" section exactly.
const WORKER_ASSIGNMENT_STATUSES_OWN = Object.freeze([
  'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION', 'WORKER_ASSIGNMENT_VALIDATION_FAILED',
  'WORKER_ASSIGNMENT_POLICY_BLOCKED', 'WORKER_ASSIGNMENT_SCHEDULER_BLOCKED',
  'WORKER_ASSIGNMENT_RUNTIME_PACKAGE_BLOCKED', 'WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED',
  'WORKER_ASSIGNMENT_CAPABILITY_BLOCKED', 'WORKER_ASSIGNMENT_HEALTH_BLOCKED', 'WORKER_ASSIGNMENT_CAPACITY_BLOCKED',
  'WORKER_ASSIGNMENT_COMPATIBILITY_BLOCKED', 'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED',
  'WORKER_ASSIGNMENT_FRESHNESS_BLOCKED', 'WORKER_ASSIGNMENT_REPLAY_BLOCKED', 'WORKER_ASSIGNMENT_IDEMPOTENCY_BLOCKED',
  'WORKER_ASSIGNMENT_FINGERPRINT_BLOCKED', 'WORKER_ASSIGNMENT_DIGEST_BLOCKED', 'WORKER_ASSIGNMENT_VERSION_BLOCKED',
  'WORKER_ASSIGNMENT_CONFLICT_BLOCKED', 'WORKER_ASSIGNMENT_UNKNOWN_STATUS_BLOCKED'
]);

// 19 own + 6 reused identity statuses -- the same "declarative status vocabulary, separate from
// every prior layer's own" pattern established by every PR #102-#105 taxonomy.
const WORKER_ASSIGNMENT_STATUSES = Object.freeze([
  ...WORKER_ASSIGNMENT_STATUSES_OWN, 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED'
]);

// The spec's own "Precedência obrigatória" -- 25 statuses, real evaluation order.
const WORKER_ASSIGNMENT_PRECEDENCE_ORDER = Object.freeze([
  'WORKER_ASSIGNMENT_VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED',
  'SESSION_BLOCKED', 'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'WORKER_ASSIGNMENT_POLICY_BLOCKED',
  'WORKER_ASSIGNMENT_SCHEDULER_BLOCKED', 'WORKER_ASSIGNMENT_RUNTIME_PACKAGE_BLOCKED',
  'WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED', 'WORKER_ASSIGNMENT_CAPABILITY_BLOCKED',
  'WORKER_ASSIGNMENT_HEALTH_BLOCKED', 'WORKER_ASSIGNMENT_CAPACITY_BLOCKED', 'WORKER_ASSIGNMENT_COMPATIBILITY_BLOCKED',
  'WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED', 'WORKER_ASSIGNMENT_FRESHNESS_BLOCKED', 'WORKER_ASSIGNMENT_REPLAY_BLOCKED',
  'WORKER_ASSIGNMENT_IDEMPOTENCY_BLOCKED', 'WORKER_ASSIGNMENT_FINGERPRINT_BLOCKED',
  'WORKER_ASSIGNMENT_DIGEST_BLOCKED', 'WORKER_ASSIGNMENT_VERSION_BLOCKED', 'WORKER_ASSIGNMENT_CONFLICT_BLOCKED',
  'WORKER_ASSIGNMENT_UNKNOWN_STATUS_BLOCKED', 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION'
]);

const WORKER_ASSIGNMENT_DECISIONS = Object.freeze([
  'PREPARE_WORKER_ASSIGNMENT_PACKAGE_SIMULATION', 'REQUEST_SCHEDULER_REBUILD', 'REQUEST_RUNTIME_PACKAGE_REBUILD',
  'REQUEST_WORKER_REGISTRY_REFRESH', 'REQUEST_WORKER_CAPABILITY_REFRESH', 'REQUEST_WORKER_HEALTH_REFRESH',
  'REQUEST_WORKER_CAPACITY_REFRESH', 'REQUEST_FRESHNESS_REFRESH', 'REQUEST_REPLAY_REVIEW',
  'REQUEST_IDEMPOTENCY_REBUILD', 'REQUEST_WORKER_CANDIDATE_REVIEW', 'BLOCKED'
]);

const WORKER_ASSIGNMENT_NEXT_STATES = Object.freeze([
  'WORKER_ASSIGNMENT_PACKAGE_PREPARED_REFERENCE_SIMULATION', 'WAITING_SCHEDULER_REBUILD_REFERENCE',
  'WAITING_RUNTIME_PACKAGE_REBUILD_REFERENCE', 'WAITING_WORKER_REGISTRY_REFRESH_REFERENCE',
  'WAITING_WORKER_CAPABILITY_REFRESH_REFERENCE', 'WAITING_WORKER_HEALTH_REFRESH_REFERENCE',
  'WAITING_WORKER_CAPACITY_REFRESH_REFERENCE', 'WAITING_FRESHNESS_REFRESH_REFERENCE',
  'WAITING_REPLAY_REVIEW_REFERENCE', 'WAITING_IDEMPOTENCY_REBUILD_REFERENCE',
  'WAITING_WORKER_CANDIDATE_REVIEW_REFERENCE', 'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

// Statuses with no dedicated REQUEST_*/PREPARE_* name (7 own + 6 identity = 13) fall to
// DEFAULT_OUTCOME -- the same "specific status wins, everything else collapses to BLOCKED" pattern
// every decision/result pair in this codebase already uses.
const STATUS_OUTCOME_MAP = Object.freeze({
  WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION: { decision: 'PREPARE_WORKER_ASSIGNMENT_PACKAGE_SIMULATION', next_state: 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_REFERENCE_SIMULATION' },
  WORKER_ASSIGNMENT_SCHEDULER_BLOCKED: { decision: 'REQUEST_SCHEDULER_REBUILD', next_state: 'WAITING_SCHEDULER_REBUILD_REFERENCE' },
  WORKER_ASSIGNMENT_RUNTIME_PACKAGE_BLOCKED: { decision: 'REQUEST_RUNTIME_PACKAGE_REBUILD', next_state: 'WAITING_RUNTIME_PACKAGE_REBUILD_REFERENCE' },
  WORKER_ASSIGNMENT_WORKER_REGISTRY_BLOCKED: { decision: 'REQUEST_WORKER_REGISTRY_REFRESH', next_state: 'WAITING_WORKER_REGISTRY_REFRESH_REFERENCE' },
  WORKER_ASSIGNMENT_CAPABILITY_BLOCKED: { decision: 'REQUEST_WORKER_CAPABILITY_REFRESH', next_state: 'WAITING_WORKER_CAPABILITY_REFRESH_REFERENCE' },
  WORKER_ASSIGNMENT_HEALTH_BLOCKED: { decision: 'REQUEST_WORKER_HEALTH_REFRESH', next_state: 'WAITING_WORKER_HEALTH_REFRESH_REFERENCE' },
  WORKER_ASSIGNMENT_CAPACITY_BLOCKED: { decision: 'REQUEST_WORKER_CAPACITY_REFRESH', next_state: 'WAITING_WORKER_CAPACITY_REFRESH_REFERENCE' },
  WORKER_ASSIGNMENT_FRESHNESS_BLOCKED: { decision: 'REQUEST_FRESHNESS_REFRESH', next_state: 'WAITING_FRESHNESS_REFRESH_REFERENCE' },
  WORKER_ASSIGNMENT_REPLAY_BLOCKED: { decision: 'REQUEST_REPLAY_REVIEW', next_state: 'WAITING_REPLAY_REVIEW_REFERENCE' },
  WORKER_ASSIGNMENT_IDEMPOTENCY_BLOCKED: { decision: 'REQUEST_IDEMPOTENCY_REBUILD', next_state: 'WAITING_IDEMPOTENCY_REBUILD_REFERENCE' },
  WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED: { decision: 'REQUEST_WORKER_CANDIDATE_REVIEW', next_state: 'WAITING_WORKER_CANDIDATE_REVIEW_REFERENCE' }
});

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'policy_validated', 'scheduler_validated', 'runtime_package_validated', 'identity_validated',
  'worker_registry_validated', 'worker_references_validated', 'capabilities_validated', 'health_validated',
  'capacity_validated', 'freshness_validated', 'replay_validated', 'idempotency_validated',
  'compatibilities_validated', 'candidate_sets_validated', 'assignments_validated', 'package_fingerprint_validated',
  'package_digest_validated', 'non_execution_invariants_validated'
]);

const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  worker_assignment_applied: false,
  worker_reserved: false,
  worker_started: false,
  stage_dispatched: false,
  stage_started: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const FINGERPRINT_FIELDS = Object.freeze([
  'runtime_worker_assignment_request_fingerprint', 'runtime_worker_assignment_package_fingerprint',
  'runtime_worker_assignment_package_digest', 'runtime_scheduler_package_fingerprint',
  'runtime_scheduler_package_digest', 'runtime_execution_package_fingerprint', 'runtime_execution_package_digest'
]);

const RUNTIME_WORKER_ASSIGNMENT_DECISION_FIELDS = Object.freeze([
  'runtime_worker_assignment_decision_id', 'runtime_worker_assignment_request_id', 'runtime_worker_assignment_package_id',
  'runtime_scheduler_decision_id', 'runtime_scheduler_result_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  ...FINGERPRINT_FIELDS,
  'blockers', 'reason_codes',
  ...VALIDATION_FLAG_FIELDS,
  'worker_assignment_evaluated', 'worker_assignment_package_prepared_in_simulation',
  'worker_assignment_applied', 'worker_reserved', 'worker_started', 'stage_dispatched', 'stage_started', 'executed',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeWorkerAssignmentDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['runtime_worker_assignment_decision_must_be_object'] };
  exactFields(decision, RUNTIME_WORKER_ASSIGNMENT_DECISION_FIELDS, 'runtime_worker_assignment_decision', errors);
  for (const field of [
    'runtime_worker_assignment_decision_id', 'runtime_worker_assignment_request_id', 'runtime_worker_assignment_package_id',
    'runtime_scheduler_decision_id', 'runtime_scheduler_result_id', 'runtime_scheduler_package_id',
    'runtime_execution_package_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
    'agent_id', 'actor_id', ...FINGERPRINT_FIELDS, 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!WORKER_ASSIGNMENT_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!WORKER_ASSIGNMENT_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!WORKER_ASSIGNMENT_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (decision.worker_assignment_evaluated !== true) errors.push('worker_assignment_evaluated_must_be_true');
  if (typeof decision.worker_assignment_package_prepared_in_simulation !== 'boolean') errors.push('worker_assignment_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = decision.status === 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION';
  if (decision.worker_assignment_package_prepared_in_simulation !== expectedPrepared) errors.push('worker_assignment_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== RUNTIME_WORKER_ASSIGNMENT_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerAssignmentDecision(input = {}) {
  const status = WORKER_ASSIGNMENT_STATUSES.includes(input.status) ? input.status : 'WORKER_ASSIGNMENT_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    runtime_worker_assignment_decision_id: input.runtime_worker_assignment_decision_id,
    runtime_worker_assignment_request_id: input.runtime_worker_assignment_request_id,
    runtime_worker_assignment_package_id: input.runtime_worker_assignment_package_id,
    runtime_scheduler_decision_id: input.runtime_scheduler_decision_id,
    runtime_scheduler_result_id: input.runtime_scheduler_result_id,
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
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    worker_assignment_evaluated: true,
    worker_assignment_package_prepared_in_simulation: status === 'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_ASSIGNMENT_DECISION_VALIDATOR_VERSION
  };
  for (const field of FINGERPRINT_FIELDS) {
    decision[field] = input[field] || 'fingerprint_not_available';
  }
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateRuntimeWorkerAssignmentDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_worker_assignment_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  FINGERPRINT_FIELDS,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  RUNTIME_WORKER_ASSIGNMENT_DECISION_FIELDS,
  RUNTIME_WORKER_ASSIGNMENT_DECISION_VALIDATOR_VERSION,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  WORKER_ASSIGNMENT_DECISIONS,
  WORKER_ASSIGNMENT_NEXT_STATES,
  WORKER_ASSIGNMENT_PRECEDENCE_ORDER,
  WORKER_ASSIGNMENT_STATUSES,
  WORKER_ASSIGNMENT_STATUSES_OWN,
  buildRuntimeWorkerAssignmentDecision,
  validateRuntimeWorkerAssignmentDecision
};
