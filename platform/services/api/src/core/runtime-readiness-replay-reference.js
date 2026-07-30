'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr104: replay/idempotency protection for both Readiness and Admission attempts against the same
// Runtime Execution Package -- "nenhuma tentativa é iniciada" (replay_consumed is always false; this
// contract only records what attempt is being made and whether it would be a duplicate, never
// performs one). Mirrors the same replay-conflict discipline execution-gateway-replay-reference.js
// already established for the Gateway layer one boundary below.
const RUNTIME_READINESS_REPLAY_REFERENCE_VALIDATOR_VERSION = 'runtime_readiness_replay_reference_validator_v1';

const RUNTIME_READINESS_REPLAY_REFERENCE_FIELDS = Object.freeze([
  'runtime_readiness_replay_reference_id', 'runtime_readiness_replay_reference_version',
  'runtime_execution_package_id', 'runtime_package_fingerprint', 'runtime_package_digest',
  'readiness_request_id', 'readiness_request_fingerprint', 'admission_request_id', 'admission_request_fingerprint',
  'idempotency_reference_id', 'idempotency_fingerprint',
  'expected_readiness_attempt', 'maximum_readiness_attempts', 'expected_admission_attempt', 'maximum_admission_attempts',
  'prior_readiness_decision_ids', 'prior_readiness_decision_fingerprints',
  'prior_admission_decision_ids', 'prior_admission_decision_fingerprints',
  'duplicate_readiness_acceptance_blocked', 'duplicate_admission_acceptance_blocked',
  'replay_allowed', 'replay_validated', 'replay_consumed',
  'replay_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_READINESS_REPLAY_REFERENCE_SAFE_FLAGS = Object.freeze({
  replay_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_ATTEMPTS = 100000;

function isFingerprintList(list) {
  return Array.isArray(list) && list.length <= MAX_LIST_ITEMS && list.every(isNonEmptyString);
}

function isUniqueIdList(list) {
  return isFingerprintList(list) && new Set(list).size === list.length;
}

function computeReplayFingerprint(reference) {
  const { replay_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeReadinessReplayReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_readiness_replay_reference_must_be_object'] };
  exactFields(reference, RUNTIME_READINESS_REPLAY_REFERENCE_FIELDS, 'runtime_readiness_replay_reference', errors);
  for (const field of [
    'runtime_readiness_replay_reference_id', 'runtime_execution_package_id', 'runtime_package_fingerprint',
    'runtime_package_digest', 'readiness_request_id', 'readiness_request_fingerprint', 'admission_request_id',
    'admission_request_fingerprint', 'idempotency_reference_id', 'idempotency_fingerprint', 'replay_fingerprint',
    'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_readiness_replay_reference_version) || reference.runtime_readiness_replay_reference_version < 1) {
    errors.push('runtime_readiness_replay_reference_version_invalid');
  }
  for (const field of ['expected_readiness_attempt', 'maximum_readiness_attempts', 'expected_admission_attempt', 'maximum_admission_attempts']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 1 || reference[field] > MAX_ATTEMPTS) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(reference.expected_readiness_attempt) && Number.isInteger(reference.maximum_readiness_attempts)
    && reference.expected_readiness_attempt > reference.maximum_readiness_attempts
  ) {
    errors.push('expected_readiness_attempt_exceeds_maximum');
  }
  if (
    Number.isInteger(reference.expected_admission_attempt) && Number.isInteger(reference.maximum_admission_attempts)
    && reference.expected_admission_attempt > reference.maximum_admission_attempts
  ) {
    errors.push('expected_admission_attempt_exceeds_maximum');
  }
  if (!isUniqueIdList(reference.prior_readiness_decision_ids)) errors.push('prior_readiness_decision_ids_invalid');
  if (!isFingerprintList(reference.prior_readiness_decision_fingerprints)) errors.push('prior_readiness_decision_fingerprints_invalid');
  if (!isUniqueIdList(reference.prior_admission_decision_ids)) errors.push('prior_admission_decision_ids_invalid');
  if (!isFingerprintList(reference.prior_admission_decision_fingerprints)) errors.push('prior_admission_decision_fingerprints_invalid');
  if (
    Array.isArray(reference.prior_readiness_decision_ids) && Array.isArray(reference.prior_readiness_decision_fingerprints)
    && reference.prior_readiness_decision_ids.length !== reference.prior_readiness_decision_fingerprints.length
  ) {
    errors.push('prior_readiness_decision_lists_not_1to1');
  }
  if (
    Array.isArray(reference.prior_admission_decision_ids) && Array.isArray(reference.prior_admission_decision_fingerprints)
    && reference.prior_admission_decision_ids.length !== reference.prior_admission_decision_fingerprints.length
  ) {
    errors.push('prior_admission_decision_lists_not_1to1');
  }

  const readinessDuplicate = Array.isArray(reference.prior_readiness_decision_ids)
    && Number.isInteger(reference.expected_readiness_attempt)
    && reference.expected_readiness_attempt <= reference.prior_readiness_decision_ids.length;
  const admissionDuplicate = Array.isArray(reference.prior_admission_decision_ids)
    && Number.isInteger(reference.expected_admission_attempt)
    && reference.expected_admission_attempt <= reference.prior_admission_decision_ids.length;
  if (typeof reference.duplicate_readiness_acceptance_blocked !== 'boolean') errors.push('duplicate_readiness_acceptance_blocked_must_be_boolean');
  else if (reference.duplicate_readiness_acceptance_blocked !== readinessDuplicate) errors.push('duplicate_readiness_acceptance_blocked_does_not_match_attempts');
  if (typeof reference.duplicate_admission_acceptance_blocked !== 'boolean') errors.push('duplicate_admission_acceptance_blocked_must_be_boolean');
  else if (reference.duplicate_admission_acceptance_blocked !== admissionDuplicate) errors.push('duplicate_admission_acceptance_blocked_does_not_match_attempts');

  const noStructuralIssues = errors.length === 0;
  const expectedReplayAllowed = noStructuralIssues && !readinessDuplicate && !admissionDuplicate;
  if (typeof reference.replay_allowed !== 'boolean') errors.push('replay_allowed_must_be_boolean');
  else if (noStructuralIssues && reference.replay_allowed !== expectedReplayAllowed) errors.push('replay_allowed_inconsistent_with_attempts');
  if (typeof reference.replay_validated !== 'boolean') errors.push('replay_validated_must_be_boolean');
  else if (noStructuralIssues && reference.replay_validated !== expectedReplayAllowed) errors.push('replay_validated_inconsistent_with_replay_allowed');

  for (const [field, expected] of Object.entries(RUNTIME_READINESS_REPLAY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_READINESS_REPLAY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeReplayFingerprint(reference) !== reference.replay_fingerprint) errors.push('replay_fingerprint_mismatch');
  } catch (error) {
    errors.push('replay_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeReadinessReplayReference(input = {}) {
  const priorReadinessIds = Array.isArray(input.prior_readiness_decision_ids) ? input.prior_readiness_decision_ids : [];
  const priorAdmissionIds = Array.isArray(input.prior_admission_decision_ids) ? input.prior_admission_decision_ids : [];
  const expectedReadinessAttempt = Number.isInteger(input.expected_readiness_attempt) ? input.expected_readiness_attempt : 1;
  const expectedAdmissionAttempt = Number.isInteger(input.expected_admission_attempt) ? input.expected_admission_attempt : 1;
  const readinessDuplicate = expectedReadinessAttempt <= priorReadinessIds.length;
  const admissionDuplicate = expectedAdmissionAttempt <= priorAdmissionIds.length;

  const reference = {
    runtime_readiness_replay_reference_id: input.runtime_readiness_replay_reference_id,
    runtime_readiness_replay_reference_version: Number.isInteger(input.runtime_readiness_replay_reference_version) ? input.runtime_readiness_replay_reference_version : 1,
    runtime_execution_package_id: input.runtime_execution_package_id,
    runtime_package_fingerprint: input.runtime_package_fingerprint,
    runtime_package_digest: input.runtime_package_digest,
    readiness_request_id: input.readiness_request_id,
    readiness_request_fingerprint: input.readiness_request_fingerprint,
    admission_request_id: input.admission_request_id,
    admission_request_fingerprint: input.admission_request_fingerprint,
    idempotency_reference_id: input.idempotency_reference_id,
    idempotency_fingerprint: input.idempotency_fingerprint,
    expected_readiness_attempt: expectedReadinessAttempt,
    maximum_readiness_attempts: Number.isInteger(input.maximum_readiness_attempts) ? input.maximum_readiness_attempts : 1,
    expected_admission_attempt: expectedAdmissionAttempt,
    maximum_admission_attempts: Number.isInteger(input.maximum_admission_attempts) ? input.maximum_admission_attempts : 1,
    prior_readiness_decision_ids: priorReadinessIds,
    prior_readiness_decision_fingerprints: Array.isArray(input.prior_readiness_decision_fingerprints) ? input.prior_readiness_decision_fingerprints : [],
    prior_admission_decision_ids: priorAdmissionIds,
    prior_admission_decision_fingerprints: Array.isArray(input.prior_admission_decision_fingerprints) ? input.prior_admission_decision_fingerprints : [],
    duplicate_readiness_acceptance_blocked: readinessDuplicate,
    duplicate_admission_acceptance_blocked: admissionDuplicate,
    replay_allowed: !readinessDuplicate && !admissionDuplicate,
    replay_validated: !readinessDuplicate && !admissionDuplicate,
    replay_fingerprint: 'pending',
    ...RUNTIME_READINESS_REPLAY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_READINESS_REPLAY_REFERENCE_VALIDATOR_VERSION
  };
  reference.replay_fingerprint = computeReplayFingerprint(reference);

  const validation = validateRuntimeReadinessReplayReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_readiness_replay_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_ATTEMPTS,
  MAX_LIST_ITEMS,
  RUNTIME_READINESS_REPLAY_REFERENCE_FIELDS,
  RUNTIME_READINESS_REPLAY_REFERENCE_SAFE_FLAGS,
  RUNTIME_READINESS_REPLAY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeReadinessReplayReference,
  computeReplayFingerprint,
  validateRuntimeReadinessReplayReference
};
