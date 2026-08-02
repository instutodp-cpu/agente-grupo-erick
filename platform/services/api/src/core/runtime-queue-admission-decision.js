'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr108: the Queue Admission layer's own status/decision/next_state vocabulary -- separate from
// every prior layer's own, mirrors runtime-dispatch-decision.js's own shape one layer below. 21
// own statuses + 6 reused identity statuses = 27. "Nenhum score altera precedência."
const RUNTIME_QUEUE_ADMISSION_DECISION_VALIDATOR_VERSION = 'runtime_queue_admission_decision_validator_v1';

const QUEUE_ADMISSION_STATUSES_OWN = Object.freeze([
  'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION', 'QUEUE_ADMISSION_VALIDATION_FAILED', 'QUEUE_ADMISSION_POLICY_BLOCKED',
  'QUEUE_ADMISSION_DISPATCH_BLOCKED', 'QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED', 'QUEUE_ADMISSION_PARTITION_BLOCKED',
  'QUEUE_ADMISSION_QUOTA_BLOCKED', 'QUEUE_ADMISSION_CAPACITY_BLOCKED', 'QUEUE_ADMISSION_FAIRNESS_BLOCKED',
  'QUEUE_ADMISSION_ORDER_BLOCKED', 'QUEUE_ADMISSION_FRESHNESS_BLOCKED', 'QUEUE_ADMISSION_REPLAY_BLOCKED',
  'QUEUE_ADMISSION_IDEMPOTENCY_BLOCKED', 'QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED',
  'QUEUE_ADMISSION_NETWORK_POLICY_BLOCKED', 'QUEUE_ADMISSION_SECRET_POLICY_BLOCKED', 'QUEUE_ADMISSION_FINGERPRINT_BLOCKED',
  'QUEUE_ADMISSION_DIGEST_BLOCKED', 'QUEUE_ADMISSION_VERSION_BLOCKED', 'QUEUE_ADMISSION_CONFLICT_BLOCKED',
  'QUEUE_ADMISSION_UNKNOWN_STATUS_BLOCKED'
]);

const QUEUE_ADMISSION_STATUSES = Object.freeze([
  ...QUEUE_ADMISSION_STATUSES_OWN, 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED'
]);

// The spec's own "Precedência obrigatória" -- 27 statuses, real evaluation order.
const QUEUE_ADMISSION_PRECEDENCE_ORDER = Object.freeze([
  'QUEUE_ADMISSION_VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'QUEUE_ADMISSION_POLICY_BLOCKED', 'QUEUE_ADMISSION_DISPATCH_BLOCKED',
  'QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED', 'QUEUE_ADMISSION_PARTITION_BLOCKED', 'QUEUE_ADMISSION_QUOTA_BLOCKED',
  'QUEUE_ADMISSION_CAPACITY_BLOCKED', 'QUEUE_ADMISSION_FAIRNESS_BLOCKED', 'QUEUE_ADMISSION_ORDER_BLOCKED',
  'QUEUE_ADMISSION_FRESHNESS_BLOCKED', 'QUEUE_ADMISSION_REPLAY_BLOCKED', 'QUEUE_ADMISSION_IDEMPOTENCY_BLOCKED',
  'QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED', 'QUEUE_ADMISSION_NETWORK_POLICY_BLOCKED',
  'QUEUE_ADMISSION_SECRET_POLICY_BLOCKED', 'QUEUE_ADMISSION_FINGERPRINT_BLOCKED', 'QUEUE_ADMISSION_DIGEST_BLOCKED',
  'QUEUE_ADMISSION_VERSION_BLOCKED', 'QUEUE_ADMISSION_CONFLICT_BLOCKED', 'QUEUE_ADMISSION_UNKNOWN_STATUS_BLOCKED',
  'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION'
]);

const QUEUE_ADMISSION_DECISIONS = Object.freeze([
  'PREPARE_QUEUE_ADMISSION_PACKAGE_SIMULATION', 'REQUEST_DISPATCH_REBUILD', 'REQUEST_QUEUE_CLASS_REFRESH',
  'REQUEST_QUEUE_CAPACITY_REFRESH', 'REQUEST_QUEUE_QUOTA_REFRESH', 'REQUEST_QUEUE_PARTITION_REBUILD',
  'REQUEST_QUEUE_FAIRNESS_REVIEW', 'REQUEST_FRESHNESS_REFRESH', 'REQUEST_REPLAY_REVIEW', 'REQUEST_IDEMPOTENCY_REBUILD',
  'REQUEST_REGISTRY_SNAPSHOT_REFRESH', 'REQUEST_POLICY_REVIEW', 'REQUEST_ORDER_REBUILD', 'BLOCKED'
]);

