'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const RUNTIME_READINESS_DECISION_VALIDATOR_VERSION = 'runtime_readiness_decision_validator_v1';

// The 28 statuses this PR's own "Readiness Status" list introduces. TENANT_BLOCKED/
// ORGANIZATION_BLOCKED/PROJECT_BLOCKED/SESSION_BLOCKED/AGENT_BLOCKED/ACTOR_BLOCKED are the exact
// same literal strings execution-gateway-decision.js/runtime-execution-simulation-decision.js
// already use -- reused verbatim, not redeclared.
const RUNTIME_READINESS_STATUSES_OWN = Object.freeze([
  'RUNTIME_READY_SIMULATION', 'RUNTIME_READINESS_VALIDATION_FAILED', 'RUNTIME_READINESS_POLICY_BLOCKED',
  'RUNTIME_PACKAGE_BLOCKED', 'RUNTIME_GATEWAY_BLOCKED', 'RUNTIME_EXECUTION_PLAN_BLOCKED',
  'RUNTIME_AUTHORIZATION_BLOCKED', 'RUNTIME_SCOPE_BLOCKED', 'RUNTIME_REGISTRY_BLOCKED',
  'RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED', 'RUNTIME_STAGE_MANIFEST_BLOCKED', 'RUNTIME_DEPENDENCY_BLOCKED',
  'RUNTIME_BINDING_BLOCKED', 'RUNTIME_VALIDATION_LEDGER_BLOCKED', 'RUNTIME_BUDGET_BLOCKED', 'RUNTIME_STOP_BLOCKED',
  'RUNTIME_COMPENSATION_BLOCKED', 'RUNTIME_ARTIFACT_PLAN_BLOCKED', 'RUNTIME_EVENT_PLAN_BLOCKED',
  'RUNTIME_FINGERPRINT_BLOCKED', 'RUNTIME_DIGEST_BLOCKED', 'RUNTIME_FRESHNESS_BLOCKED', 'RUNTIME_REPLAY_BLOCKED',
  'RUNTIME_CAPACITY_BLOCKED', 'RUNTIME_CONCURRENCY_BLOCKED', 'RUNTIME_VERSION_BLOCKED', 'RUNTIME_CONFLICT_BLOCKED',
  'RUNTIME_UNKNOWN_STATUS_BLOCKED'
]);

const RUNTIME_READINESS_STATUSES = Object.freeze([
  ...RUNTIME_READINESS_STATUSES_OWN, 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED',
  'SESSION_BLOCKED', 'AGENT_BLOCKED', 'ACTOR_BLOCKED'
]);

// The spec's own "Precedência da Readiness" -- 34 statuses, real evaluation order.
const RUNTIME_READINESS_PRECEDENCE_ORDER = Object.freeze([
  'RUNTIME_READINESS_VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED',
  'SESSION_BLOCKED', 'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'RUNTIME_READINESS_POLICY_BLOCKED', 'RUNTIME_PACKAGE_BLOCKED',
  'RUNTIME_GATEWAY_BLOCKED', 'RUNTIME_EXECUTION_PLAN_BLOCKED', 'RUNTIME_AUTHORIZATION_BLOCKED',
  'RUNTIME_SCOPE_BLOCKED', 'RUNTIME_REGISTRY_BLOCKED', 'RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED',
  'RUNTIME_STAGE_MANIFEST_BLOCKED', 'RUNTIME_DEPENDENCY_BLOCKED', 'RUNTIME_BINDING_BLOCKED',
  'RUNTIME_VALIDATION_LEDGER_BLOCKED', 'RUNTIME_BUDGET_BLOCKED', 'RUNTIME_STOP_BLOCKED',
  'RUNTIME_COMPENSATION_BLOCKED', 'RUNTIME_ARTIFACT_PLAN_BLOCKED', 'RUNTIME_EVENT_PLAN_BLOCKED',
  'RUNTIME_FINGERPRINT_BLOCKED', 'RUNTIME_DIGEST_BLOCKED', 'RUNTIME_FRESHNESS_BLOCKED', 'RUNTIME_REPLAY_BLOCKED',
  'RUNTIME_CAPACITY_BLOCKED', 'RUNTIME_CONCURRENCY_BLOCKED', 'RUNTIME_VERSION_BLOCKED', 'RUNTIME_CONFLICT_BLOCKED',
  'RUNTIME_UNKNOWN_STATUS_BLOCKED', 'RUNTIME_READY_SIMULATION'
]);

