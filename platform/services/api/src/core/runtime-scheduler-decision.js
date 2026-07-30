'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const RUNTIME_SCHEDULER_DECISION_VALIDATOR_VERSION = 'runtime_scheduler_decision_validator_v1';

// 21 own statuses, matching the spec's own "Scheduler Status" section exactly, in declared order.
const RUNTIME_SCHEDULER_STATUSES_OWN = Object.freeze([
  'SCHEDULER_PACKAGE_PREPARED_SIMULATION', 'SCHEDULER_VALIDATION_FAILED', 'SCHEDULER_POLICY_BLOCKED',
  'SCHEDULER_ADMISSION_BLOCKED', 'SCHEDULER_RUNTIME_PACKAGE_BLOCKED', 'SCHEDULER_STAGE_BLOCKED',
  'SCHEDULER_DEPENDENCY_BLOCKED', 'SCHEDULER_PARALLEL_GROUP_BLOCKED', 'SCHEDULER_APPROVAL_WAIT_BLOCKED',
  'SCHEDULER_CAPACITY_BLOCKED', 'SCHEDULER_CONCURRENCY_BLOCKED', 'SCHEDULER_BUDGET_BLOCKED',
  'SCHEDULER_FRESHNESS_BLOCKED', 'SCHEDULER_REPLAY_BLOCKED', 'SCHEDULER_IDEMPOTENCY_BLOCKED',
  'SCHEDULER_QUEUE_PLAN_BLOCKED', 'SCHEDULER_FINGERPRINT_BLOCKED', 'SCHEDULER_DIGEST_BLOCKED',
  'SCHEDULER_VERSION_BLOCKED', 'SCHEDULER_CONFLICT_BLOCKED', 'SCHEDULER_UNKNOWN_STATUS_BLOCKED'
]);

// 21 own + 6 reused identity statuses -- the same "declarative status vocabulary, separate from
// every prior layer's own" pattern established by every PR #102-#104 taxonomy.
const RUNTIME_SCHEDULER_STATUSES = Object.freeze([
  ...RUNTIME_SCHEDULER_STATUSES_OWN, 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED'
]);

// The spec's own "Precedência obrigatória" -- 27 statuses, real evaluation order.
const RUNTIME_SCHEDULER_PRECEDENCE_ORDER = Object.freeze([
  'SCHEDULER_VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'SCHEDULER_POLICY_BLOCKED', 'SCHEDULER_ADMISSION_BLOCKED',
  'SCHEDULER_RUNTIME_PACKAGE_BLOCKED', 'SCHEDULER_STAGE_BLOCKED', 'SCHEDULER_DEPENDENCY_BLOCKED',
  'SCHEDULER_PARALLEL_GROUP_BLOCKED', 'SCHEDULER_APPROVAL_WAIT_BLOCKED', 'SCHEDULER_CAPACITY_BLOCKED',
  'SCHEDULER_CONCURRENCY_BLOCKED', 'SCHEDULER_BUDGET_BLOCKED', 'SCHEDULER_FRESHNESS_BLOCKED',
  'SCHEDULER_REPLAY_BLOCKED', 'SCHEDULER_IDEMPOTENCY_BLOCKED', 'SCHEDULER_QUEUE_PLAN_BLOCKED',
  'SCHEDULER_FINGERPRINT_BLOCKED', 'SCHEDULER_DIGEST_BLOCKED', 'SCHEDULER_VERSION_BLOCKED',
  'SCHEDULER_CONFLICT_BLOCKED', 'SCHEDULER_UNKNOWN_STATUS_BLOCKED', 'SCHEDULER_PACKAGE_PREPARED_SIMULATION'
]);

const RUNTIME_SCHEDULER_DECISIONS = Object.freeze([
  'PREPARE_SCHEDULER_PACKAGE_SIMULATION', 'REQUEST_ADMISSION_REEVALUATION', 'REQUEST_RUNTIME_PACKAGE_REBUILD',
  'REQUEST_STAGE_MANIFEST_REBUILD', 'REQUEST_DEPENDENCY_REBUILD', 'REQUEST_CAPACITY_REFRESH',
  'REQUEST_CONCURRENCY_REVIEW', 'REQUEST_BUDGET_REBUILD', 'REQUEST_FRESHNESS_REFRESH', 'REQUEST_REPLAY_REVIEW',
  'REQUEST_IDEMPOTENCY_REBUILD', 'REQUEST_QUEUE_PLAN_REBUILD', 'BLOCKED'
]);