const QUEUE_ADMISSION_NEXT_STATES = Object.freeze([
  'QUEUE_ADMISSION_PACKAGE_PREPARED_REFERENCE_SIMULATION', 'WAITING_DISPATCH_REBUILD_REFERENCE',
  'WAITING_QUEUE_CLASS_REFRESH_REFERENCE', 'WAITING_QUEUE_CAPACITY_REFRESH_REFERENCE',
  'WAITING_QUEUE_QUOTA_REFRESH_REFERENCE', 'WAITING_QUEUE_PARTITION_REBUILD_REFERENCE',
  'WAITING_QUEUE_FAIRNESS_REVIEW_REFERENCE', 'WAITING_FRESHNESS_REFRESH_REFERENCE', 'WAITING_REPLAY_REVIEW_REFERENCE',
  'WAITING_IDEMPOTENCY_REBUILD_REFERENCE', 'WAITING_REGISTRY_SNAPSHOT_REFRESH_REFERENCE',
  'WAITING_POLICY_REVIEW_REFERENCE', 'WAITING_ORDER_REBUILD_REFERENCE', 'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

const STATUS_OUTCOME_MAP = Object.freeze({
  QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION: { decision: 'PREPARE_QUEUE_ADMISSION_PACKAGE_SIMULATION', next_state: 'QUEUE_ADMISSION_PACKAGE_PREPARED_REFERENCE_SIMULATION' },
  QUEUE_ADMISSION_DISPATCH_BLOCKED: { decision: 'REQUEST_DISPATCH_REBUILD', next_state: 'WAITING_DISPATCH_REBUILD_REFERENCE' },
  QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED: { decision: 'REQUEST_QUEUE_CLASS_REFRESH', next_state: 'WAITING_QUEUE_CLASS_REFRESH_REFERENCE' },
  QUEUE_ADMISSION_CAPACITY_BLOCKED: { decision: 'REQUEST_QUEUE_CAPACITY_REFRESH', next_state: 'WAITING_QUEUE_CAPACITY_REFRESH_REFERENCE' },
  QUEUE_ADMISSION_QUOTA_BLOCKED: { decision: 'REQUEST_QUEUE_QUOTA_REFRESH', next_state: 'WAITING_QUEUE_QUOTA_REFRESH_REFERENCE' },
  QUEUE_ADMISSION_PARTITION_BLOCKED: { decision: 'REQUEST_QUEUE_PARTITION_REBUILD', next_state: 'WAITING_QUEUE_PARTITION_REBUILD_REFERENCE' },
  QUEUE_ADMISSION_FAIRNESS_BLOCKED: { decision: 'REQUEST_QUEUE_FAIRNESS_REVIEW', next_state: 'WAITING_QUEUE_FAIRNESS_REVIEW_REFERENCE' },
  QUEUE_ADMISSION_FRESHNESS_BLOCKED: { decision: 'REQUEST_FRESHNESS_REFRESH', next_state: 'WAITING_FRESHNESS_REFRESH_REFERENCE' },
  QUEUE_ADMISSION_REPLAY_BLOCKED: { decision: 'REQUEST_REPLAY_REVIEW', next_state: 'WAITING_REPLAY_REVIEW_REFERENCE' },
  QUEUE_ADMISSION_IDEMPOTENCY_BLOCKED: { decision: 'REQUEST_IDEMPOTENCY_REBUILD', next_state: 'WAITING_IDEMPOTENCY_REBUILD_REFERENCE' },
  QUEUE_ADMISSION_REGISTRY_SNAPSHOT_BLOCKED: { decision: 'REQUEST_REGISTRY_SNAPSHOT_REFRESH', next_state: 'WAITING_REGISTRY_SNAPSHOT_REFRESH_REFERENCE' },
  QUEUE_ADMISSION_POLICY_BLOCKED: { decision: 'REQUEST_POLICY_REVIEW', next_state: 'WAITING_POLICY_REVIEW_REFERENCE' },
  QUEUE_ADMISSION_ORDER_BLOCKED: { decision: 'REQUEST_ORDER_REBUILD', next_state: 'WAITING_ORDER_REBUILD_REFERENCE' }
});

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'policy_validated', 'dispatch_validated', 'identity_validated', 'freshness_validated',
  'replay_validated', 'idempotency_validated', 'registry_snapshot_validated', 'network_policies_validated',
  'secret_policies_validated', 'stage_policy_requirements_validated', 'queue_classes_validated',
  'queue_capacity_snapshots_validated', 'queue_quotas_validated', 'queue_partitions_validated',
  'queue_fairness_validated', 'intent_bindings_validated', 'admission_entries_validated',
  'admission_order_validated', 'package_fingerprint_validated', 'package_digest_validated',
  'non_execution_invariants_validated'
]);

