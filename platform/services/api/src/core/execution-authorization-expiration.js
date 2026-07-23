'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_AUTHORIZATION_EXPIRATION_VALIDATOR_VERSION = 'execution_authorization_expiration_validator_v1';

const EXECUTION_AUTHORIZATION_EXPIRATION_FIELDS = Object.freeze([
  'expiration_evaluation_id', 'authorization_created_sequence', 'current_sequence', 'maximum_valid_sequences',
  'expiration_applicable', 'expired_logically', 'expiration_reason', 'expiration_evaluated', 'clock_accessed',
  'timer_created', 'authorization_mutated', 'simulation', 'production_blocked', 'validator_version'
]);

// Logical-sequence-only invariants -- no wall-clock read, no timer, no mutation of a stored
// authorization ever happens while evaluating expiration.
const EXECUTION_AUTHORIZATION_EXPIRATION_SAFE_FLAGS = Object.freeze({
  expiration_evaluated: true,
  clock_accessed: false,
  timer_created: false,
  authorization_mutated: false,
  simulation: true,
  production_blocked: true
});

const MAX_SEQUENCE = 1000000000;

function validateExecutionAuthorizationExpiration(evaluation) {
  const errors = [];
  if (!isPlainObject(evaluation)) return { valid: false, errors: ['execution_authorization_expiration_must_be_object'] };
  exactFields(evaluation, EXECUTION_AUTHORIZATION_EXPIRATION_FIELDS, 'execution_authorization_expiration', errors);
  for (const field of ['expiration_evaluation_id', 'expiration_reason', 'validator_version']) {
    if (!isNonEmptyString(evaluation[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['authorization_created_sequence', 'current_sequence']) {
    if (!Number.isInteger(evaluation[field]) || evaluation[field] < 0 || evaluation[field] > MAX_SEQUENCE) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(evaluation.maximum_valid_sequences) || evaluation.maximum_valid_sequences < 0 || evaluation.maximum_valid_sequences > MAX_SEQUENCE) {
    errors.push('maximum_valid_sequences_invalid');
  }
  if (typeof evaluation.expiration_applicable !== 'boolean') errors.push('expiration_applicable_must_be_boolean');
  if (typeof evaluation.expired_logically !== 'boolean') errors.push('expired_logically_must_be_boolean');
  for (const [field, expected] of Object.entries(EXECUTION_AUTHORIZATION_EXPIRATION_SAFE_FLAGS)) {
    if (evaluation[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (
    Number.isInteger(evaluation.authorization_created_sequence) && Number.isInteger(evaluation.current_sequence) &&
    evaluation.current_sequence < evaluation.authorization_created_sequence
  ) {
    errors.push('current_sequence_before_created_sequence');
  }
  if (evaluation.expiration_applicable === false && evaluation.expired_logically !== false) {
    errors.push('expired_logically_must_be_false_when_not_applicable');
  }

  if (evaluation.validator_version !== EXECUTION_AUTHORIZATION_EXPIRATION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(evaluation);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(evaluation));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// ExpirationEvaluation deliberately carries no embedded fingerprint field of its own (unlike the
// other reference contracts in this PR) -- the spec's exact-fields list omits it. The
// AuthorizationDecision computes expiration_fingerprint externally, over the whole object.
function computeExpirationFingerprint(evaluation) {
  return stablePayload(evaluation);
}

function buildExecutionAuthorizationExpiration(input = {}) {
  const createdSequence = Number.isInteger(input.authorization_created_sequence) ? input.authorization_created_sequence : 0;
  const currentSequence = Number.isInteger(input.current_sequence) ? input.current_sequence : 0;
  const maximumValidSequences = Number.isInteger(input.maximum_valid_sequences) ? input.maximum_valid_sequences : 0;
  const expirationApplicable = input.expiration_applicable === true;

  let expiredLogically = false;
  let reason = 'expiration_not_applicable';
  if (expirationApplicable) {
    const sequencesElapsed = currentSequence - createdSequence;
    expiredLogically = sequencesElapsed > maximumValidSequences;
    reason = expiredLogically ? 'sequence_window_exceeded' : 'within_valid_sequence_window';
  }

  const evaluation = {
    expiration_evaluation_id: input.expiration_evaluation_id,
    authorization_created_sequence: createdSequence,
    current_sequence: currentSequence,
    maximum_valid_sequences: maximumValidSequences,
    expiration_applicable: expirationApplicable,
    expired_logically: expiredLogically,
    expiration_reason: reason,
    expiration_evaluated: true,
    clock_accessed: false,
    timer_created: false,
    authorization_mutated: false,
    simulation: true,
    production_blocked: true,
    validator_version: EXECUTION_AUTHORIZATION_EXPIRATION_VALIDATOR_VERSION
  };

  const validation = validateExecutionAuthorizationExpiration(evaluation);
  if (!validation.valid) {
    throw new Error(`execution_authorization_expiration_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(evaluation);
}

module.exports = {
  EXECUTION_AUTHORIZATION_EXPIRATION_FIELDS,
  EXECUTION_AUTHORIZATION_EXPIRATION_SAFE_FLAGS,
  EXECUTION_AUTHORIZATION_EXPIRATION_VALIDATOR_VERSION,
  MAX_SEQUENCE,
  buildExecutionAuthorizationExpiration,
  computeExpirationFingerprint,
  validateExecutionAuthorizationExpiration
};
