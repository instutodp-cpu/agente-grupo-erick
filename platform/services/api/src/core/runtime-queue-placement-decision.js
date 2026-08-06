'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr110: the Queue Placement layer's own status/decision/next_state vocabulary -- separate from
// Queue Materialization's own, mirrors every prior layer's own shape one level up. 6 own statuses +
// 6 reused identity statuses = 12. "Queue Placement Simulation não recalcula admissão, prioridade,
// fairness, capacidade, quota, Queue Class compatibility, ordem canônica, materialization_sequence,
// materialization status, admission status, predecessor graph ou identidade -- apenas valida a
// integridade dessas decisões já tomadas pelas camadas anteriores."
const RUNTIME_QUEUE_PLACEMENT_DECISION_VALIDATOR_VERSION = 'runtime_queue_placement_decision_validator_v1';

const QUEUE_PLACEMENT_STATUSES_OWN = Object.freeze([
  'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION', 'QUEUE_PLACEMENT_VALIDATION_FAILED',
  'QUEUE_PLACEMENT_BLOCKED_BY_INHERITED_DATA', 'QUEUE_PLACEMENT_ORDER_BLOCKED',
  'QUEUE_PLACEMENT_PREDECESSOR_BLOCKED', 'QUEUE_PLACEMENT_GROUP_BLOCKED'
]);

const QUEUE_PLACEMENT_STATUSES = Object.freeze([
  ...QUEUE_PLACEMENT_STATUSES_OWN, 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED',
  'SESSION_BLOCKED', 'AGENT_BLOCKED', 'ACTOR_BLOCKED'
]);

// The spec's own "Precedência obrigatória" pattern -- identity before inherited-data integrity,
// inherited-data before order/predecessor/group, order/predecessor/group before the prepared outcome.
const QUEUE_PLACEMENT_PRECEDENCE_ORDER = Object.freeze([
  'QUEUE_PLACEMENT_VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED',
  'SESSION_BLOCKED', 'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'QUEUE_PLACEMENT_BLOCKED_BY_INHERITED_DATA',
  'QUEUE_PLACEMENT_ORDER_BLOCKED', 'QUEUE_PLACEMENT_PREDECESSOR_BLOCKED', 'QUEUE_PLACEMENT_GROUP_BLOCKED',
  'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION'
]);

const QUEUE_PLACEMENT_DECISIONS = Object.freeze([
  'PREPARE_QUEUE_PLACEMENT_PACKAGE_SIMULATION', 'REQUEST_MATERIALIZATION_REBUILD', 'REQUEST_ORDER_REBUILD',
  'REQUEST_PREDECESSOR_REVIEW', 'REQUEST_GROUP_REVIEW', 'BLOCKED'
]);

const QUEUE_PLACEMENT_NEXT_STATES = Object.freeze([
  'QUEUE_PLACEMENT_PACKAGE_PREPARED_REFERENCE_SIMULATION', 'WAITING_MATERIALIZATION_REBUILD_REFERENCE',
  'WAITING_ORDER_REBUILD_REFERENCE', 'WAITING_PREDECESSOR_REVIEW_REFERENCE', 'WAITING_GROUP_REVIEW_REFERENCE',
  'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

const STATUS_OUTCOME_MAP = Object.freeze({
  QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION: { decision: 'PREPARE_QUEUE_PLACEMENT_PACKAGE_SIMULATION', next_state: 'QUEUE_PLACEMENT_PACKAGE_PREPARED_REFERENCE_SIMULATION' },
  QUEUE_PLACEMENT_BLOCKED_BY_INHERITED_DATA: { decision: 'REQUEST_MATERIALIZATION_REBUILD', next_state: 'WAITING_MATERIALIZATION_REBUILD_REFERENCE' },
  QUEUE_PLACEMENT_ORDER_BLOCKED: { decision: 'REQUEST_ORDER_REBUILD', next_state: 'WAITING_ORDER_REBUILD_REFERENCE' },
  QUEUE_PLACEMENT_PREDECESSOR_BLOCKED: { decision: 'REQUEST_PREDECESSOR_REVIEW', next_state: 'WAITING_PREDECESSOR_REVIEW_REFERENCE' },
  QUEUE_PLACEMENT_GROUP_BLOCKED: { decision: 'REQUEST_GROUP_REVIEW', next_state: 'WAITING_GROUP_REVIEW_REFERENCE' }
});

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'materialization_package_validated', 'identity_validated', 'cardinality_validated',
  'reference_integrity_validated', 'canonical_order_validated', 'predecessor_order_validated',
  'eligibility_validated', 'entries_validated', 'group_validated', 'placement_order_validated',
  'non_execution_invariants_validated'
]);

