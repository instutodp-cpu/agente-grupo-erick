'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ACTOR_ROLES } = require('./agent-context-contract');

const EXECUTION_AUTHORIZATION_DECISION_VALIDATOR_VERSION = 'execution_authorization_decision_validator_v1';

const AUTHORIZATION_DECISION_FIELDS = Object.freeze([
  'authorization_decision_id', 'authorization_request_id', 'decision_result_id', 'readiness_bundle_id',
  'planning_result_id', 'plan_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id',
  'session_reference_id', 'status', 'decision', 'next_state', 'actor_id', 'actor_role',
  'authorization_scope_id', 'approval_reference_id', 'budget_authorization_id', 'expiration_evaluation_id',
  'request_fingerprint', 'orchestrator_decision_fingerprint', 'readiness_bundle_fingerprint', 'plan_fingerprint',
  'scope_fingerprint', 'actor_fingerprint', 'approval_fingerprint', 'budget_fingerprint', 'expiration_fingerprint',
  'registry_version', 'blockers', 'reason_codes', 'request_validated', 'orchestrator_decision_validated',
  'evidence_bundle_validated', 'bindings_validated', 'versions_validated', 'fingerprints_validated',
  'actor_validated', 'role_validated', 'scope_validated', 'risk_validated', 'approval_validated', 'budget_validated',
  'expiration_validated', 'authorization_evaluated', 'authorized_in_simulation', 'execution_authorized',
  'execution_started', 'agent_executed', 'tool_called', 'workflow_executed', 'provider_called', 'model_called',
  'network_used', 'memory_read', 'memory_written', 'tokens_consumed', 'cost_consumed', 'runtime_enabled',
  'executed', 'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const AUTHORIZATION_STATUSES = Object.freeze([
  'AUTHORIZED_SIMULATION', 'WAITING_APPROVAL_SIMULATION', 'DENY', 'VALIDATION_FAILED', 'TENANT_BLOCKED',
  'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED', 'PLAN_BLOCKED', 'ACTOR_BLOCKED', 'ROLE_BLOCKED',
  'SCOPE_BLOCKED', 'RISK_BLOCKED', 'APPROVAL_BLOCKED', 'BUDGET_BLOCKED', 'EXPIRED_AUTHORIZATION',
  'MISSING_EVIDENCE_BLOCKED', 'FINGERPRINT_BLOCKED', 'VERSION_BLOCKED', 'CONFLICT_BLOCKED', 'UNKNOWN_STATUS_BLOCKED'
]);

const AUTHORIZATION_DECISIONS = Object.freeze([
  'AUTHORIZE_EXECUTION_REFERENCE_SIMULATION', 'REQUEST_APPROVAL_REFERENCE', 'REQUEST_SCOPE_REVIEW',
  'REQUEST_RISK_REVIEW', 'REQUEST_BUDGET_REVIEW', 'REQUEST_AUTHORIZATION_REFRESH', 'BLOCKED'
]);

const AUTHORIZATION_NEXT_STATES = Object.freeze([
  'EXECUTION_REFERENCE_AUTHORIZED_SIMULATION', 'WAITING_APPROVAL_REFERENCE', 'WAITING_SCOPE_REVIEW_REFERENCE',
  'WAITING_RISK_REVIEW_REFERENCE', 'WAITING_BUDGET_REVIEW_REFERENCE', 'WAITING_AUTHORIZATION_REFRESH_REFERENCE',
  'BLOCKED_REFERENCE'
]);

