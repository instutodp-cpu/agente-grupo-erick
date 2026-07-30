'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const RUNTIME_ADMISSION_DECISION_VALIDATOR_VERSION = 'runtime_admission_decision_validator_v1';

const RUNTIME_ADMISSION_STATUSES_OWN = Object.freeze([
  'RUNTIME_ADMITTED_SIMULATION', 'RUNTIME_ADMISSION_VALIDATION_FAILED', 'RUNTIME_ADMISSION_POLICY_BLOCKED',
  'RUNTIME_NOT_READY_BLOCKED', 'RUNTIME_PACKAGE_BLOCKED', 'RUNTIME_IDENTITY_BLOCKED', 'RUNTIME_CAPACITY_BLOCKED',
  'RUNTIME_CONCURRENCY_BLOCKED', 'RUNTIME_FRESHNESS_BLOCKED', 'RUNTIME_REPLAY_BLOCKED', 'RUNTIME_LIMIT_BLOCKED',
  'RUNTIME_VERSION_BLOCKED', 'RUNTIME_FINGERPRINT_BLOCKED', 'RUNTIME_DIGEST_BLOCKED', 'RUNTIME_CONFLICT_BLOCKED',
  'RUNTIME_UNKNOWN_STATUS_BLOCKED'
]);

const RUNTIME_ADMISSION_STATUSES = Object.freeze([
  ...RUNTIME_ADMISSION_STATUSES_OWN, 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED'
]);

// The spec's own "Precedência da Admission" -- 22 statuses, real evaluation order.
const RUNTIME_ADMISSION_PRECEDENCE_ORDER = Object.freeze([
  'RUNTIME_ADMISSION_VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED',
  'SESSION_BLOCKED', 'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'RUNTIME_ADMISSION_POLICY_BLOCKED', 'RUNTIME_NOT_READY_BLOCKED',
  'RUNTIME_PACKAGE_BLOCKED', 'RUNTIME_IDENTITY_BLOCKED', 'RUNTIME_CAPACITY_BLOCKED', 'RUNTIME_CONCURRENCY_BLOCKED',
  'RUNTIME_FRESHNESS_BLOCKED', 'RUNTIME_REPLAY_BLOCKED', 'RUNTIME_LIMIT_BLOCKED', 'RUNTIME_VERSION_BLOCKED',
  'RUNTIME_FINGERPRINT_BLOCKED', 'RUNTIME_DIGEST_BLOCKED', 'RUNTIME_CONFLICT_BLOCKED', 'RUNTIME_UNKNOWN_STATUS_BLOCKED',
  'RUNTIME_ADMITTED_SIMULATION'
]);

const RUNTIME_ADMISSION_DECISIONS = Object.freeze([
  'ADMIT_RUNTIME_PACKAGE_SIMULATION', 'REQUEST_READINESS_REEVALUATION', 'REQUEST_CAPACITY_REFRESH',
  'REQUEST_CONCURRENCY_REVIEW', 'REQUEST_FRESHNESS_REFRESH', 'REQUEST_REPLAY_REVIEW', 'REQUEST_POLICY_REVIEW',
  'BLOCKED'
]);

