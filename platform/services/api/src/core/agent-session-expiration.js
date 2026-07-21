'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const AGENT_SESSION_EXPIRATION_VALIDATOR_VERSION = 'agent_session_expiration_validator_v1';
const AGENT_SESSION_EXPIRATION_FIELDS = Object.freeze([
  'expiration_policy_id', 'expiration_type', 'created_sequence', 'last_activity_sequence', 'current_sequence',
  'maximum_inactive_sequences', 'maximum_total_sequences', 'expiration_applicable', 'expired_logically',
  'expiration_reason', 'expiration_evaluated', 'timer_created', 'clock_accessed', 'session_mutated',
  'simulation', 'production_blocked', 'validator_version'
]);
const EXPIRATION_TYPES = Object.freeze(['NONE', 'INACTIVITY_SEQUENCE', 'TOTAL_SEQUENCE', 'EARLIEST_SEQUENCE_LIMIT']);
const AGENT_SESSION_EXPIRATION_SAFE_FLAGS = Object.freeze({
  expiration_evaluated: true,
  timer_created: false,
  clock_accessed: false,
  session_mutated: false,
  simulation: true,
  production_blocked: true
});

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateAgentSessionExpiration(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['agent_session_expiration_must_be_object'] };
  exactFields(record, AGENT_SESSION_EXPIRATION_FIELDS, 'agent_session_expiration', errors);
  for (const field of ['expiration_policy_id', 'expiration_reason', 'validator_version']) {
    if (!isNonEmptyString(record[field])) errors.push(`${field}_invalid`);
  }
  if (!EXPIRATION_TYPES.includes(record.expiration_type)) errors.push(`expiration_type_not_allowed::${record.expiration_type}`);
  for (const field of ['created_sequence', 'last_activity_sequence', 'current_sequence', 'maximum_inactive_sequences', 'maximum_total_sequences']) {
    if (!isNonNegativeInteger(record[field])) errors.push(`${field}_invalid`);
  }
  if (
    isNonNegativeInteger(record.created_sequence) &&
    isNonNegativeInteger(record.last_activity_sequence) &&
    isNonNegativeInteger(record.current_sequence)
  ) {
    if (record.last_activity_sequence < record.created_sequence) errors.push('sequence_inconsistent::last_activity_before_created');
    if (record.current_sequence < record.last_activity_sequence) errors.push('sequence_inconsistent::current_before_last_activity');
    if (record.current_sequence < record.created_sequence) errors.push('sequence_inconsistent::current_before_created');
  }
  for (const field of ['expiration_applicable', 'expired_logically']) {
    if (typeof record[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(AGENT_SESSION_EXPIRATION_SAFE_FLAGS)) {
    if (record[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (record.validator_version !== AGENT_SESSION_EXPIRATION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(record);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateAgentSessionExpiration(input = {}) {
  const expirationPolicyId = isNonEmptyString(input.expiration_policy_id) ? input.expiration_policy_id : 'expiration_policy_not_available';
  const expirationType = EXPIRATION_TYPES.includes(input.expiration_type) ? input.expiration_type : 'NONE';
  const createdSequence = isNonNegativeInteger(input.created_sequence) ? input.created_sequence : 0;
  const lastActivitySequence = isNonNegativeInteger(input.last_activity_sequence) ? input.last_activity_sequence : createdSequence;
  const currentSequence = isNonNegativeInteger(input.current_sequence) ? input.current_sequence : lastActivitySequence;
  const maximumInactiveSequences = isNonNegativeInteger(input.maximum_inactive_sequences) ? input.maximum_inactive_sequences : 0;
  const maximumTotalSequences = isNonNegativeInteger(input.maximum_total_sequences) ? input.maximum_total_sequences : 0;

  const sequencesConsistent = currentSequence >= lastActivitySequence && lastActivitySequence >= createdSequence;
  const inactiveGap = currentSequence - lastActivitySequence;
  const totalGap = currentSequence - createdSequence;
  const expirationApplicable = expirationType !== 'NONE';

  let expiredLogically = false;
  let expirationReason = 'expiration_not_applicable';
  if (!sequencesConsistent) {
    expirationReason = 'sequence_inconsistent';
  } else if (expirationType === 'INACTIVITY_SEQUENCE') {
    expiredLogically = inactiveGap > maximumInactiveSequences;
    expirationReason = expiredLogically ? 'inactivity_sequence_exceeded' : 'inactivity_sequence_within_limit';
  } else if (expirationType === 'TOTAL_SEQUENCE') {
    expiredLogically = totalGap > maximumTotalSequences;
    expirationReason = expiredLogically ? 'total_sequence_exceeded' : 'total_sequence_within_limit';
  } else if (expirationType === 'EARLIEST_SEQUENCE_LIMIT') {
    const inactiveExceeded = inactiveGap > maximumInactiveSequences;
    const totalExceeded = totalGap > maximumTotalSequences;
    expiredLogically = inactiveExceeded || totalExceeded;
    expirationReason = expiredLogically
      ? (inactiveExceeded ? 'inactivity_sequence_exceeded' : 'total_sequence_exceeded')
      : 'earliest_sequence_limit_within_bounds';
  } else {
    expirationReason = 'expiration_not_applicable';
  }

  const record = {
    expiration_policy_id: expirationPolicyId,
    expiration_type: expirationType,
    created_sequence: createdSequence,
    last_activity_sequence: lastActivitySequence,
    current_sequence: currentSequence,
    maximum_inactive_sequences: maximumInactiveSequences,
    maximum_total_sequences: maximumTotalSequences,
    expiration_applicable: expirationApplicable,
    expired_logically: sequencesConsistent ? expiredLogically : false,
    expiration_reason: expirationReason,
    validator_version: AGENT_SESSION_EXPIRATION_VALIDATOR_VERSION,
    ...AGENT_SESSION_EXPIRATION_SAFE_FLAGS
  };
  const validation = validateAgentSessionExpiration(record);
  if (!validation.valid) {
    return cloneFrozen({
      ...record,
      expiration_applicable: false,
      expired_logically: false,
      expiration_reason: 'sequence_inconsistent',
      ...AGENT_SESSION_EXPIRATION_SAFE_FLAGS
    });
  }
  return cloneFrozen(record);
}

module.exports = {
  AGENT_SESSION_EXPIRATION_FIELDS,
  AGENT_SESSION_EXPIRATION_SAFE_FLAGS,
  AGENT_SESSION_EXPIRATION_VALIDATOR_VERSION,
  EXPIRATION_TYPES,
  evaluateAgentSessionExpiration,
  validateAgentSessionExpiration
};
