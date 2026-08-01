'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr107: the Dispatch layer's own status/decision/next_state vocabulary -- separate from every
// prior layer's own, mirrors runtime-worker-assignment-decision.js's own shape one layer below. 24
// own statuses + 6 reused identity statuses = 30. "Nenhum score altera precedência."
const RUNTIME_DISPATCH_DECISION_VALIDATOR_VERSION = 'runtime_dispatch_decision_validator_v1';

const DISPATCH_STATUSES_OWN = Object.freeze([
  'DISPATCH_PACKAGE_PREPARED_SIMULATION', 'DISPATCH_VALIDATION_FAILED', 'DISPATCH_POLICY_BLOCKED',
  'DISPATCH_WORKER_ASSIGNMENT_BLOCKED', 'DISPATCH_SCHEDULER_BLOCKED', 'DISPATCH_RUNTIME_PACKAGE_BLOCKED',
  'DISPATCH_STAGE_BLOCKED', 'DISPATCH_WORKER_BINDING_BLOCKED', 'DISPATCH_DEPENDENCY_BLOCKED', 'DISPATCH_APPROVAL_BLOCKED',
  'DISPATCH_CAPACITY_BLOCKED', 'DISPATCH_BUDGET_BLOCKED', 'DISPATCH_PAYLOAD_BLOCKED', 'DISPATCH_ORDER_BLOCKED',
  'DISPATCH_FRESHNESS_BLOCKED', 'DISPATCH_REPLAY_BLOCKED', 'DISPATCH_IDEMPOTENCY_BLOCKED',
  'DISPATCH_REGISTRY_SNAPSHOT_BLOCKED', 'DISPATCH_NETWORK_POLICY_BLOCKED', 'DISPATCH_SECRET_POLICY_BLOCKED',
  'DISPATCH_FINGERPRINT_BLOCKED', 'DISPATCH_DIGEST_BLOCKED', 'DISPATCH_VERSION_BLOCKED', 'DISPATCH_CONFLICT_BLOCKED',
  'DISPATCH_UNKNOWN_STATUS_BLOCKED'
]);

const DISPATCH_STATUSES = Object.freeze([
  ...DISPATCH_STATUSES_OWN, 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED'
]);

// The spec's own "Precedência obrigatória" -- 31 statuses, real evaluation order.
const DISPATCH_PRECEDENCE_ORDER = Object.freeze([
  'DISPATCH_VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'DISPATCH_POLICY_BLOCKED', 'DISPATCH_WORKER_ASSIGNMENT_BLOCKED',
  'DISPATCH_SCHEDULER_BLOCKED', 'DISPATCH_RUNTIME_PACKAGE_BLOCKED', 'DISPATCH_STAGE_BLOCKED',
  'DISPATCH_WORKER_BINDING_BLOCKED', 'DISPATCH_DEPENDENCY_BLOCKED', 'DISPATCH_APPROVAL_BLOCKED',
  'DISPATCH_CAPACITY_BLOCKED', 'DISPATCH_BUDGET_BLOCKED', 'DISPATCH_PAYLOAD_BLOCKED', 'DISPATCH_ORDER_BLOCKED',
  'DISPATCH_FRESHNESS_BLOCKED', 'DISPATCH_REPLAY_BLOCKED', 'DISPATCH_IDEMPOTENCY_BLOCKED',
  'DISPATCH_REGISTRY_SNAPSHOT_BLOCKED', 'DISPATCH_NETWORK_POLICY_BLOCKED', 'DISPATCH_SECRET_POLICY_BLOCKED',
  'DISPATCH_FINGERPRINT_BLOCKED', 'DISPATCH_DIGEST_BLOCKED', 'DISPATCH_VERSION_BLOCKED', 'DISPATCH_CONFLICT_BLOCKED',
  'DISPATCH_UNKNOWN_STATUS_BLOCKED', 'DISPATCH_PACKAGE_PREPARED_SIMULATION'
]);

const DISPATCH_DECISIONS = Object.freeze([
  'PREPARE_DISPATCH_PACKAGE_SIMULATION', 'REQUEST_WORKER_ASSIGNMENT_REBUILD', 'REQUEST_SCHEDULER_REBUILD',
  'REQUEST_RUNTIME_PACKAGE_REBUILD', 'REQUEST_WORKER_BINDING_REVIEW', 'REQUEST_DEPENDENCY_REVIEW',
  'REQUEST_APPROVAL_REVIEW', 'REQUEST_CAPACITY_REFRESH', 'REQUEST_BUDGET_REBUILD', 'REQUEST_FRESHNESS_REFRESH',
  'REQUEST_REPLAY_REVIEW', 'REQUEST_IDEMPOTENCY_REBUILD', 'REQUEST_REGISTRY_SNAPSHOT_REFRESH', 'REQUEST_POLICY_REVIEW',
  'REQUEST_PAYLOAD_REBUILD', 'REQUEST_ORDER_REBUILD', 'BLOCKED'
]);

