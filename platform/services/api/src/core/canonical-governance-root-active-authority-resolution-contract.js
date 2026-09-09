'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const {
  COMMAND_ENVELOPE_FIELDS,
  replayIdentity,
  validateCommandEnvelope,
  validateRootKeyRecord,
  validateRootState
} = require('./canonical-governance-root-cryptographic-command-contract');

const RESOLUTION_INPUT_FIELDS = Object.freeze(['authentication', 'envelope']);
const AUTHENTICATION_RESULT_FIELDS = Object.freeze([
  'authenticated', 'status', 'reason_code', 'command_digest', 'replay_identity'
]);
const RESOLUTION_STATUS = Object.freeze({ RESOLVED: 'RESOLVED_ACTIVE_ROOT', REJECTED: 'REJECTED' });
const RESOLUTION_REASON_CODES = Object.freeze([
  'AUTHENTICATION_REQUIRED',
  'INVALID_RESOLUTION_INPUT',
  'UNKNOWN_INSTALLATION',
  'INSTALLATION_NOT_ACTIVE',
  'ROOT_NOT_FOUND',
  'ROOT_NOT_ACTIVE',
  'ROOT_GENERATION_MISMATCH',
  'ROOT_DIGEST_MISMATCH',
  'ROOT_SUBJECT_MISMATCH',
  'ROOT_KEY_NOT_FOUND',
  'ROOT_KEY_MISMATCH',
  'ROOT_KEY_FINGERPRINT_MISMATCH',
  'ROOT_KEY_DIGEST_MISMATCH',
  'ROOT_KEY_INVALID',
  'STATE_AMBIGUOUS',
  'DATABASE_READ_FAILED'
]);

function hasExactFields(value, fields) {
  if (!isPlainObject(value)) return false;
  const allowed = new Set(fields);
  return fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
    && Object.keys(value).every((field) => allowed.has(field));
}

function reject(reasonCode) {
  return Object.freeze({ resolved: false, status: RESOLUTION_STATUS.REJECTED, reason_code: reasonCode });
}

function resolved(root, key) {
  return Object.freeze({
    resolved: true,
    status: RESOLUTION_STATUS.RESOLVED,
    reason_code: null,
    installation_id: root.installation_id,
    root_subject_id: root.root_subject_id,
    root_digest: root.root_digest,
    root_generation: root.active_generation,
    root_key_id: key.root_key_id,
    root_key_fingerprint: key.key_fingerprint,
    root_key_digest: key.key_digest
  });
}

function validateAuthenticationEvidence(authentication, envelope) {
  if (!hasExactFields(authentication, AUTHENTICATION_RESULT_FIELDS)) return false;
  return authentication.authenticated === true
    && authentication.status === 'AUTHENTICATED'
    && authentication.reason_code === null
    && authentication.command_digest === envelope.command_digest
    && authentication.replay_identity === replayIdentity(envelope);
}

function validateResolutionInput(input) {
  if (!hasExactFields(input, RESOLUTION_INPUT_FIELDS)) return { valid: false, reason_code: 'INVALID_RESOLUTION_INPUT' };
  const commandValidation = validateCommandEnvelope(input.envelope);
  if (!commandValidation.valid) return { valid: false, reason_code: 'INVALID_RESOLUTION_INPUT' };
  if (!validateAuthenticationEvidence(input.authentication, input.envelope)) {
    return { valid: false, reason_code: 'AUTHENTICATION_REQUIRED' };
  }
  return { valid: true, reason_code: null };
}

function rootValidationReason(errors) {
  if (errors.includes('root_not_active')) return 'ROOT_NOT_ACTIVE';
  if (errors.includes('root_root_digest_mismatch')) return 'ROOT_DIGEST_MISMATCH';
  if (errors.includes('root_active_generation_mismatch')) return 'ROOT_GENERATION_MISMATCH';
  if (errors.some((error) => error.includes('root_subject'))) return 'ROOT_SUBJECT_MISMATCH';
  return 'ROOT_NOT_FOUND';
}

function keyValidationReason(errors) {
  if (errors.includes('root_key_not_active')) return 'ROOT_KEY_NOT_FOUND';
  if (errors.includes('root_key_root_key_id_mismatch')) return 'ROOT_KEY_MISMATCH';
  if (errors.includes('root_key_key_fingerprint_mismatch')) return 'ROOT_KEY_FINGERPRINT_MISMATCH';
  if (errors.includes('root_key_key_digest_mismatch')) return 'ROOT_KEY_DIGEST_MISMATCH';
  if (errors.includes('root_key_root_subject_id_mismatch') || errors.includes('root_key_generation_mismatch')) {
    return 'ROOT_KEY_MISMATCH';
  }
  return 'ROOT_KEY_INVALID';
}

module.exports = {
  AUTHENTICATION_RESULT_FIELDS,
  COMMAND_ENVELOPE_FIELDS,
  RESOLUTION_INPUT_FIELDS,
  RESOLUTION_REASON_CODES,
  RESOLUTION_STATUS,
  keyValidationReason,
  reject,
  resolved,
  rootValidationReason,
  validateAuthenticationEvidence,
  validateResolutionInput,
  validateRootKeyRecord,
  validateRootState
};
