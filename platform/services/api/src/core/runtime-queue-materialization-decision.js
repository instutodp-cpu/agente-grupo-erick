'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr109: the Queue Materialization layer's own status/decision/next_state vocabulary -- separate
// from Queue Admission's own, mirrors every prior layer's own shape one level up. 5 own statuses + 6
// reused identity statuses = 11. "Queue Materialization Simulation não recalcula compatibilidade de
// Queue Class, worker capacity, quota eligibility, fairness eligibility, priority eligibility,
// admission limits ou admission status -- apenas valida a integridade dessas decisões já tomadas
// pela Queue Admission layer."
const RUNTIME_QUEUE_MATERIALIZATION_DECISION_VALIDATOR_VERSION = 'runtime_queue_materialization_decision_validator_v1';

const QUEUE_MATERIALIZATION_STATUSES_OWN = Object.freeze([
  'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION', 'QUEUE_MATERIALIZATION_VALIDATION_FAILED',
  'QUEUE_MATERIALIZATION_BLOCKED_BY_INHERITED_DATA', 'QUEUE_MATERIALIZATION_PREDECESSOR_BLOCKED',
  'QUEUE_MATERIALIZATION_ORDER_BLOCKED'
]);

const QUEUE_MATERIALIZATION_STATUSES = Object.freeze([
  ...QUEUE_MATERIALIZATION_STATUSES_OWN, 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED',
  'SESSION_BLOCKED', 'AGENT_BLOCKED', 'ACTOR_BLOCKED'
]);

// The spec's own "Precedência obrigatória" pattern -- identity before inherited-data integrity,
// inherited-data before order/predecessor, order/predecessor before the prepared outcome.
const QUEUE_MATERIALIZATION_PRECEDENCE_ORDER = Object.freeze([
  'QUEUE_MATERIALIZATION_VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED',
  'SESSION_BLOCKED', 'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'QUEUE_MATERIALIZATION_BLOCKED_BY_INHERITED_DATA',
  'QUEUE_MATERIALIZATION_ORDER_BLOCKED', 'QUEUE_MATERIALIZATION_PREDECESSOR_BLOCKED',
  'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION'
]);

const QUEUE_MATERIALIZATION_DECISIONS = Object.freeze([
  'PREPARE_QUEUE_MATERIALIZATION_PACKAGE_SIMULATION', 'REQUEST_ADMISSION_REBUILD', 'REQUEST_ORDER_REBUILD',
  'REQUEST_PREDECESSOR_REVIEW', 'BLOCKED'
]);