const RUNTIME_ADMISSION_NEXT_STATES = Object.freeze([
  'RUNTIME_ADMITTED_REFERENCE_SIMULATION', 'WAITING_READINESS_REEVALUATION_REFERENCE',
  'WAITING_CAPACITY_REFRESH_REFERENCE', 'WAITING_CONCURRENCY_REVIEW_REFERENCE', 'WAITING_FRESHNESS_REFRESH_REFERENCE',
  'WAITING_REPLAY_REVIEW_REFERENCE', 'WAITING_POLICY_REVIEW_REFERENCE', 'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

// Statuses with no dedicated REQUEST_*/ADMIT_* name -- the spec's own "Admission Decision"
// vocabulary (8 entries) does not list one for RUNTIME_ADMISSION_VALIDATION_FAILED/
// RUNTIME_PACKAGE_BLOCKED/RUNTIME_IDENTITY_BLOCKED/RUNTIME_LIMIT_BLOCKED/RUNTIME_VERSION_BLOCKED/
// RUNTIME_FINGERPRINT_BLOCKED/RUNTIME_DIGEST_BLOCKED/RUNTIME_CONFLICT_BLOCKED/
// RUNTIME_UNKNOWN_STATUS_BLOCKED or the 6 reused identity statuses -- each falls to DEFAULT_OUTCOME.
const STATUS_OUTCOME_MAP = Object.freeze({
  RUNTIME_ADMITTED_SIMULATION: { decision: 'ADMIT_RUNTIME_PACKAGE_SIMULATION', next_state: 'RUNTIME_ADMITTED_REFERENCE_SIMULATION' },
  RUNTIME_NOT_READY_BLOCKED: { decision: 'REQUEST_READINESS_REEVALUATION', next_state: 'WAITING_READINESS_REEVALUATION_REFERENCE' },
  RUNTIME_CAPACITY_BLOCKED: { decision: 'REQUEST_CAPACITY_REFRESH', next_state: 'WAITING_CAPACITY_REFRESH_REFERENCE' },
  RUNTIME_CONCURRENCY_BLOCKED: { decision: 'REQUEST_CONCURRENCY_REVIEW', next_state: 'WAITING_CONCURRENCY_REVIEW_REFERENCE' },
  RUNTIME_FRESHNESS_BLOCKED: { decision: 'REQUEST_FRESHNESS_REFRESH', next_state: 'WAITING_FRESHNESS_REFRESH_REFERENCE' },
  RUNTIME_REPLAY_BLOCKED: { decision: 'REQUEST_REPLAY_REVIEW', next_state: 'WAITING_REPLAY_REVIEW_REFERENCE' },
  RUNTIME_ADMISSION_POLICY_BLOCKED: { decision: 'REQUEST_POLICY_REVIEW', next_state: 'WAITING_POLICY_REVIEW_REFERENCE' }
});

const RUNTIME_ADMISSION_DECISION_FIELDS = Object.freeze([
  'runtime_admission_decision_id', 'runtime_admission_request_id', 'runtime_readiness_decision_id',
  'runtime_execution_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  'runtime_admission_request_fingerprint', 'runtime_readiness_decision_fingerprint',
  'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
  'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint', 'runtime_freshness_fingerprint',
  'runtime_replay_fingerprint',
  'blockers', 'reason_codes',
  'request_validated', 'policy_validated', 'readiness_validated', 'runtime_package_validated', 'identity_validated',
  'capacity_validated', 'concurrency_validated', 'freshness_validated', 'replay_validated',
  'admission_limits_validated', 'non_execution_invariants_validated',
  'runtime_admission_evaluated', 'runtime_admitted_in_simulation',
  'runtime_enabled', 'execution_authorized', 'execution_started', 'stage_started', 'stage_completed',
  'job_created', 'queue_used', 'worker_started', 'scheduler_started', 'executed',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'policy_validated', 'readiness_validated', 'runtime_package_validated', 'identity_validated',
  'capacity_validated', 'concurrency_validated', 'freshness_validated', 'replay_validated',
  'admission_limits_validated', 'non_execution_invariants_validated'
]);

const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  stage_started: false,
  stage_completed: false,
  job_created: false,
  queue_used: false,
  worker_started: false,
  scheduler_started: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeAdmissionDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['runtime_admission_decision_must_be_object'] };
  exactFields(decision, RUNTIME_ADMISSION_DECISION_FIELDS, 'runtime_admission_decision', errors);
  for (const field of [
    'runtime_admission_decision_id', 'runtime_admission_request_id', 'runtime_readiness_decision_id',
    'runtime_execution_package_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
    'agent_id', 'actor_id', 'runtime_admission_request_fingerprint', 'runtime_readiness_decision_fingerprint',
    'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
    'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint', 'runtime_freshness_fingerprint',
    'runtime_replay_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_ADMISSION_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!RUNTIME_ADMISSION_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!RUNTIME_ADMISSION_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof decision.runtime_admission_evaluated !== 'boolean') errors.push('runtime_admission_evaluated_must_be_boolean');
  if (decision.runtime_admission_evaluated !== true) errors.push('runtime_admission_evaluated_must_be_true');
  if (typeof decision.runtime_admitted_in_simulation !== 'boolean') errors.push('runtime_admitted_in_simulation_must_be_boolean');
  const expectedAdmitted = decision.status === 'RUNTIME_ADMITTED_SIMULATION';
  if (decision.runtime_admitted_in_simulation !== expectedAdmitted) errors.push('runtime_admitted_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== RUNTIME_ADMISSION_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeAdmissionDecision(input = {}) {
  const status = RUNTIME_ADMISSION_STATUSES.includes(input.status) ? input.status : 'RUNTIME_ADMISSION_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    runtime_admission_decision_id: input.runtime_admission_decision_id,
    runtime_admission_request_id: input.runtime_admission_request_id,
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
    runtime_readiness_decision_fingerprint: input.runtime_readiness_decision_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_fingerprint: input.runtime_execution_package_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_digest: input.runtime_execution_package_digest || 'digest_not_available',
    runtime_capacity_snapshot_fingerprint: input.runtime_capacity_snapshot_fingerprint || 'fingerprint_not_available',
    runtime_concurrency_fingerprint: input.runtime_concurrency_fingerprint || 'fingerprint_not_available',
    runtime_freshness_fingerprint: input.runtime_freshness_fingerprint || 'fingerprint_not_available',
    runtime_replay_fingerprint: input.runtime_replay_fingerprint || 'fingerprint_not_available',
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    runtime_admission_evaluated: true,
    runtime_admitted_in_simulation: status === 'RUNTIME_ADMITTED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_ADMISSION_DECISION_VALIDATOR_VERSION
  };
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateRuntimeAdmissionDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_admission_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  RUNTIME_ADMISSION_DECISIONS,
  RUNTIME_ADMISSION_DECISION_FIELDS,
  RUNTIME_ADMISSION_DECISION_VALIDATOR_VERSION,
  RUNTIME_ADMISSION_NEXT_STATES,
  RUNTIME_ADMISSION_PRECEDENCE_ORDER,
  RUNTIME_ADMISSION_STATUSES,
  RUNTIME_ADMISSION_STATUSES_OWN,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildRuntimeAdmissionDecision,
  validateRuntimeAdmissionDecision
};
