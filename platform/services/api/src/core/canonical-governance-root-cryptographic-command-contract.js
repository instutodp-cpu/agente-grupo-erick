'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload, cloneFrozen } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');

// This module specifies the bytes and evidence a later authentication boundary must verify. It
// deliberately does not import node:crypto, generate keys, verify signatures, access PostgreSQL,
// or grant any authority. Authentication is a later layer; this is only its canonical contract.
const CONTRACT_NAME = 'HERMES_CANONICAL_GOVERNANCE_ROOT_CRYPTOGRAPHIC_COMMAND_CONTRACT';
const CONTRACT_VERSION = 'hermes_canonical_governance_root_cryptographic_command_contract_v1';
const COMMAND_DOMAIN = 'HERMES_CANONICAL_GOVERNANCE_ROOT_COMMAND_V1';
const ALGORITHM = 'Ed25519';
const PUBLIC_KEY_ENCODING = 'raw_32_bytes_base64url_nopad_v1';
const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_ENCODING = 'raw_64_bytes_base64url_nopad_v1';
const SIGNATURE_BYTES = 64;
const NONCE_BYTES = 16;
const COMMAND_IDENTITY_MODEL = 'command_id::nonce::command_digest';
const CANONICAL_TEXT_ENCODING = 'utf8';

const COMMAND_ENVELOPE_FIELDS = Object.freeze([
  'contract_version', 'domain', 'command_id', 'installation_id', 'root_subject_id',
  'root_generation', 'root_digest', 'root_key_id', 'root_key_fingerprint', 'root_key_digest',
  'command_type', 'payload', 'payload_digest', 'issued_at', 'expires_at', 'nonce',
  'signature_algorithm', 'signature', 'command_digest'
]);

const SIGNING_PAYLOAD_FIELDS = Object.freeze([
  'contract_version', 'domain', 'command_id', 'installation_id', 'root_subject_id',
  'root_generation', 'root_digest', 'root_key_id', 'root_key_fingerprint', 'root_key_digest',
  'command_type', 'payload_digest', 'issued_at', 'expires_at', 'nonce', 'signature_algorithm'
]);

const ROOT_KEY_RECORD_FIELDS = Object.freeze([
  'root_key_id', 'root_subject_id', 'generation', 'algorithm', 'public_key',
  'key_fingerprint', 'key_digest', 'lifecycle_state'
]);

const ROOT_STATE_FIELDS = Object.freeze([
  'installation_id', 'root_subject_id', 'root_digest', 'active_generation', 'lifecycle_state'
]);