// The Decision's own, narrower 16-flag operational surface (Result carries a broader 29-flag
// surface -- see runtime-queue-admission-result.js). "Mesmo no cenário aprovado" -- every one of
// these stays permanently false regardless of status.
const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  queue_admission_applied: false,
  queue_created: false,
  queue_item_created: false,
  queue_item_enqueued: false,
  queue_position_reserved: false,
  queue_capacity_consumed: false,
  queue_backlog_changed: false,
  job_created: false,
  dispatch_authorized: false,
  dispatch_applied: false,
  dispatch_sent: false,
  worker_reserved: false,
  worker_started: false,
  stage_dispatched: false,
  stage_started: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const FINGERPRINT_FIELDS = Object.freeze([
  'runtime_queue_admission_request_fingerprint', 'runtime_queue_admission_package_fingerprint',
  'runtime_queue_admission_package_digest', 'runtime_dispatch_package_fingerprint', 'runtime_dispatch_package_digest'
]);

const RUNTIME_QUEUE_ADMISSION_DECISION_FIELDS = Object.freeze([
  'runtime_queue_admission_decision_id', 'runtime_queue_admission_request_id', 'runtime_queue_admission_package_id',
  'runtime_dispatch_decision_id', 'runtime_dispatch_result_id', 'runtime_dispatch_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  ...FINGERPRINT_FIELDS,
  'blockers', 'reason_codes',
  ...VALIDATION_FLAG_FIELDS,
  'queue_admission_evaluated', 'queue_admission_package_prepared_in_simulation',
  ...Object.keys(OPERATIONAL_SAFE_FLAGS),
  'rollout_percentage', 'validator_version'
]);

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeQueueAdmissionDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['runtime_queue_admission_decision_must_be_object'] };
  exactFields(decision, RUNTIME_QUEUE_ADMISSION_DECISION_FIELDS, 'runtime_queue_admission_decision', errors);
  for (const field of [
    'runtime_queue_admission_decision_id', 'runtime_queue_admission_request_id', 'runtime_queue_admission_package_id',
    'runtime_dispatch_decision_id', 'runtime_dispatch_result_id', 'runtime_dispatch_package_id',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
    ...FINGERPRINT_FIELDS, 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!QUEUE_ADMISSION_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!QUEUE_ADMISSION_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!QUEUE_ADMISSION_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (decision.queue_admission_evaluated !== true) errors.push('queue_admission_evaluated_must_be_true');
  if (typeof decision.queue_admission_package_prepared_in_simulation !== 'boolean') errors.push('queue_admission_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = decision.status === 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION';
  if (decision.queue_admission_package_prepared_in_simulation !== expectedPrepared) errors.push('queue_admission_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== RUNTIME_QUEUE_ADMISSION_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueAdmissionDecision(input = {}) {
  const status = QUEUE_ADMISSION_STATUSES.includes(input.status) ? input.status : 'QUEUE_ADMISSION_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    runtime_queue_admission_decision_id: input.runtime_queue_admission_decision_id,
    runtime_queue_admission_request_id: input.runtime_queue_admission_request_id,
    runtime_queue_admission_package_id: input.runtime_queue_admission_package_id,
    runtime_dispatch_decision_id: input.runtime_dispatch_decision_id,
    runtime_dispatch_result_id: input.runtime_dispatch_result_id,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
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
    queue_admission_evaluated: true,
    queue_admission_package_prepared_in_simulation: status === 'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_ADMISSION_DECISION_VALIDATOR_VERSION
  };
  for (const field of FINGERPRINT_FIELDS) {
    decision[field] = input[field] || 'fingerprint_not_available';
  }
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateRuntimeQueueAdmissionDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_queue_admission_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  FINGERPRINT_FIELDS,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  QUEUE_ADMISSION_DECISIONS,
  QUEUE_ADMISSION_NEXT_STATES,
  QUEUE_ADMISSION_PRECEDENCE_ORDER,
  QUEUE_ADMISSION_STATUSES,
  QUEUE_ADMISSION_STATUSES_OWN,
  RUNTIME_QUEUE_ADMISSION_DECISION_FIELDS,
  RUNTIME_QUEUE_ADMISSION_DECISION_VALIDATOR_VERSION,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildRuntimeQueueAdmissionDecision,
  validateRuntimeQueueAdmissionDecision
};
