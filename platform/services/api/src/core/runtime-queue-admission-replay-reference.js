'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr108: the Queue Admission layer's own Replay Reference -- "Não reutilizar Dispatch Replay como
// se fosse Queue Admission Replay." Binds to the exact Dispatch Package fingerprint+digest and
// Dispatch Replay Reference this queue admission preparation evaluated against, plus the official
// Idempotency Reference already flowing through the chain. `prior_queue_admission_decision_ids`/
// `prior_queue_admission_package_ids` and their fingerprint counterparts are caller-supplied (this
// simulation-only layer keeps no persisted history of its own -- "Sem persistência"), each pair kept
// strictly 1:1 by position and index-unique by id.
const RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_admission_replay_reference_validator_v1';

const UPSTREAM_ID_FINGERPRINT_FIELDS = Object.freeze([
  'runtime_queue_admission_request_id', 'runtime_queue_admission_request_fingerprint',
  'runtime_dispatch_package_id', 'runtime_dispatch_package_fingerprint', 'runtime_dispatch_package_digest',
  'runtime_dispatch_replay_reference_id', 'runtime_dispatch_replay_fingerprint',
  'idempotency_reference_id', 'idempotency_fingerprint'
]);

const PRIOR_LIST_PAIRS = Object.freeze([
  ['prior_queue_admission_decision_ids', 'prior_queue_admission_decision_fingerprints'],
  ['prior_queue_admission_package_ids', 'prior_queue_admission_package_fingerprints']
]);

const RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_admission_replay_reference_id', 'runtime_queue_admission_replay_reference_version',
  ...UPSTREAM_ID_FINGERPRINT_FIELDS,
  'expected_queue_admission_attempt', 'maximum_queue_admission_attempts',
  'prior_queue_admission_decision_ids', 'prior_queue_admission_decision_fingerprints',
  'prior_queue_admission_package_ids', 'prior_queue_admission_package_fingerprints',
  'duplicate_queue_admission_preparation_blocked', 'replay_allowed', 'replay_validated', 'replay_consumed',
  'replay_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_SAFE_FLAGS = Object.freeze({
  replay_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_ATTEMPTS = 1000;

function isUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString) && new Set(list).size === list.length;
}