// Single source of truth for status -> decision -> next_state, exactly mirroring the pattern
// PR #95's orchestrator-decision-result.js established. Every WAITING_*/BLOCKED status maps to
// exactly one decision and one next_state; there is no branching left to the caller.
const STATUS_OUTCOME_MAP = Object.freeze({
  AUTHORIZED_SIMULATION: { decision: 'AUTHORIZE_EXECUTION_REFERENCE_SIMULATION', next_state: 'EXECUTION_REFERENCE_AUTHORIZED_SIMULATION' },
  WAITING_APPROVAL_SIMULATION: { decision: 'REQUEST_APPROVAL_REFERENCE', next_state: 'WAITING_APPROVAL_REFERENCE' },
  SCOPE_BLOCKED: { decision: 'REQUEST_SCOPE_REVIEW', next_state: 'WAITING_SCOPE_REVIEW_REFERENCE' },
  RISK_BLOCKED: { decision: 'REQUEST_RISK_REVIEW', next_state: 'WAITING_RISK_REVIEW_REFERENCE' },
  BUDGET_BLOCKED: { decision: 'REQUEST_BUDGET_REVIEW', next_state: 'WAITING_BUDGET_REVIEW_REFERENCE' },
  EXPIRED_AUTHORIZATION: { decision: 'REQUEST_AUTHORIZATION_REFRESH', next_state: 'WAITING_AUTHORIZATION_REFRESH_REFERENCE' }
});
const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'orchestrator_decision_validated', 'evidence_bundle_validated', 'bindings_validated',
  'versions_validated', 'fingerprints_validated', 'actor_validated', 'role_validated', 'scope_validated',
  'risk_validated', 'approval_validated', 'budget_validated', 'expiration_validated'
]);