const IDENTIFIER_PATTERN = /^[^\u0000-\u001f\u007f\s]{1,255}$/u;
const COMMAND_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function exactFields(value, fields, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return false;
  }
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${prefix}_unexpected_${field}`);
  }
  return true;
}

function isIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function isDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value) && isCanonicalContentDigest(value);
}

function base64urlWithoutPadding(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function isCanonicalEncodedBytes(value, byteLength) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) return false;
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    return false;
  }
  return decoded.length === byteLength && base64urlWithoutPadding(decoded) === value;
}

function publicKeyFingerprint(publicKey) {
  return computeCanonicalContentDigest({ algorithm: ALGORITHM, public_key: publicKey });
}

function rootKeyDigest(rootKey) {
  return computeCanonicalContentDigest({
    root_key_id: rootKey.root_key_id,
    algorithm: rootKey.algorithm,
    public_key: rootKey.public_key
  });
}

function payloadDigest(payload) {
  return computeCanonicalContentDigest(payload);
}

function signingPayload(envelope) {
  const payload = Object.fromEntries(SIGNING_PAYLOAD_FIELDS.map((field) => [field, envelope[field]]));
  // The signed bytes are reconstructed from the actual payload, never from a caller-supplied
  // digest. The envelope field is retained as an integrity assertion and is checked separately.
  payload.payload_digest = payloadDigest(envelope.payload);
  return payload;
}

function canonicalSigningPayload(envelope) {
  return stablePayload(signingPayload(envelope));
}

function commandDigest(envelope) {
  return computeCanonicalContentDigest(JSON.parse(canonicalSigningPayload(envelope)));
}

function replayIdentity(envelope) {
  return computeCanonicalContentDigest({
    command_id: envelope.command_id,
    nonce: envelope.nonce,
    command_digest: envelope.command_digest
  });
}

function canonicalSigningBytes(envelope) {
  return Buffer.from(canonicalSigningPayload(envelope), CANONICAL_TEXT_ENCODING);
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function parseNow(value) {
  const parsed = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value
      : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function validateTimeWindow(envelope, now, errors = []) {
  const issuedAt = Date.parse(envelope.issued_at || '');
  const expiresAt = Date.parse(envelope.expires_at || '');
  if (Number.isFinite(issuedAt) && Number.isFinite(expiresAt) && expiresAt <= issuedAt) {
    errors.push('command_expiry_invalid');
  }
  if (now !== undefined) {
    const nowValue = parseNow(now);
    if (nowValue === null) errors.push('command_now_invalid');
    else {
      if (Number.isFinite(issuedAt) && nowValue < issuedAt) errors.push('command_not_yet_valid');
      if (Number.isFinite(expiresAt) && nowValue >= expiresAt) errors.push('command_expired');
    }
  }
  return errors;
}

function containsPrivateKeyMaterial(value, seen = new WeakSet()) {
  if (typeof value === 'string') return /private[ _-]?key|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i.test(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsPrivateKeyMaterial(item, seen));
  return Object.entries(value).some(([key, nested]) => /private[ _-]?key|secret|password|credential|token/i.test(key)
    || containsPrivateKeyMaterial(nested, seen));
}

function validateRootKeyRecord(rootKey, expected = {}, errors = []) {
  if (!exactFields(rootKey, ROOT_KEY_RECORD_FIELDS, 'root_key', errors)) return { valid: false, errors };
  for (const field of ['root_key_id', 'root_subject_id', 'public_key', 'key_fingerprint', 'key_digest', 'lifecycle_state']) {
    if (!isIdentifier(rootKey[field]) && !['key_fingerprint', 'key_digest'].includes(field)) errors.push(`root_key_${field}_invalid`);
  }
  if (!isCanonicalEncodedBytes(rootKey.public_key, PUBLIC_KEY_BYTES)) errors.push('root_key_public_key_encoding_invalid');
  if (rootKey.algorithm !== ALGORITHM) errors.push('root_key_algorithm_invalid');
  if (!Number.isInteger(rootKey.generation) || rootKey.generation < 0) errors.push('root_key_generation_invalid');
  if (!isDigest(rootKey.key_fingerprint) || rootKey.key_fingerprint !== publicKeyFingerprint(rootKey.public_key)) errors.push('root_key_fingerprint_mismatch');
  if (!isDigest(rootKey.key_digest) || rootKey.key_digest !== rootKeyDigest(rootKey)) errors.push('root_key_digest_mismatch');
  if (rootKey.lifecycle_state !== 'ACTIVE') errors.push('root_key_not_active');
  for (const field of ['root_subject_id', 'generation', 'root_key_id', 'key_fingerprint', 'key_digest']) {
    if (expected[field] !== undefined && rootKey[field] !== expected[field]) errors.push(`root_key_${field}_mismatch`);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

function validateRootState(root, expected = {}, errors = []) {
  if (!exactFields(root, ROOT_STATE_FIELDS, 'root', errors)) return { valid: false, errors };
  for (const field of ['installation_id', 'root_subject_id']) {
    if (!isIdentifier(root[field])) errors.push(`root_${field}_invalid`);
  }
  if (!isDigest(root.root_digest)) errors.push('root_root_digest_invalid');
  if (!Number.isInteger(root.active_generation) || root.active_generation < 0) errors.push('root_active_generation_invalid');
  if (root.lifecycle_state !== 'ACTIVE') errors.push('root_not_active');
  if (root.root_subject_id !== `governance-root::${root.installation_id}`) errors.push('root_subject_identity_invalid');
  for (const field of ROOT_STATE_FIELDS) {
    if (expected[field] !== undefined && root[field] !== expected[field]) errors.push(`root_${field}_mismatch`);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

// Produces the exact inputs a future verifier must pass to a trusted Ed25519 implementation.
// It does not verify, persist, consume, or authorize anything. The public key is deliberately
// sourced from the validated canonical key record, never from the command envelope.
function buildSignatureVerificationMaterial(envelope, root, rootKey) {
  const errors = [];
  const commandValidation = validateCommandEnvelope(envelope);
  if (!commandValidation.valid) errors.push(...commandValidation.errors);
  const rootValidation = validateRootState(root, {
    installation_id: envelope?.installation_id,
    root_subject_id: envelope?.root_subject_id,
    root_digest: envelope?.root_digest,
    active_generation: envelope?.root_generation
  });
  if (!rootValidation.valid) errors.push(...rootValidation.errors);
  const keyValidation = validateRootKeyRecord(rootKey, {
    root_subject_id: envelope?.root_subject_id,
    generation: envelope?.root_generation,
    root_key_id: envelope?.root_key_id,
    key_fingerprint: envelope?.root_key_fingerprint,
    key_digest: envelope?.root_key_digest
  });
  if (!keyValidation.valid) errors.push(...keyValidation.errors);
  if (errors.length > 0) return { valid: false, errors: [...new Set(errors)].sort() };
  return {
    valid: true,
    algorithm: rootKey.algorithm,
    public_key: rootKey.public_key,
    public_key_fingerprint: rootKey.key_fingerprint,
    signature: envelope.signature,
    signed_payload: canonicalSigningPayload(envelope),
    command_digest: envelope.command_digest
  };
}

function validateCommandEnvelope(envelope, options = {}) {
  const errors = [];
  if (!exactFields(envelope, COMMAND_ENVELOPE_FIELDS, 'command', errors)) return { valid: false, errors };

  if (envelope.contract_version !== CONTRACT_VERSION) errors.push('command_contract_version_invalid');
  if (envelope.domain !== COMMAND_DOMAIN) errors.push('command_domain_invalid');
  for (const field of ['command_id', 'installation_id', 'root_subject_id', 'root_key_id', 'nonce']) {
    if (!isIdentifier(envelope[field])) errors.push(`command_${field}_invalid`);
  }
  if (!Number.isInteger(envelope.root_generation) || envelope.root_generation < 0) errors.push('command_root_generation_invalid');
  for (const field of ['root_digest', 'root_key_fingerprint', 'root_key_digest', 'payload_digest', 'command_digest']) {
    if (!isDigest(envelope[field])) errors.push(`command_${field}_invalid`);
  }
  if (!COMMAND_TYPE_PATTERN.test(envelope.command_type || '')) errors.push('command_type_invalid');
  if (!isPlainObject(envelope.payload)) errors.push('command_payload_invalid');
  else {
    if (containsPrivateKeyMaterial(envelope.payload)) errors.push('command_private_key_material_forbidden');
    try {
      if (envelope.payload_digest !== payloadDigest(envelope.payload)) errors.push('command_payload_digest_mismatch');
    } catch (error) {
      errors.push(`command_payload_not_serializable::${error.message}`);
    }
  }
  if (!canonicalTimestamp(envelope.issued_at)) errors.push('command_issued_at_invalid');
  if (!canonicalTimestamp(envelope.expires_at)) errors.push('command_expires_at_invalid');
  validateTimeWindow(envelope, options.now, errors);
  if (envelope.signature_algorithm !== ALGORITHM) errors.push('command_signature_algorithm_invalid');
  if (!isCanonicalEncodedBytes(envelope.signature, SIGNATURE_BYTES)) errors.push('command_signature_encoding_invalid');
  if (!isCanonicalEncodedBytes(envelope.nonce, NONCE_BYTES)) errors.push('command_nonce_encoding_invalid');
  try {
    if (envelope.command_digest !== commandDigest(envelope)) errors.push('command_digest_mismatch');
  } catch (error) {
    errors.push(`command_canonical_serialization_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)].sort() };
}

