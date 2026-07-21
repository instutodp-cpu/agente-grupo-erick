'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { SESSION_STATUSES } = require('./agent-session-contract');

const AGENT_SESSION_STATE_VALIDATOR_VERSION = 'agent_session_state_validator_v1';
const AGENT_SESSION_STATE_FIELDS = Object.freeze([
  'state_id', 'session_id', 'session_version', 'current_status', 'previous_status', 'state_sequence',
  'state_fingerprint', 'state_valid', 'state_mutated', 'runtime_connected', 'history_loaded', 'memory_loaded',
  'agent_executed', 'validator_version'
]);
const AGENT_SESSION_STATE_SAFE_FLAGS = Object.freeze({
  state_mutated: false,
  runtime_connected: false,
  history_loaded: false,
  memory_loaded: false,
  agent_executed: false
});

function validateAgentSessionState(state) {
  const errors = [];
  if (!isPlainObject(state)) return { valid: false, errors: ['agent_session_state_must_be_object'] };
  exactFields(state, AGENT_SESSION_STATE_FIELDS, 'agent_session_state', errors);
  for (const field of ['state_id', 'session_id', 'state_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(state[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(state.session_version) || state.session_version < 1) errors.push('session_version_invalid');
  if (!Number.isInteger(state.state_sequence) || state.state_sequence < 0) errors.push('state_sequence_invalid');
  if (!SESSION_STATUSES.includes(state.current_status)) errors.push(`current_status_not_allowed::${state.current_status}`);
  if (!SESSION_STATUSES.includes(state.previous_status)) errors.push(`previous_status_not_allowed::${state.previous_status}`);
  if (typeof state.state_valid !== 'boolean') errors.push('state_valid_must_be_boolean');
  for (const [field, expected] of Object.entries(AGENT_SESSION_STATE_SAFE_FLAGS)) {
    if (state[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (state.validator_version !== AGENT_SESSION_STATE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(state);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(state));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_SESSION_STATE_FIELDS,
  AGENT_SESSION_STATE_SAFE_FLAGS,
  AGENT_SESSION_STATE_VALIDATOR_VERSION,
  validateAgentSessionState
};