const DISPATCH_NEXT_STATES = Object.freeze([
  'DISPATCH_PACKAGE_PREPARED_REFERENCE_SIMULATION', 'WAITING_WORKER_ASSIGNMENT_REBUILD_REFERENCE',
  'WAITING_SCHEDULER_REBUILD_REFERENCE', 'WAITING_RUNTIME_PACKAGE_REBUILD_REFERENCE',
  'WAITING_WORKER_BINDING_REVIEW_REFERENCE', 'WAITING_DEPENDENCY_REVIEW_REFERENCE', 'WAITING_APPROVAL_REVIEW_REFERENCE',
  'WAITING_CAPACITY_REFRESH_REFERENCE', 'WAITING_BUDGET_REBUILD_REFERENCE', 'WAITING_FRESHNESS_REFRESH_REFERENCE',
  'WAITING_REPLAY_REVIEW_REFERENCE', 'WAITING_IDEMPOTENCY_REBUILD_REFERENCE', 'WAITING_REGISTRY_SNAPSHOT_REFRESH_REFERENCE',
  'WAITING_POLICY_REVIEW_REFERENCE', 'WAITING_PAYLOAD_REBUILD_REFERENCE', 'WAITING_ORDER_REBUILD_REFERENCE',
  'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

const STATUS_OUTCOME_MAP = Object.freeze({
  DISPATCH_PACKAGE_PREPARED_SIMULATION: { decision: 'PREPARE_DISPATCH_PACKAGE_SIMULATION', next_state: 'DISPATCH_PACKAGE_PREPARED_REFERENCE_SIMULATION' },
  DISPATCH_WORKER_ASSIGNMENT_BLOCKED: { decision: 'REQUEST_WORKER_ASSIGNMENT_REBUILD', next_state: 'WAITING_WORKER_ASSIGNMENT_REBUILD_REFERENCE' },
  DISPATCH_SCHEDULER_BLOCKED: { decision: 'REQUEST_SCHEDULER_REBUILD', next_state: 'WAITING_SCHEDULER_REBUILD_REFERENCE' },
  DISPATCH_RUNTIME_PACKAGE_BLOCKED: { decision: 'REQUEST_RUNTIME_PACKAGE_REBUILD', next_state: 'WAITING_RUNTIME_PACKAGE_REBUILD_REFERENCE' },
  DISPATCH_WORKER_BINDING_BLOCKED: { decision: 'REQUEST_WORKER_BINDING_REVIEW', next_state: 'WAITING_WORKER_BINDING_REVIEW_REFERENCE' },
  DISPATCH_DEPENDENCY_BLOCKED: { decision: 'REQUEST_DEPENDENCY_REVIEW', next_state: 'WAITING_DEPENDENCY_REVIEW_REFERENCE' },
  DISPATCH_APPROVAL_BLOCKED: { decision: 'REQUEST_APPROVAL_REVIEW', next_state: 'WAITING_APPROVAL_REVIEW_REFERENCE' },
  DISPATCH_CAPACITY_BLOCKED: { decision: 'REQUEST_CAPACITY_REFRESH', next_state: 'WAITING_CAPACITY_REFRESH_REFERENCE' },
  DISPATCH_BUDGET_BLOCKED: { decision: 'REQUEST_BUDGET_REBUILD', next_state: 'WAITING_BUDGET_REBUILD_REFERENCE' },
  DISPATCH_FRESHNESS_BLOCKED: { decision: 'REQUEST_FRESHNESS_REFRESH', next_state: 'WAITING_FRESHNESS_REFRESH_REFERENCE' },
  DISPATCH_REPLAY_BLOCKED: { decision: 'REQUEST_REPLAY_REVIEW', next_state: 'WAITING_REPLAY_REVIEW_REFERENCE' },
  DISPATCH_IDEMPOTENCY_BLOCKED: { decision: 'REQUEST_IDEMPOTENCY_REBUILD', next_state: 'WAITING_IDEMPOTENCY_REBUILD_REFERENCE' },
  DISPATCH_REGISTRY_SNAPSHOT_BLOCKED: { decision: 'REQUEST_REGISTRY_SNAPSHOT_REFRESH', next_state: 'WAITING_REGISTRY_SNAPSHOT_REFRESH_REFERENCE' },
  DISPATCH_POLICY_BLOCKED: { decision: 'REQUEST_POLICY_REVIEW', next_state: 'WAITING_POLICY_REVIEW_REFERENCE' },
  DISPATCH_PAYLOAD_BLOCKED: { decision: 'REQUEST_PAYLOAD_REBUILD', next_state: 'WAITING_PAYLOAD_REBUILD_REFERENCE' },
  DISPATCH_ORDER_BLOCKED: { decision: 'REQUEST_ORDER_REBUILD', next_state: 'WAITING_ORDER_REBUILD_REFERENCE' }
});

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'policy_validated', 'worker_assignment_validated', 'scheduler_validated', 'runtime_package_validated',
  'identity_validated', 'freshness_validated', 'replay_validated', 'idempotency_validated', 'registry_snapshot_validated',
  'network_policies_validated', 'secret_policies_validated', 'stage_policy_requirements_validated',
  'dispatch_stages_validated', 'worker_bindings_validated', 'dependency_gates_validated', 'approval_gates_validated',
  'capacity_references_validated', 'budget_references_validated', 'payload_references_validated',
  'dispatch_intents_validated', 'dispatch_order_validated', 'package_fingerprint_validated', 'package_digest_validated',
  'non_execution_invariants_validated'
]);

