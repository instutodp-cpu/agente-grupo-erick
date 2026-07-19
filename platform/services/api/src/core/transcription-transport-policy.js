'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { safeTransportResult } = require('./transcription-transport-contract');

const TRANSPORT_BLOCKED_ACTIONS = Object.freeze([
  'open_socket',
  'open_connection',
  'resolve_dns',
  'create_client',
  'create_session',
  'create_channel'
]);

function validateTranscriptionTransportPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['transport_policy_must_be_object'] };
  for (const action of TRANSPORT_BLOCKED_ACTIONS) {
    const field = `${action}_blocked`;
    if (policy[field] !== true) errors.push(`${field}_must_be_true`);
  }
  if (policy.retry_real === true) errors.push('retry_real_must_be_absent_or_false');
  if (policy.transport_simulated !== true) errors.push('transport_simulated_must_be_true');
  if (policy.network !== false) errors.push('network_must_be_false');
  if (policy.connected !== false) errors.push('connected_must_be_false');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateTranscriptionTransportPolicyAttempt(action, policy) {
  const validation = validateTranscriptionTransportPolicy(policy);
  const errors = [...validation.errors];
  if (!TRANSPORT_BLOCKED_ACTIONS.includes(action)) errors.push(`transport_action_not_allowed::${action}`);
  if (TRANSPORT_BLOCKED_ACTIONS.includes(action)) errors.push(`transport_action_blocked::${action}`);
  return safeTransportResult({
    policy_status: 'transport_policy_blocked',
    allowed: false,
    action,
    blockers: uniqueSorted(errors)
  });
}

module.exports = {
  TRANSPORT_BLOCKED_ACTIONS,
  evaluateTranscriptionTransportPolicyAttempt,
  validateTranscriptionTransportPolicy
};
