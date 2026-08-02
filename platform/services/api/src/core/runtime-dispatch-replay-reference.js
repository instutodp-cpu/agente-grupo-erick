'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr107: the Dispatch layer's own Replay Reference -- "Criar referência própria, versionada," never
// reusing Admission/Worker Assignment Replay "como se fosse Dispatch Replay." Binds to the exact
// Worker Assignment/Scheduler/Runtime Execution Package fingerprints+digests this dispatch
// preparation evaluated against, plus the official Idempotency Reference already flowing through the
// chain -- "vinculado ao Dispatch Request atual." `prior_dispatch_decision_ids`/
// `prior_dispatch_package_ids` and their fingerprint counterparts are caller-supplied (this
// simulation-only layer keeps no persisted history of its own -- "Sem persistência"), each pair kept
// strictly 1:1 by position and index-unique by id.
const RUNTIME_DISPATCH_REPLAY_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_replay_reference_validator_v1';

const UPSTREAM_ID_FINGERPRINT_FIELDS = Object.freeze([
  'runtime_dispatch_request_id', 'runtime_dispatch_request_fingerprint',
  'runtime_worker_assignment_package_id', 'runtime_worker_assignment_package_fingerprint',
  'runtime_worker_assignment_package_digest',
  'runtime_scheduler_package_id', 'runtime_scheduler_package_fingerprint', 'runtime_scheduler_package_digest',
  'runtime_execution_package_id', 'runtime_execution_package_fingerprint', 'runtime_execution_package_digest',
  'idempotency_reference_id', 'idempotency_fingerprint'
]);

const PRIOR_LIST_PAIRS = Object.freeze([
  ['prior_dispatch_decision_ids', 'prior_dispatch_decision_fingerprints'],
  ['prior_dispatch_package_ids', 'prior_dispatch_package_fingerprints']
]);

const RUNTIME_DISPATCH_REPLAY_REFERENCE_FIELDS = Object.freeze([
  'runtime_dispatch_replay_reference_id', 'runtime_dispatch_replay_reference_version',
  ...UPSTREAM_ID_FINGERPRINT_FIELDS,
  'expected_dispatch_attempt', 'maximum_dispatch_attempts',
  'prior_dispatch_decision_ids', 'prior_dispatch_decision_fingerprints',
  'prior_dispatch_package_ids', 'prior_dispatch_package_fingerprints',
  'duplicate_dispatch_preparation_blocked', 'replay_allowed', 'replay_validated', 'replay_consumed',
  'replay_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_REPLAY_REFERENCE_SAFE_FLAGS = Object.freeze({
  replay_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_ATTEMPTS = 1000;

function isUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString) && new Set(list).size === list.length;
}