// The Decision's own, narrower operational-safe surface (Result carries a broader surface -- see
// runtime-queue-placement-result.js). "Mesmo no cenário aprovado" -- every one of these stays
// permanently false regardless of status. Named explicitly against every forbidden capability listed
// in the spec's own prohibition list (queue/item/enqueue/broker/worker/job/dispatch).
const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  queue_placement_applied: false,
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
  'runtime_queue_placement_request_fingerprint', 'runtime_queue_placement_package_fingerprint',
  'runtime_queue_placement_package_digest', 'runtime_queue_materialization_package_fingerprint',
  'runtime_queue_materialization_package_digest'
]);

const RUNTIME_QUEUE_PLACEMENT_DECISION_FIELDS = Object.freeze([
  'runtime_queue_placement_decision_id', 'runtime_queue_placement_request_id',
  'runtime_queue_placement_package_id', 'runtime_queue_materialization_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  ...FINGERPRINT_FIELDS,
  'blockers', 'reason_codes',
  ...VALIDATION_FLAG_FIELDS,
  'queue_placement_evaluated', 'queue_placement_package_prepared_in_simulation',
  ...Object.keys(OPERATIONAL_SAFE_FLAGS),
  'rollout_percentage', 'validator_version'
]);

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeQueuePlacementDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['runtime_queue_placement_decision_must_be_object'] };
  exactFields(decision, RUNTIME_QUEUE_PLACEMENT_DECISION_FIELDS, 'runtime_queue_placement_decision', errors);
  for (const field of [
    'runtime_queue_placement_decision_id', 'runtime_queue_placement_request_id',
    'runtime_queue_placement_package_id', 'runtime_queue_materialization_package_id',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
    ...FINGERPRINT_FIELDS, 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!QUEUE_PLACEMENT_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!QUEUE_PLACEMENT_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!QUEUE_PLACEMENT_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (decision.queue_placement_evaluated !== true) errors.push('queue_placement_evaluated_must_be_true');
  if (typeof decision.queue_placement_package_prepared_in_simulation !== 'boolean') errors.push('queue_placement_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = decision.status === 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION';
  if (decision.queue_placement_package_prepared_in_simulation !== expectedPrepared) errors.push('queue_placement_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== RUNTIME_QUEUE_PLACEMENT_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueuePlacementDecision(input = {}) {
  const status = QUEUE_PLACEMENT_STATUSES.includes(input.status) ? input.status : 'QUEUE_PLACEMENT_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    runtime_queue_placement_decision_id: input.runtime_queue_placement_decision_id,
    runtime_queue_placement_request_id: input.runtime_queue_placement_request_id,
    runtime_queue_placement_package_id: input.runtime_queue_placement_package_id,
    runtime_queue_materialization_package_id: input.runtime_queue_materialization_package_id,
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
    queue_placement_evaluated: true,
    queue_placement_package_prepared_in_simulation: status === 'QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_PLACEMENT_DECISION_VALIDATOR_VERSION
  };
  for (const field of FINGERPRINT_FIELDS) {
    decision[field] = input[field] || 'fingerprint_not_available';
  }
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateRuntimeQueuePlacementDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_queue_placement_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  FINGERPRINT_FIELDS,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  QUEUE_PLACEMENT_DECISIONS,
  QUEUE_PLACEMENT_NEXT_STATES,
  QUEUE_PLACEMENT_PRECEDENCE_ORDER,
  QUEUE_PLACEMENT_STATUSES,
  QUEUE_PLACEMENT_STATUSES_OWN,
  RUNTIME_QUEUE_PLACEMENT_DECISION_FIELDS,
  RUNTIME_QUEUE_PLACEMENT_DECISION_VALIDATOR_VERSION,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildRuntimeQueuePlacementDecision,
  validateRuntimeQueuePlacementDecision
};