function buildCommandEnvelope(input = {}) {
  const envelope = {
    ...input,
    contract_version: CONTRACT_VERSION,
    domain: COMMAND_DOMAIN,
    payload_digest: payloadDigest(input.payload),
    command_digest: 'pending'
  };
  envelope.command_digest = commandDigest(envelope);
  const validation = validateCommandEnvelope(envelope);
  if (!validation.valid) throw new TypeError(`command_envelope_invalid::${validation.errors.join(',')}`);
  return cloneFrozen(envelope);
}

module.exports = {
  ALGORITHM,
  COMMAND_DOMAIN,
  COMMAND_ENVELOPE_FIELDS,
  CANONICAL_TEXT_ENCODING,
  COMMAND_IDENTITY_MODEL,
  CONTRACT_NAME,
  CONTRACT_VERSION,
  NONCE_BYTES,
  PUBLIC_KEY_BYTES,
  PUBLIC_KEY_ENCODING,
  ROOT_KEY_RECORD_FIELDS,
  ROOT_STATE_FIELDS,
  SIGNATURE_BYTES,
  SIGNATURE_ENCODING,
  SIGNING_PAYLOAD_FIELDS,
  buildCommandEnvelope,
  buildSignatureVerificationMaterial,
  canonicalSigningBytes,
  canonicalSigningPayload,
  canonicalTimestamp,
  commandDigest,
  parseNow,
  payloadDigest,
  publicKeyFingerprint,
  replayIdentity,
  rootKeyDigest,
  signingPayload,
  validateCommandEnvelope,
  validateRootKeyRecord,
  validateRootState,
  validateTimeWindow
};