const QUEUE_MATERIALIZATION_NEXT_STATES = Object.freeze([
  'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_REFERENCE_SIMULATION', 'WAITING_ADMISSION_REBUILD_REFERENCE',
  'WAITING_ORDER_REBUILD_REFERENCE', 'WAITING_PREDECESSOR_REVIEW_REFERENCE', 'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

const STATUS_OUTCOME_MAP = Object.freeze({
  QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION: { decision: 'PREPARE_QUEUE_MATERIALIZATION_PACKAGE_SIMULATION', next_state: 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_REFERENCE_SIMULATION' },
  QUEUE_MATERIALIZATION_BLOCKED_BY_INHERITED_DATA: { decision: 'REQUEST_ADMISSION_REBUILD', next_state: 'WAITING_ADMISSION_REBUILD_REFERENCE' },
  QUEUE_MATERIALIZATION_ORDER_BLOCKED: { decision: 'REQUEST_ORDER_REBUILD', next_state: 'WAITING_ORDER_REBUILD_REFERENCE' },
  QUEUE_MATERIALIZATION_PREDECESSOR_BLOCKED: { decision: 'REQUEST_PREDECESSOR_REVIEW', next_state: 'WAITING_PREDECESSOR_REVIEW_REFERENCE' }
});

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'admission_package_validated', 'identity_validated', 'cardinality_validated',
  'reference_integrity_validated', 'canonical_order_validated', 'predecessor_order_validated',
  'eligibility_validated', 'entries_validated', 'materialization_order_validated',
  'non_execution_invariants_validated'
]);

// The Decision's own, narrower operational-safe surface (Result carries a broader surface -- see
// runtime-queue-materialization-result.js). "Mesmo no cenário aprovado" -- every one of these stays
// permanently false regardless of status. Named explicitly against every forbidden capability listed
// in the spec's own prohibition list (queue/item/enqueue/broker/worker/job/dispatch).
const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  queue_materialization_applied: false,
  queue_created: false,
  queue_item_created: false,
  queue_item_enqueued: false,
  queue_position_reserved: false,
  broker_published: false,
  worker_notified: false,
  job_created: false,
  dispatch_executed: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const FINGERPRINT_FIELDS = Object.freeze([
  'runtime_queue_materialization_request_fingerprint', 'runtime_queue_materialization_package_fingerprint',
  'runtime_queue_materialization_package_digest', 'runtime_queue_admission_package_fingerprint',
  'runtime_queue_admission_package_digest'
]);

const RUNTIME_QUEUE_MATERIALIZATION_DECISION_FIELDS = Object.freeze([
  'runtime_queue_materialization_decision_id', 'runtime_queue_materialization_request_id',
  'runtime_queue_materialization_package_id', 'runtime_queue_admission_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  ...FINGERPRINT_FIELDS,
  'blockers', 'reason_codes',
  ...VALIDATION_FLAG_FIELDS,
  'queue_materialization_evaluated', 'queue_materialization_package_prepared_in_simulation',
  ...Object.keys(OPERATIONAL_SAFE_FLAGS),
  'rollout_percentage', 'validator_version'
]);

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeQueueMaterializationDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['runtime_queue_materialization_decision_must_be_object'] };
  exactFields(decision, RUNTIME_QUEUE_MATERIALIZATION_DECISION_FIELDS, 'runtime_queue_materialization_decision', errors);
  for (const field of [
    'runtime_queue_materialization_decision_id', 'runtime_queue_materialization_request_id',
    'runtime_queue_materialization_package_id', 'runtime_queue_admission_package_id',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
    ...FINGERPRINT_FIELDS, 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!QUEUE_MATERIALIZATION_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!QUEUE_MATERIALIZATION_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!QUEUE_MATERIALIZATION_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (decision.queue_materialization_evaluated !== true) errors.push('queue_materialization_evaluated_must_be_true');
  if (typeof decision.queue_materialization_package_prepared_in_simulation !== 'boolean') errors.push('queue_materialization_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = decision.status === 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION';
  if (decision.queue_materialization_package_prepared_in_simulation !== expectedPrepared) errors.push('queue_materialization_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== RUNTIME_QUEUE_MATERIALIZATION_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueMaterializationDecision(input = {}) {
  const status = QUEUE_MATERIALIZATION_STATUSES.includes(input.status) ? input.status : 'QUEUE_MATERIALIZATION_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    runtime_queue_materialization_decision_id: input.runtime_queue_materialization_decision_id,
    runtime_queue_materialization_request_id: input.runtime_queue_materialization_request_id,
    runtime_queue_materialization_package_id: input.runtime_queue_materialization_package_id,
    runtime_queue_admission_package_id: input.runtime_queue_admission_package_id,
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
    queue_materialization_evaluated: true,
    queue_materialization_package_prepared_in_simulation: status === 'QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_MATERIALIZATION_DECISION_VALIDATOR_VERSION
  };
  for (const field of FINGERPRINT_FIELDS) {
    decision[field] = input[field] || 'fingerprint_not_available';
  }
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateRuntimeQueueMaterializationDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_queue_materialization_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  FINGERPRINT_FIELDS,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  QUEUE_MATERIALIZATION_DECISIONS,
  QUEUE_MATERIALIZATION_NEXT_STATES,
  QUEUE_MATERIALIZATION_PRECEDENCE_ORDER,
  QUEUE_MATERIALIZATION_STATUSES,
  QUEUE_MATERIALIZATION_STATUSES_OWN,
  RUNTIME_QUEUE_MATERIALIZATION_DECISION_FIELDS,
  RUNTIME_QUEUE_MATERIALIZATION_DECISION_VALIDATOR_VERSION,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildRuntimeQueueMaterializationDecision,
  validateRuntimeQueueMaterializationDecision
};