function computeDispatchReplayFingerprint(reference) {
  const { replay_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchReplayReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_replay_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_REPLAY_REFERENCE_FIELDS, 'runtime_dispatch_replay_reference', errors);
  for (const field of ['runtime_dispatch_replay_reference_id', ...UPSTREAM_ID_FINGERPRINT_FIELDS, 'replay_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_dispatch_replay_reference_version) || reference.runtime_dispatch_replay_reference_version < 1) {
    errors.push('runtime_dispatch_replay_reference_version_invalid');
  }
  if (!Number.isInteger(reference.expected_dispatch_attempt) || reference.expected_dispatch_attempt < 1 || reference.expected_dispatch_attempt > MAX_ATTEMPTS) {
    errors.push('expected_dispatch_attempt_invalid');
  }
  if (!Number.isInteger(reference.maximum_dispatch_attempts) || reference.maximum_dispatch_attempts < 1 || reference.maximum_dispatch_attempts > MAX_ATTEMPTS) {
    errors.push('maximum_dispatch_attempts_invalid');
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
  if (typeof reference.duplicate_dispatch_preparation_blocked !== 'boolean') errors.push('duplicate_dispatch_preparation_blocked_must_be_boolean');
  if (typeof reference.replay_validated !== 'boolean') errors.push('replay_validated_must_be_boolean');
  if (typeof reference.replay_allowed !== 'boolean') errors.push('replay_allowed_must_be_boolean');
  if (
    Number.isInteger(reference.expected_dispatch_attempt) && Number.isInteger(reference.maximum_dispatch_attempts)
    && typeof reference.duplicate_dispatch_preparation_blocked === 'boolean' && typeof reference.replay_allowed === 'boolean'
  ) {
    const expectedAllowed = reference.expected_dispatch_attempt <= reference.maximum_dispatch_attempts
      && reference.duplicate_dispatch_preparation_blocked !== true;
    if (reference.replay_allowed !== expectedAllowed) errors.push('replay_allowed_inconsistent_with_attempts_and_duplicate_flag');
  }
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_REPLAY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_REPLAY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeDispatchReplayFingerprint(reference) !== reference.replay_fingerprint) errors.push('replay_fingerprint_mismatch');
  } catch (error) {
    errors.push('replay_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchReplayReference(input = {}) {
  const expectedAttempt = Number.isInteger(input.expected_dispatch_attempt) ? input.expected_dispatch_attempt : 1;
  const maximumAttempts = Number.isInteger(input.maximum_dispatch_attempts) ? input.maximum_dispatch_attempts : 1;
  const duplicateBlocked = input.duplicate_dispatch_preparation_blocked === true;
  const reference = {
    runtime_dispatch_replay_reference_id: input.runtime_dispatch_replay_reference_id,
    runtime_dispatch_replay_reference_version: Number.isInteger(input.runtime_dispatch_replay_reference_version) ? input.runtime_dispatch_replay_reference_version : 1,
    runtime_dispatch_request_id: input.runtime_dispatch_request_id,
    runtime_dispatch_request_fingerprint: input.runtime_dispatch_request_fingerprint,
    runtime_worker_assignment_package_id: input.runtime_worker_assignment_package_id,
    runtime_worker_assignment_package_fingerprint: input.runtime_worker_assignment_package_fingerprint,
    runtime_worker_assignment_package_digest: input.runtime_worker_assignment_package_digest,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_scheduler_package_fingerprint: input.runtime_scheduler_package_fingerprint,
    runtime_scheduler_package_digest: input.runtime_scheduler_package_digest,
    runtime_execution_package_id: input.runtime_execution_package_id,
    runtime_execution_package_fingerprint: input.runtime_execution_package_fingerprint,
    runtime_execution_package_digest: input.runtime_execution_package_digest,
    idempotency_reference_id: input.idempotency_reference_id,
    idempotency_fingerprint: input.idempotency_fingerprint,
    expected_dispatch_attempt: expectedAttempt,
    maximum_dispatch_attempts: maximumAttempts,
    prior_dispatch_decision_ids: uniqueSorted(input.prior_dispatch_decision_ids || []),
    prior_dispatch_decision_fingerprints: Array.isArray(input.prior_dispatch_decision_fingerprints) ? input.prior_dispatch_decision_fingerprints : [],
    prior_dispatch_package_ids: uniqueSorted(input.prior_dispatch_package_ids || []),
    prior_dispatch_package_fingerprints: Array.isArray(input.prior_dispatch_package_fingerprints) ? input.prior_dispatch_package_fingerprints : [],
    duplicate_dispatch_preparation_blocked: duplicateBlocked,
    replay_allowed: expectedAttempt <= maximumAttempts && duplicateBlocked !== true,
    replay_validated: input.replay_validated === true,
    replay_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_REPLAY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_REPLAY_REFERENCE_VALIDATOR_VERSION
  };
  reference.replay_fingerprint = computeDispatchReplayFingerprint(reference);

  const validation = validateRuntimeDispatchReplayReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_replay_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_ATTEMPTS,
  MAX_LIST_ITEMS,
  PRIOR_LIST_PAIRS,
  RUNTIME_DISPATCH_REPLAY_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_REPLAY_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_REPLAY_REFERENCE_VALIDATOR_VERSION,
  UPSTREAM_ID_FINGERPRINT_FIELDS,
  buildRuntimeDispatchReplayReference,
  computeDispatchReplayFingerprint,
  validateRuntimeDispatchReplayReference
};
