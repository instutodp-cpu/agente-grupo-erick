'use strict';

const { createPublicKey, verify } = require('node:crypto');
const { isPlainObject } = require('./read-only-adapter-contract');
const {
  ALGORITHM,
  CONTRACT_VERSION,
  COMMAND_DOMAIN,
  PUBLIC_KEY_BYTES,
  SIGNATURE_BYTES,
  canonicalSigningBytes,
  publicKeyFingerprint,
  replayIdentity,
  rootKeyDigest,
  validateCommandEnvelope
} = require('./canonical-governance-root-cryptographic-command-contract');

const AUTHENTICATION_INPUT_FIELDS = Object.freeze(['envelope', 'public_key']);
const AUTHENTICATION_STATUS = Object.freeze({ AUTHENTICATED: 'AUTHENTICATED', REJECTED: 'REJECTED' });
const AUTHENTICATION_REASON_CODES = Object.freeze([
  'INVALID_AUTHENTICATION_INPUT',
  'INVALID_COMMAND_CONTRACT',
  'INVALID_PUBLIC_KEY',
  'PUBLIC_KEY_FINGERPRINT_MISMATCH',
  'ROOT_BINDING_MISMATCH',
  'SIGNING_MATERIAL_INVALID',
  'INVALID_SIGNATURE',
  'CRYPTOGRAPHIC_VERIFICATION_FAILED'
]);

// RFC 8410 SubjectPublicKeyInfo wrapper for one raw Ed25519 public key. The external contract
// remains raw 32-byte base64url; this standard wrapper is only the input adapter for node:crypto.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function rejected(reasonCode) {
  return Object.freeze({
    authenticated: false,
    status: AUTHENTICATION_STATUS.REJECTED,
    reason_code: reasonCode
  });
}

function authenticated(envelope) {
  return Object.freeze({
    authenticated: true,
    status: AUTHENTICATION_STATUS.AUTHENTICATED,
    reason_code: null,
    command_digest: envelope.command_digest,
    replay_identity: replayIdentity(envelope)
  });
}

function hasExactFields(value, fields) {
  if (!isPlainObject(value)) return false;
  const allowed = new Set(fields);
  return fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
    && Object.keys(value).every((field) => allowed.has(field));
}

function decodeCanonicalBytes(value, byteLength) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) return null;
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    return null;
  }
  const canonical = decoded.toString('base64url');
  return decoded.length === byteLength && canonical === value ? decoded : null;
}

function validateRootBinding(envelope, publicKey) {
  if (envelope.root_subject_id !== `governance-root::${envelope.installation_id}`) return false;
  if (envelope.root_key_fingerprint !== publicKeyFingerprint(publicKey)) return false;
  return envelope.root_key_digest === rootKeyDigest({
    root_key_id: envelope.root_key_id,
    algorithm: ALGORITHM,
    public_key: publicKey
  });
}

function authenticateCanonicalGovernanceRootCommand(input) {
  try {
    if (!hasExactFields(input, AUTHENTICATION_INPUT_FIELDS)) return rejected('INVALID_AUTHENTICATION_INPUT');

    const envelopeValidation = validateCommandEnvelope(input.envelope);
    if (!envelopeValidation.valid) return rejected('INVALID_COMMAND_CONTRACT');

    const publicKeyBytes = decodeCanonicalBytes(input.public_key, PUBLIC_KEY_BYTES);
    if (!publicKeyBytes) return rejected('INVALID_PUBLIC_KEY');
    if (input.envelope.root_key_fingerprint !== publicKeyFingerprint(input.public_key)) {
      return rejected('PUBLIC_KEY_FINGERPRINT_MISMATCH');
    }
    if (!validateRootBinding(input.envelope, input.public_key)) return rejected('ROOT_BINDING_MISMATCH');

    let signingBytes;
    let signatureBytes;
    try {
      signingBytes = canonicalSigningBytes(input.envelope);
      signatureBytes = decodeCanonicalBytes(input.envelope.signature, SIGNATURE_BYTES);
      if (!signatureBytes) return rejected('SIGNING_MATERIAL_INVALID');
    } catch {
      return rejected('SIGNING_MATERIAL_INVALID');
    }

    let isValid;
    try {
      const publicKey = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
        format: 'der',
        type: 'spki'
      });
      isValid = verify(null, signingBytes, publicKey, signatureBytes);
    } catch {
      return rejected('CRYPTOGRAPHIC_VERIFICATION_FAILED');
    }
    return isValid ? authenticated(input.envelope) : rejected('INVALID_SIGNATURE');
  } catch {
    return rejected('INVALID_AUTHENTICATION_INPUT');
  }
}

module.exports = {
  ALGORITHM,
  AUTHENTICATION_INPUT_FIELDS,
  AUTHENTICATION_REASON_CODES,
  AUTHENTICATION_STATUS,
  COMMAND_DOMAIN,
  CONTRACT_VERSION,
  authenticateCanonicalGovernanceRootCommand
};