const RUNTIME_SCHEDULER_NEXT_STATES = Object.freeze([
  'SCHEDULER_PACKAGE_PREPARED_REFERENCE_SIMULATION', 'WAITING_ADMISSION_REEVALUATION_REFERENCE',
  'WAITING_RUNTIME_PACKAGE_REBUILD_REFERENCE', 'WAITING_STAGE_MANIFEST_REBUILD_REFERENCE',
  'WAITING_DEPENDENCY_REBUILD_REFERENCE', 'WAITING_CAPACITY_REFRESH_REFERENCE',
  'WAITING_CONCURRENCY_REVIEW_REFERENCE', 'WAITING_BUDGET_REBUILD_REFERENCE', 'WAITING_FRESHNESS_REFRESH_REFERENCE',
  'WAITING_REPLAY_REVIEW_REFERENCE', 'WAITING_IDEMPOTENCY_REBUILD_REFERENCE', 'WAITING_QUEUE_PLAN_REBUILD_REFERENCE',
  'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

// Statuses with no dedicated REQUEST_*/PREPARE_* name (9 own + 6 identity = 15) fall to
// DEFAULT_OUTCOME -- the same "specific status wins, everything else collapses to BLOCKED" pattern
// every decision/result pair in this codebase already uses.
const STATUS_OUTCOME_MAP = Object.freeze({
  SCHEDULER_PACKAGE_PREPARED_SIMULATION: { decision: 'PREPARE_SCHEDULER_PACKAGE_SIMULATION', next_state: 'SCHEDULER_PACKAGE_PREPARED_REFERENCE_SIMULATION' },
  SCHEDULER_ADMISSION_BLOCKED: { decision: 'REQUEST_ADMISSION_REEVALUATION', next_state: 'WAITING_ADMISSION_REEVALUATION_REFERENCE' },
  SCHEDULER_RUNTIME_PACKAGE_BLOCKED: { decision: 'REQUEST_RUNTIME_PACKAGE_REBUILD', next_state: 'WAITING_RUNTIME_PACKAGE_REBUILD_REFERENCE' },
  SCHEDULER_STAGE_BLOCKED: { decision: 'REQUEST_STAGE_MANIFEST_REBUILD', next_state: 'WAITING_STAGE_MANIFEST_REBUILD_REFERENCE' },
  SCHEDULER_DEPENDENCY_BLOCKED: { decision: 'REQUEST_DEPENDENCY_REBUILD', next_state: 'WAITING_DEPENDENCY_REBUILD_REFERENCE' },
  SCHEDULER_CAPACITY_BLOCKED: { decision: 'REQUEST_CAPACITY_REFRESH', next_state: 'WAITING_CAPACITY_REFRESH_REFERENCE' },
  SCHEDULER_CONCURRENCY_BLOCKED: { decision: 'REQUEST_CONCURRENCY_REVIEW', next_state: 'WAITING_CONCURRENCY_REVIEW_REFERENCE' },
  SCHEDULER_BUDGET_BLOCKED: { decision: 'REQUEST_BUDGET_REBUILD', next_state: 'WAITING_BUDGET_REBUILD_REFERENCE' },
  SCHEDULER_FRESHNESS_BLOCKED: { decision: 'REQUEST_FRESHNESS_REFRESH', next_state: 'WAITING_FRESHNESS_REFRESH_REFERENCE' },
  SCHEDULER_REPLAY_BLOCKED: { decision: 'REQUEST_REPLAY_REVIEW', next_state: 'WAITING_REPLAY_REVIEW_REFERENCE' },
  SCHEDULER_IDEMPOTENCY_BLOCKED: { decision: 'REQUEST_IDEMPOTENCY_REBUILD', next_state: 'WAITING_IDEMPOTENCY_REBUILD_REFERENCE' },
  SCHEDULER_QUEUE_PLAN_BLOCKED: { decision: 'REQUEST_QUEUE_PLAN_REBUILD', next_state: 'WAITING_QUEUE_PLAN_REBUILD_REFERENCE' }
});

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'policy_validated', 'admission_validated', 'runtime_package_validated', 'identity_validated',
  'stage_manifest_validated', 'dependency_manifest_validated', 'budget_validated', 'freshness_validated',
  'replay_validated', 'idempotency_validated', 'capacity_validated', 'concurrency_validated',
  'scheduler_stages_validated', 'scheduler_dependencies_validated', 'parallel_groups_validated',
  'approval_waits_validated', 'capacity_plan_validated', 'queue_plan_validated', 'package_fingerprint_validated',
  'package_digest_validated', 'non_execution_invariants_validated'
]);