// Even AUTHORIZED_SIMULATION never touches anything operational -- these stay false/0 on every
// single decision this module can ever build.
const AUTHORIZATION_DECISION_SAFE_FLAGS = Object.freeze({
  execution_authorized: false,
  execution_started: false,
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
  runtime_enabled: false,
  executed: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedReasonCodeList(list, maxItems) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  return list.every(isNonEmptyString);
}

function validateExecutionAuthorizationDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['execution_authorization_decision_must_be_object'] };
  exactFields(decision, AUTHORIZATION_DECISION_FIELDS, 'execution_authorization_decision', errors);
  for (const field of [
    'authorization_decision_id', 'authorization_request_id', 'decision_result_id', 'readiness_bundle_id',
    'planning_result_id', 'plan_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'actor_id', 'authorization_scope_id', 'approval_reference_id', 'budget_authorization_id',
    'expiration_evaluation_id', 'request_fingerprint', 'orchestrator_decision_fingerprint',
    'readiness_bundle_fingerprint', 'plan_fingerprint', 'scope_fingerprint', 'actor_fingerprint',
    'approval_fingerprint', 'budget_fingerprint', 'expiration_fingerprint', 'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!AUTHORIZATION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (!AUTHORIZATION_DECISIONS.includes(decision.decision)) errors.push(`decision_not_allowed::${decision.decision}`);
  if (!AUTHORIZATION_NEXT_STATES.includes(decision.next_state)) errors.push(`next_state_not_allowed::${decision.next_state}`);
  if (!ACTOR_ROLES.includes(decision.actor_role)) errors.push(`actor_role_not_allowed::${decision.actor_role}`);
  if (!isSanitizedReasonCodeList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedReasonCodeList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');
  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof decision.authorization_evaluated !== 'boolean') errors.push('authorization_evaluated_must_be_boolean');
  if (typeof decision.authorized_in_simulation !== 'boolean') errors.push('authorized_in_simulation_must_be_boolean');
  for (const [field, expected] of Object.entries(AUTHORIZATION_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (decision.authorization_evaluated !== true) errors.push('authorization_evaluated_must_be_true');
  if (decision.status === 'AUTHORIZED_SIMULATION' && decision.authorized_in_simulation !== true) {
    errors.push('authorized_in_simulation_must_be_true_when_status_is_authorized_simulation');
  }
  if (decision.status !== 'AUTHORIZED_SIMULATION' && decision.authorized_in_simulation !== false) {
    errors.push('authorized_in_simulation_must_be_false_when_status_is_not_authorized_simulation');
  }
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push(`decision_inconsistent_with_status::${decision.status}`);
  if (decision.next_state !== expectedOutcome.next_state) errors.push(`next_state_inconsistent_with_status::${decision.status}`);

  if (decision.validator_version !== EXECUTION_AUTHORIZATION_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionAuthorizationDecision(input = {}) {
  const status = AUTHORIZATION_STATUSES.includes(input.status) ? input.status : 'VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    authorization_decision_id: input.authorization_decision_id || 'authorization_decision_not_available',
    authorization_request_id: input.authorization_request_id || 'authorization_request_not_available',
    decision_result_id: input.decision_result_id || 'decision_result_not_available',
    readiness_bundle_id: input.readiness_bundle_id || 'readiness_bundle_not_available',
    planning_result_id: input.planning_result_id || 'planning_result_not_available',
    plan_id: input.plan_id || 'plan_not_available',
    agent_id: input.agent_id || 'agent_not_available',
    tenant_id: input.tenant_id || 'tenant_not_available',
    organization_id: input.organization_id || 'organization_not_available',
    project_id: input.project_id || 'project_not_available',
    session_reference_id: input.session_reference_id || 'session_not_available',
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    actor_id: input.actor_id || 'actor_not_available',
    actor_role: ACTOR_ROLES.includes(input.actor_role) ? input.actor_role : 'COLLABORATOR',
    authorization_scope_id: input.authorization_scope_id || 'authorization_scope_not_available',
    approval_reference_id: input.approval_reference_id || 'approval_reference_not_available',
    budget_authorization_id: input.budget_authorization_id || 'budget_authorization_not_available',
    expiration_evaluation_id: input.expiration_evaluation_id || 'expiration_evaluation_not_available',
    request_fingerprint: input.request_fingerprint || 'fingerprint_not_available',
    orchestrator_decision_fingerprint: input.orchestrator_decision_fingerprint || 'fingerprint_not_available',
    readiness_bundle_fingerprint: input.readiness_bundle_fingerprint || 'fingerprint_not_available',
    plan_fingerprint: input.plan_fingerprint || 'fingerprint_not_available',
    scope_fingerprint: input.scope_fingerprint || 'fingerprint_not_available',
    actor_fingerprint: input.actor_fingerprint || 'fingerprint_not_available',
    approval_fingerprint: input.approval_fingerprint || 'fingerprint_not_available',
    budget_fingerprint: input.budget_fingerprint || 'fingerprint_not_available',
    expiration_fingerprint: input.expiration_fingerprint || 'fingerprint_not_available',
    registry_version: input.registry_version || 'registry_version_not_available',
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    request_validated: input.request_validated === true,
    orchestrator_decision_validated: input.orchestrator_decision_validated === true,
    evidence_bundle_validated: input.evidence_bundle_validated === true,
    bindings_validated: input.bindings_validated === true,
    versions_validated: input.versions_validated === true,
    fingerprints_validated: input.fingerprints_validated === true,
    actor_validated: input.actor_validated === true,
    role_validated: input.role_validated === true,
    scope_validated: input.scope_validated === true,
    risk_validated: input.risk_validated === true,
    approval_validated: input.approval_validated === true,
    budget_validated: input.budget_validated === true,
    expiration_validated: input.expiration_validated === true,
    authorization_evaluated: true,
    authorized_in_simulation: status === 'AUTHORIZED_SIMULATION',
    ...AUTHORIZATION_DECISION_SAFE_FLAGS,
    validator_version: EXECUTION_AUTHORIZATION_DECISION_VALIDATOR_VERSION
  };

  const validation = validateExecutionAuthorizationDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      next_state: 'BLOCKED_REFERENCE',
      authorized_in_simulation: false
    });
  }
  return cloneFrozen(decision);
}

module.exports = {
  AUTHORIZATION_DECISIONS,
  AUTHORIZATION_DECISION_FIELDS,
  AUTHORIZATION_DECISION_SAFE_FLAGS,
  AUTHORIZATION_NEXT_STATES,
  AUTHORIZATION_STATUSES,
  DEFAULT_OUTCOME,
  EXECUTION_AUTHORIZATION_DECISION_VALIDATOR_VERSION,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildExecutionAuthorizationDecision,
  validateExecutionAuthorizationDecision
};