const RUNTIME_READINESS_DECISIONS = Object.freeze([
  'MARK_RUNTIME_READY_SIMULATION', 'REQUEST_RUNTIME_PACKAGE_REBUILD', 'REQUEST_GATEWAY_REFRESH',
  'REQUEST_PLAN_REFRESH', 'REQUEST_AUTHORIZATION_REFRESH', 'REQUEST_SCOPE_REFRESH', 'REQUEST_REGISTRY_REFRESH',
  'REQUEST_ARCHITECTURE_EVIDENCE_REFRESH', 'REQUEST_BINDING_REBUILD', 'REQUEST_VALIDATION_REBUILD',
  'REQUEST_BUDGET_REBUILD', 'REQUEST_STOP_REBUILD', 'REQUEST_COMPENSATION_REBUILD', 'REQUEST_CAPACITY_REFRESH',
  'REQUEST_CONCURRENCY_REVIEW', 'REQUEST_FRESHNESS_REFRESH', 'REQUEST_REPLAY_REVIEW', 'BLOCKED'
]);

const RUNTIME_READINESS_NEXT_STATES = Object.freeze([
  'RUNTIME_READY_REFERENCE_SIMULATION', 'WAITING_RUNTIME_PACKAGE_REBUILD_REFERENCE',
  'WAITING_GATEWAY_REFRESH_REFERENCE', 'WAITING_PLAN_REFRESH_REFERENCE', 'WAITING_AUTHORIZATION_REFRESH_REFERENCE',
  'WAITING_SCOPE_REFRESH_REFERENCE', 'WAITING_REGISTRY_REFRESH_REFERENCE',
  'WAITING_ARCHITECTURE_EVIDENCE_REFRESH_REFERENCE', 'WAITING_BINDING_REBUILD_REFERENCE',
  'WAITING_VALIDATION_REBUILD_REFERENCE', 'WAITING_BUDGET_REBUILD_REFERENCE', 'WAITING_STOP_REBUILD_REFERENCE',
  'WAITING_COMPENSATION_REBUILD_REFERENCE', 'WAITING_CAPACITY_REFRESH_REFERENCE',
  'WAITING_CONCURRENCY_REVIEW_REFERENCE', 'WAITING_FRESHNESS_REFRESH_REFERENCE', 'WAITING_REPLAY_REVIEW_REFERENCE',
  'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

// Statuses with no dedicated REQUEST_*_REFRESH/REBUILD name -- the spec's own "Readiness Decision"
// vocabulary (18 entries) simply does not list one for RUNTIME_READINESS_VALIDATION_FAILED/
// RUNTIME_READINESS_POLICY_BLOCKED/RUNTIME_STAGE_MANIFEST_BLOCKED/RUNTIME_DEPENDENCY_BLOCKED/
// RUNTIME_ARTIFACT_PLAN_BLOCKED/RUNTIME_EVENT_PLAN_BLOCKED/RUNTIME_FINGERPRINT_BLOCKED/
// RUNTIME_DIGEST_BLOCKED/RUNTIME_VERSION_BLOCKED/RUNTIME_CONFLICT_BLOCKED/
// RUNTIME_UNKNOWN_STATUS_BLOCKED or the 6 reused identity statuses -- each falls to DEFAULT_OUTCOME,
// the same choice runtime-execution-simulation-decision.js's own STATUS_OUTCOME_MAP already made for
// its own analogous gap.
const STATUS_OUTCOME_MAP = Object.freeze({
  RUNTIME_READY_SIMULATION: { decision: 'MARK_RUNTIME_READY_SIMULATION', next_state: 'RUNTIME_READY_REFERENCE_SIMULATION' },
  RUNTIME_PACKAGE_BLOCKED: { decision: 'REQUEST_RUNTIME_PACKAGE_REBUILD', next_state: 'WAITING_RUNTIME_PACKAGE_REBUILD_REFERENCE' },
  RUNTIME_GATEWAY_BLOCKED: { decision: 'REQUEST_GATEWAY_REFRESH', next_state: 'WAITING_GATEWAY_REFRESH_REFERENCE' },
  RUNTIME_EXECUTION_PLAN_BLOCKED: { decision: 'REQUEST_PLAN_REFRESH', next_state: 'WAITING_PLAN_REFRESH_REFERENCE' },
  RUNTIME_AUTHORIZATION_BLOCKED: { decision: 'REQUEST_AUTHORIZATION_REFRESH', next_state: 'WAITING_AUTHORIZATION_REFRESH_REFERENCE' },
  RUNTIME_SCOPE_BLOCKED: { decision: 'REQUEST_SCOPE_REFRESH', next_state: 'WAITING_SCOPE_REFRESH_REFERENCE' },
  RUNTIME_REGISTRY_BLOCKED: { decision: 'REQUEST_REGISTRY_REFRESH', next_state: 'WAITING_REGISTRY_REFRESH_REFERENCE' },
  RUNTIME_ARCHITECTURE_EVIDENCE_BLOCKED: { decision: 'REQUEST_ARCHITECTURE_EVIDENCE_REFRESH', next_state: 'WAITING_ARCHITECTURE_EVIDENCE_REFRESH_REFERENCE' },
  RUNTIME_BINDING_BLOCKED: { decision: 'REQUEST_BINDING_REBUILD', next_state: 'WAITING_BINDING_REBUILD_REFERENCE' },
  RUNTIME_VALIDATION_LEDGER_BLOCKED: { decision: 'REQUEST_VALIDATION_REBUILD', next_state: 'WAITING_VALIDATION_REBUILD_REFERENCE' },
  RUNTIME_BUDGET_BLOCKED: { decision: 'REQUEST_BUDGET_REBUILD', next_state: 'WAITING_BUDGET_REBUILD_REFERENCE' },
  RUNTIME_STOP_BLOCKED: { decision: 'REQUEST_STOP_REBUILD', next_state: 'WAITING_STOP_REBUILD_REFERENCE' },
  RUNTIME_COMPENSATION_BLOCKED: { decision: 'REQUEST_COMPENSATION_REBUILD', next_state: 'WAITING_COMPENSATION_REBUILD_REFERENCE' },
  RUNTIME_CAPACITY_BLOCKED: { decision: 'REQUEST_CAPACITY_REFRESH', next_state: 'WAITING_CAPACITY_REFRESH_REFERENCE' },
  RUNTIME_CONCURRENCY_BLOCKED: { decision: 'REQUEST_CONCURRENCY_REVIEW', next_state: 'WAITING_CONCURRENCY_REVIEW_REFERENCE' },
  RUNTIME_FRESHNESS_BLOCKED: { decision: 'REQUEST_FRESHNESS_REFRESH', next_state: 'WAITING_FRESHNESS_REFRESH_REFERENCE' },
  RUNTIME_REPLAY_BLOCKED: { decision: 'REQUEST_REPLAY_REVIEW', next_state: 'WAITING_REPLAY_REVIEW_REFERENCE' }
});

const RUNTIME_READINESS_DECISION_FIELDS = Object.freeze([
  'runtime_readiness_decision_id', 'runtime_readiness_request_id', 'runtime_execution_package_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
  'status', 'decision', 'next_state',
  'runtime_readiness_request_fingerprint', 'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
  'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint', 'runtime_freshness_fingerprint',
  'runtime_replay_fingerprint',
  'blockers', 'reason_codes',
  'request_validated', 'policy_validated', 'runtime_package_validated', 'gateway_validated',
  'execution_plan_validated', 'authorization_validated', 'authorization_scope_validated',
  'registry_snapshot_validated', 'architecture_gate_evidence_validated', 'stage_manifest_validated',
  'dependency_manifest_validated', 'binding_ledger_validated', 'validation_ledger_validated', 'budget_validated',
  'stops_validated', 'compensations_validated', 'artifact_plan_validated', 'event_plan_validated',
  'package_fingerprint_validated', 'package_digest_validated', 'freshness_validated', 'replay_validated',
  'capacity_validated', 'concurrency_validated', 'non_execution_invariants_validated',
  'runtime_readiness_evaluated', 'runtime_ready_in_simulation',
  'runtime_enabled', 'execution_authorized', 'execution_started', 'stage_started', 'stage_completed',
  'job_created', 'queue_used', 'worker_started', 'scheduler_started', 'executed',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'policy_validated', 'runtime_package_validated', 'gateway_validated',
  'execution_plan_validated', 'authorization_validated', 'authorization_scope_validated',
  'registry_snapshot_validated', 'architecture_gate_evidence_validated', 'stage_manifest_validated',
  'dependency_manifest_validated', 'binding_ledger_validated', 'validation_ledger_validated', 'budget_validated',
  'stops_validated', 'compensations_validated', 'artifact_plan_validated', 'event_plan_validated',
  'package_fingerprint_validated', 'package_digest_validated', 'freshness_validated', 'replay_validated',
  'capacity_validated', 'concurrency_validated', 'non_execution_invariants_validated'
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

function validateRuntimeReadinessDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['runtime_readiness_decision_must_be_object'] };
  exactFields(decision, RUNTIME_READINESS_DECISION_FIELDS, 'runtime_readiness_decision', errors);
  for (const field of [
    'runtime_readiness_decision_id', 'runtime_readiness_request_id', 'runtime_execution_package_id', 'tenant_id',
    'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
    'runtime_readiness_request_fingerprint', 'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
    'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint', 'runtime_freshness_fingerprint',
    'runtime_replay_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_READINESS_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!RUNTIME_READINESS_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!RUNTIME_READINESS_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof decision.runtime_readiness_evaluated !== 'boolean') errors.push('runtime_readiness_evaluated_must_be_boolean');
  if (decision.runtime_readiness_evaluated !== true) errors.push('runtime_readiness_evaluated_must_be_true');
  if (typeof decision.runtime_ready_in_simulation !== 'boolean') errors.push('runtime_ready_in_simulation_must_be_boolean');
  const expectedReady = decision.status === 'RUNTIME_READY_SIMULATION';
  if (decision.runtime_ready_in_simulation !== expectedReady) errors.push('runtime_ready_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== RUNTIME_READINESS_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeReadinessDecision(input = {}) {
  const status = RUNTIME_READINESS_STATUSES.includes(input.status) ? input.status : 'RUNTIME_READINESS_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    runtime_readiness_decision_id: input.runtime_readiness_decision_id,
    runtime_readiness_request_id: input.runtime_readiness_request_id,
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
    runtime_readiness_request_fingerprint: input.runtime_readiness_request_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_fingerprint: input.runtime_execution_package_fingerprint || 'fingerprint_not_available',
    runtime_execution_package_digest: input.runtime_execution_package_digest || 'digest_not_available',
    runtime_capacity_snapshot_fingerprint: input.runtime_capacity_snapshot_fingerprint || 'fingerprint_not_available',
    runtime_concurrency_fingerprint: input.runtime_concurrency_fingerprint || 'fingerprint_not_available',
    runtime_freshness_fingerprint: input.runtime_freshness_fingerprint || 'fingerprint_not_available',
    runtime_replay_fingerprint: input.runtime_replay_fingerprint || 'fingerprint_not_available',
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    runtime_readiness_evaluated: true,
    runtime_ready_in_simulation: status === 'RUNTIME_READY_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_READINESS_DECISION_VALIDATOR_VERSION
  };
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateRuntimeReadinessDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_readiness_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  RUNTIME_READINESS_DECISIONS,
  RUNTIME_READINESS_DECISION_FIELDS,
  RUNTIME_READINESS_DECISION_VALIDATOR_VERSION,
  RUNTIME_READINESS_NEXT_STATES,
  RUNTIME_READINESS_PRECEDENCE_ORDER,
  RUNTIME_READINESS_STATUSES,
  RUNTIME_READINESS_STATUSES_OWN,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildRuntimeReadinessDecision,
  validateRuntimeReadinessDecision
};