const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  scheduler_started: false,
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  job_created: false,
  queue_created: false,
  queue_used: false,
  worker_started: false,
  stage_dispatched: false,
  stage_started: false,
  stage_completed: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const FINGERPRINT_FIELDS = Object.freeze([
  'runtime_scheduler_request_fingerprint', 'runtime_scheduler_package_fingerprint', 'runtime_scheduler_package_digest',
  'runtime_admission_decision_fingerprint', 'runtime_admission_result_fingerprint',
  'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
  'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint', 'runtime_freshness_fingerprint',
  'runtime_replay_fingerprint', 'idempotency_fingerprint'
]);

const RUNTIME_SCHEDULER_DECISION_FIELDS = Object.freeze([
  'runtime_scheduler_decision_id', 'runtime_scheduler_request_id', 'runtime_scheduler_package_id',
  'runtime_admission_decision_id', 'runtime_admission_result_id', 'runtime_execution_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  ...FINGERPRINT_FIELDS,
  'blockers', 'reason_codes',
  ...VALIDATION_FLAG_FIELDS,
  'scheduler_evaluated', 'scheduler_package_prepared_in_simulation',
  'scheduler_started', 'runtime_enabled', 'execution_authorized', 'execution_started', 'job_created',
  'queue_created', 'queue_used', 'worker_started', 'stage_dispatched', 'stage_started', 'stage_completed', 'executed',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeSchedulerDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['runtime_scheduler_decision_must_be_object'] };
  exactFields(decision, RUNTIME_SCHEDULER_DECISION_FIELDS, 'runtime_scheduler_decision', errors);
  for (const field of [
    'runtime_scheduler_decision_id', 'runtime_scheduler_request_id', 'runtime_scheduler_package_id',
    'runtime_admission_decision_id', 'runtime_admission_result_id', 'runtime_execution_package_id',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
    ...FINGERPRINT_FIELDS, 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_SCHEDULER_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!RUNTIME_SCHEDULER_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!RUNTIME_SCHEDULER_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (decision.scheduler_evaluated !== true) errors.push('scheduler_evaluated_must_be_true');
  if (typeof decision.scheduler_package_prepared_in_simulation !== 'boolean') errors.push('scheduler_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = decision.status === 'SCHEDULER_PACKAGE_PREPARED_SIMULATION';
  if (decision.scheduler_package_prepared_in_simulation !== expectedPrepared) errors.push('scheduler_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== RUNTIME_SCHEDULER_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerDecision(input = {}) {
  const status = RUNTIME_SCHEDULER_STATUSES.includes(input.status) ? input.status : 'SCHEDULER_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    runtime_scheduler_decision_id: input.runtime_scheduler_decision_id,
    runtime_scheduler_request_id: input.runtime_scheduler_request_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_admission_decision_id: input.runtime_admission_decision_id,
    runtime_admission_result_id: input.runtime_admission_result_id,
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
    scheduler_evaluated: true,
    scheduler_package_prepared_in_simulation: status === 'SCHEDULER_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_DECISION_VALIDATOR_VERSION
  };
  for (const field of FINGERPRINT_FIELDS) {
    decision[field] = input[field] || 'fingerprint_not_available';
  }
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateRuntimeSchedulerDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  FINGERPRINT_FIELDS,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  RUNTIME_SCHEDULER_DECISIONS,
  RUNTIME_SCHEDULER_DECISION_FIELDS,
  RUNTIME_SCHEDULER_DECISION_VALIDATOR_VERSION,
  RUNTIME_SCHEDULER_NEXT_STATES,
  RUNTIME_SCHEDULER_PRECEDENCE_ORDER,
  RUNTIME_SCHEDULER_STATUSES,
  RUNTIME_SCHEDULER_STATUSES_OWN,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildRuntimeSchedulerDecision,
  validateRuntimeSchedulerDecision
};