const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  dispatch_authorized: false,
  dispatch_applied: false,
  dispatch_sent: false,
  dispatch_acknowledged: false,
  dispatch_lease_created: false,
  worker_reserved: false,
  worker_started: false,
  job_created: false,
  queue_created: false,
  queue_item_created: false,
  queue_used: false,
  stage_dispatched: false,
  stage_started: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const FINGERPRINT_FIELDS = Object.freeze([
  'runtime_dispatch_request_fingerprint', 'runtime_dispatch_package_fingerprint', 'runtime_dispatch_package_digest',
  'worker_assignment_package_fingerprint', 'worker_assignment_package_digest', 'scheduler_package_fingerprint',
  'scheduler_package_digest', 'runtime_execution_package_fingerprint', 'runtime_execution_package_digest'
]);

const RUNTIME_DISPATCH_DECISION_FIELDS = Object.freeze([
  'runtime_dispatch_decision_id', 'runtime_dispatch_request_id', 'runtime_dispatch_package_id',
  'runtime_worker_assignment_decision_id', 'runtime_worker_assignment_result_id', 'runtime_worker_assignment_package_id',
  'runtime_scheduler_decision_id', 'runtime_scheduler_result_id', 'runtime_scheduler_package_id',
  'runtime_execution_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  ...FINGERPRINT_FIELDS,
  'blockers', 'reason_codes',
  ...VALIDATION_FLAG_FIELDS,
  'dispatch_evaluated', 'dispatch_package_prepared_in_simulation',
  ...Object.keys(OPERATIONAL_SAFE_FLAGS),
  'rollout_percentage', 'validator_version'
]);

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeDispatchDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['runtime_dispatch_decision_must_be_object'] };
  exactFields(decision, RUNTIME_DISPATCH_DECISION_FIELDS, 'runtime_dispatch_decision', errors);
  for (const field of [
    'runtime_dispatch_decision_id', 'runtime_dispatch_request_id', 'runtime_dispatch_package_id',
    'runtime_worker_assignment_decision_id', 'runtime_worker_assignment_result_id', 'runtime_worker_assignment_package_id',
    'runtime_scheduler_decision_id', 'runtime_scheduler_result_id', 'runtime_scheduler_package_id',
    'runtime_execution_package_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
    'agent_id', 'actor_id', ...FINGERPRINT_FIELDS, 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!DISPATCH_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!DISPATCH_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!DISPATCH_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (decision.dispatch_evaluated !== true) errors.push('dispatch_evaluated_must_be_true');
  if (typeof decision.dispatch_package_prepared_in_simulation !== 'boolean') errors.push('dispatch_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = decision.status === 'DISPATCH_PACKAGE_PREPARED_SIMULATION';
  if (decision.dispatch_package_prepared_in_simulation !== expectedPrepared) errors.push('dispatch_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== RUNTIME_DISPATCH_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchDecision(input = {}) {
  const status = DISPATCH_STATUSES.includes(input.status) ? input.status : 'DISPATCH_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    runtime_dispatch_decision_id: input.runtime_dispatch_decision_id,
    runtime_dispatch_request_id: input.runtime_dispatch_request_id,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_worker_assignment_decision_id: input.runtime_worker_assignment_decision_id,
    runtime_worker_assignment_result_id: input.runtime_worker_assignment_result_id,
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
    dispatch_evaluated: true,
    dispatch_package_prepared_in_simulation: status === 'DISPATCH_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_DECISION_VALIDATOR_VERSION
  };
  for (const field of FINGERPRINT_FIELDS) {
    decision[field] = input[field] || 'fingerprint_not_available';
  }
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateRuntimeDispatchDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  DISPATCH_DECISIONS,
  DISPATCH_NEXT_STATES,
  DISPATCH_PRECEDENCE_ORDER,
  DISPATCH_STATUSES,
  DISPATCH_STATUSES_OWN,
  FINGERPRINT_FIELDS,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  RUNTIME_DISPATCH_DECISION_FIELDS,
  RUNTIME_DISPATCH_DECISION_VALIDATOR_VERSION,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildRuntimeDispatchDecision,
  validateRuntimeDispatchDecision
};