function computeQueueAdmissionReplayFingerprint(reference) {
  const { replay_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueueAdmissionReplayReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_admission_replay_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_FIELDS, 'runtime_queue_admission_replay_reference', errors);
  for (const field of ['runtime_queue_admission_replay_reference_id', ...UPSTREAM_ID_FINGERPRINT_FIELDS, 'replay_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_admission_replay_reference_version) || reference.runtime_queue_admission_replay_reference_version < 1) {
    errors.push('runtime_queue_admission_replay_reference_version_invalid');
  }
  if (!Number.isInteger(reference.expected_queue_admission_attempt) || reference.expected_queue_admission_attempt < 1 || reference.expected_queue_admission_attempt > MAX_ATTEMPTS) {
    errors.push('expected_queue_admission_attempt_invalid');
  }
  if (!Number.isInteger(reference.maximum_queue_admission_attempts) || reference.maximum_queue_admission_attempts < 1 || reference.maximum_queue_admission_attempts > MAX_ATTEMPTS) {
    errors.push('maximum_queue_admission_attempts_invalid');
  }
  for (const [idsField, fingerprintsField] of PRIOR_LIST_PAIRS) {
    if (!isUniqueStringList(reference[idsField])) errors.push(`${idsField}_invalid`);
    if (!Array.isArray(reference[fingerprintsField]) || reference[fingerprintsField].length > MAX_LIST_ITEMS || !reference[fingerprintsField].every(isNonEmptyString)) {
      errors.push(`${fingerprintsField}_invalid`);
    }
    if (Array.isArray(reference[idsField]) && Array.isArray(reference[fingerprintsField]) && reference[idsField].length !== reference[fingerprintsField].length) {
      errors.push(`${idsField}_${fingerprintsField}_not_1to1`);
    }
  }
  if (typeof reference.duplicate_queue_admission_preparation_blocked !== 'boolean') errors.push('duplicate_queue_admission_preparation_blocked_must_be_boolean');
  if (typeof reference.replay_validated !== 'boolean') errors.push('replay_validated_must_be_boolean');
  if (typeof reference.replay_allowed !== 'boolean') errors.push('replay_allowed_must_be_boolean');
  if (
    Number.isInteger(reference.expected_queue_admission_attempt) && Number.isInteger(reference.maximum_queue_admission_attempts)
    && typeof reference.duplicate_queue_admission_preparation_blocked === 'boolean' && typeof reference.replay_allowed === 'boolean'
  ) {
    const expectedAllowed = reference.expected_queue_admission_attempt <= reference.maximum_queue_admission_attempts
      && reference.duplicate_queue_admission_preparation_blocked !== true;
    if (reference.replay_allowed !== expectedAllowed) errors.push('replay_allowed_inconsistent_with_attempts_and_duplicate_flag');
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueueAdmissionReplayFingerprint(reference) !== reference.replay_fingerprint) errors.push('replay_fingerprint_mismatch');
  } catch (error) {
    errors.push('replay_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueAdmissionReplayReference(input = {}) {
  const expectedAttempt = Number.isInteger(input.expected_queue_admission_attempt) ? input.expected_queue_admission_attempt : 1;
  const maximumAttempts = Number.isInteger(input.maximum_queue_admission_attempts) ? input.maximum_queue_admission_attempts : 1;
  const duplicateBlocked = input.duplicate_queue_admission_preparation_blocked === true;
  const reference = {
    runtime_queue_admission_replay_reference_id: input.runtime_queue_admission_replay_reference_id,
    runtime_queue_admission_replay_reference_version: Number.isInteger(input.runtime_queue_admission_replay_reference_version) ? input.runtime_queue_admission_replay_reference_version : 1,
    runtime_queue_admission_request_id: input.runtime_queue_admission_request_id,
    runtime_queue_admission_request_fingerprint: input.runtime_queue_admission_request_fingerprint,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_dispatch_package_fingerprint: input.runtime_dispatch_package_fingerprint,
    runtime_dispatch_package_digest: input.runtime_dispatch_package_digest,
    runtime_dispatch_replay_reference_id: input.runtime_dispatch_replay_reference_id,
    runtime_dispatch_replay_fingerprint: input.runtime_dispatch_replay_fingerprint,
    idempotency_reference_id: input.idempotency_reference_id,
    idempotency_fingerprint: input.idempotency_fingerprint,
    expected_queue_admission_attempt: expectedAttempt,
    maximum_queue_admission_attempts: maximumAttempts,
    prior_queue_admission_decision_ids: uniqueSorted(input.prior_queue_admission_decision_ids || []),
    prior_queue_admission_decision_fingerprints: Array.isArray(input.prior_queue_admission_decision_fingerprints) ? input.prior_queue_admission_decision_fingerprints : [],
    prior_queue_admission_package_ids: uniqueSorted(input.prior_queue_admission_package_ids || []),
    prior_queue_admission_package_fingerprints: Array.isArray(input.prior_queue_admission_package_fingerprints) ? input.prior_queue_admission_package_fingerprints : [],
    duplicate_queue_admission_preparation_blocked: duplicateBlocked,
    replay_allowed: expectedAttempt <= maximumAttempts && duplicateBlocked !== true,
    replay_validated: input.replay_validated === true,
    replay_fingerprint: 'pending',
    ...RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_VALIDATOR_VERSION
  };
  reference.replay_fingerprint = computeQueueAdmissionReplayFingerprint(reference);

  const validation = validateRuntimeQueueAdmissionReplayReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_admission_replay_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_ATTEMPTS,
  MAX_LIST_ITEMS,
  PRIOR_LIST_PAIRS,
  RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_FIELDS,
  RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_ADMISSION_REPLAY_REFERENCE_VALIDATOR_VERSION,
  UPSTREAM_ID_FINGERPRINT_FIELDS,
  buildRuntimeQueueAdmissionReplayReference,
  computeQueueAdmissionReplayFingerprint,
  validateRuntimeQueueAdmissionReplayReference
};
