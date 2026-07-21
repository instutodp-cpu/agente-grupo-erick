'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { SESSION_STATUSES } = require('./agent-session-contract');
const { TRANSITION_TYPES } = require('./agent-session-transition');

const AGENT_SESSION_DECISION_VALIDATOR_VERSION = 'agent_session_decision_validator_v1';
const AGENT_SESSION_DECISION_FIELDS = Object.freeze([
  'decision_id', 'session_request_id', 'session_id', 'agent_id', 'tenant_id', 'organization_id', 'status',
  'decision', 'allowed_in_simulation', 'requested_transition', 'transition_allowed', 'transition_applied',
  'current_status', 'proposed_status', 'session_fingerprint', 'request_fingerprint', 'state_fingerprint',
  'transition_fingerprint', 'policy_decision_fingerprint', 'expiration_fingerprint', 'registry_version',
  'blockers', 'reason_codes', 'session_validated', 'policy_validated', 'scope_validated', 'expiration_evaluated',
  'session_created', 'session_loaded', 'session_mutated', 'history_loaded', 'history_mutated', 'memory_read',
  'memory_written', 'agent_executed', 'llm_called', 'tool_called', 'network_used', 'runtime_connected',
  'executed', 'runtime_enabled', 'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);
const SESSION_DECISION_STATUSES = Object.freeze([
  'ALLOW_SIMULATION', 'DENY', 'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'AGENT_BLOCKED',
  'ACTOR_BLOCKED', 'ROLE_BLOCKED', 'CHANNEL_BLOCKED', 'POLICY_BLOCKED', 'APPROVAL_BLOCKED', 'SCOPE_BLOCKED',
  'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'TRANSITION_BLOCKED', 'EXPIRATION_BLOCKED', 'CONFLICT_BLOCKED'
]);
const SESSION_DECISION_VALUES = Object.freeze([
  'CREATE_REFERENCE_ALLOWED', 'VALIDATE_REFERENCE_ALLOWED', 'TRANSITION_REFERENCE_ALLOWED', 'READ_REFERENCE_ALLOWED',
  'LIST_REFERENCES_ALLOWED', 'EXPIRATION_REFERENCE_EVALUATED', 'CLOSE_REFERENCE_ALLOWED', 'ARCHIVE_REFERENCE_ALLOWED', 'BLOCKED'
]);
const AGENT_SESSION_DECISION_SAFE_FLAGS = Object.freeze({
  session_created: false,
  session_loaded: false,
  session_mutated: false,
  history_loaded: false,
  history_mutated: false,
  memory_read: false,
  memory_written: false,
  agent_executed: false,
  llm_called: false,
  tool_called: false,
  network_used: false,
  runtime_connected: false,
  executed: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});

function validateAgentSessionDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['agent_session_decision_must_be_object'] };
  exactFields(decision, AGENT_SESSION_DECISION_FIELDS, 'agent_session_decision', errors);
  for (const field of ['decision_id', 'session_request_id', 'session_id', 'agent_id', 'tenant_id', 'organization_id', 'session_fingerprint', 'request_fingerprint', 'state_fingerprint', 'transition_fingerprint', 'policy_decision_fingerprint', 'expiration_fingerprint', 'registry_version', 'validator_version']) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!SESSION_DECISION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (!SESSION_DECISION_VALUES.includes(decision.decision)) errors.push(`decision_not_allowed::${decision.decision}`);
  if (!TRANSITION_TYPES.includes(decision.requested_transition)) errors.push(`requested_transition_not_allowed::${decision.requested_transition}`);
  if (!SESSION_STATUSES.includes(decision.current_status)) errors.push(`current_status_not_allowed::${decision.current_status}`);
  if (!SESSION_STATUSES.includes(decision.proposed_status)) errors.push(`proposed_status_not_allowed::${decision.proposed_status}`);
  for (const field of ['allowed_in_simulation', 'transition_allowed', 'session_validated', 'policy_validated', 'scope_validated', 'expiration_evaluated']) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!Array.isArray(decision.blockers) || !decision.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  if (!Array.isArray(decision.reason_codes) || !decision.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (decision.transition_applied !== false) errors.push('transition_applied_must_be_false');
  for (const [field, expected] of Object.entries(AGENT_SESSION_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.allowed_in_simulation === true && decision.status !== 'ALLOW_SIMULATION') {
    errors.push('allowed_in_simulation_inconsistent_with_status');
  }
  if (decision.validator_version !== AGENT_SESSION_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAgentSessionDecision(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const decision = {
    decision_id: overrides.decision_id || `agent_session_decision_${overrides.session_request_id || 'missing'}`,
    session_request_id: overrides.session_request_id || 'session_request_not_available',
    session_id: overrides.session_id || 'session_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    organization_id: overrides.organization_id || 'organization_not_available',
    status,
    decision: SESSION_DECISION_VALUES.includes(overrides.decision) ? overrides.decision : 'BLOCKED',
    allowed_in_simulation: status === 'ALLOW_SIMULATION' && overrides.allowed_in_simulation === true,
    requested_transition: TRANSITION_TYPES.includes(overrides.requested_transition) ? overrides.requested_transition : 'CREATE',
    transition_allowed: overrides.transition_allowed === true,
    transition_applied: false,
    current_status: SESSION_STATUSES.includes(overrides.current_status) ? overrides.current_status : 'DRAFT',
    proposed_status: SESSION_STATUSES.includes(overrides.proposed_status) ? overrides.proposed_status : 'DRAFT',
    session_fingerprint: overrides.session_fingerprint || 'session_fingerprint_not_available',
    request_fingerprint: overrides.request_fingerprint || 'request_fingerprint_not_available',
    state_fingerprint: overrides.state_fingerprint || 'state_fingerprint_not_available',
    transition_fingerprint: overrides.transition_fingerprint || 'transition_fingerprint_not_available',
    policy_decision_fingerprint: overrides.policy_decision_fingerprint || 'policy_decision_fingerprint_not_available',
    expiration_fingerprint: overrides.expiration_fingerprint || 'expiration_fingerprint_not_available',
    registry_version: overrides.registry_version || 'registry_version_not_available',
    blockers: Array.isArray(overrides.blockers) ? uniqueSorted(overrides.blockers) : [],
    reason_codes: Array.isArray(overrides.reason_codes) ? uniqueSorted(overrides.reason_codes) : [],
    session_validated: overrides.session_validated === true,
    policy_validated: overrides.policy_validated === true,
    scope_validated: overrides.scope_validated === true,
    expiration_evaluated: overrides.expiration_evaluated === true,
    validator_version: AGENT_SESSION_DECISION_VALIDATOR_VERSION,
    ...AGENT_SESSION_DECISION_SAFE_FLAGS
  };
  const validation = validateAgentSessionDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      allowed_in_simulation: false,
      transition_allowed: false,
      session_validated: false,
      policy_validated: false,
      scope_validated: false,
      blockers: uniqueSorted([...(decision.blockers || []), ...validation.errors]),
      reason_codes: uniqueSorted([...(decision.reason_codes || []), validation.errors[0] || 'agent_session_decision_invalid']),
      ...AGENT_SESSION_DECISION_SAFE_FLAGS
    });
  }
  return cloneFrozen(decision);
}

module.exports = {
  AGENT_SESSION_DECISION_FIELDS,
  AGENT_SESSION_DECISION_SAFE_FLAGS,
  AGENT_SESSION_DECISION_VALIDATOR_VERSION,
  SESSION_DECISION_STATUSES,
  SESSION_DECISION_VALUES,
  buildAgentSessionDecision,
  validateAgentSessionDecision
};
