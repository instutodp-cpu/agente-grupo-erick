'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ALGORITHM,
  COMMAND_DOMAIN,
  CONTRACT_VERSION,
  buildCommandEnvelope,
  buildSignatureVerificationMaterial,
  canonicalSigningBytes,
  canonicalSigningPayload,
  commandDigest,
  payloadDigest,
  publicKeyFingerprint,
  replayIdentity,
  rootKeyDigest,
  validateCommandEnvelope,
  validateRootKeyRecord,
  validateRootState
} = require('../src/core/canonical-governance-root-cryptographic-command-contract');

const PUBLIC_KEY = 'A'.repeat(43);
const SIGNATURE = 'A'.repeat(86);
const NONCE = 'A'.repeat(22);
const ROOT_DIGEST = `sha256:${'1'.repeat(64)}`;

function rootKey(overrides = {}) {
  const base = {
    root_key_id: 'root-key-0',
    root_subject_id: 'governance-root::installation-1',
    generation: 0,
    algorithm: ALGORITHM,
    public_key: PUBLIC_KEY,
    key_fingerprint: publicKeyFingerprint(PUBLIC_KEY),
    key_digest: rootKeyDigest({ root_key_id: 'root-key-0', algorithm: ALGORITHM, public_key: PUBLIC_KEY }),
    lifecycle_state: 'ACTIVE'
  };
  return { ...base, ...overrides };
}

function command(overrides = {}) {
  const base = {
    contract_version: CONTRACT_VERSION,
    domain: COMMAND_DOMAIN,
    command_id: 'command-1',
    installation_id: 'installation-1',
    root_subject_id: 'governance-root::installation-1',
    root_generation: 0,
    root_digest: ROOT_DIGEST,
    root_key_id: 'root-key-0',
    root_key_fingerprint: publicKeyFingerprint(PUBLIC_KEY),
    root_key_digest: rootKeyDigest({ root_key_id: 'root-key-0', algorithm: ALGORITHM, public_key: PUBLIC_KEY }),
    command_type: 'GOVERNANCE_ROOT_TEST',
    payload: {
      nested: { unicode: 'ação', empty: '', nullable: null },
      ordered: ['b', 'a']
    },
    issued_at: '2026-09-07T12:00:00.000Z',
    expires_at: '2026-09-07T12:15:00.000Z',
    nonce: NONCE,
    signature_algorithm: ALGORITHM,
    signature: SIGNATURE,
    ...overrides
  };
  return buildCommandEnvelope(base);
}

test('canonical command bytes and digest are deterministic and exclude signature', () => {
  const first = command();
  const second = command();
  assert.equal(canonicalSigningPayload(first), canonicalSigningPayload(second));
  assert.equal(commandDigest(first), commandDigest(second));
  assert.equal(first.command_digest, second.command_digest);
  assert.equal(commandDigest({ ...first, signature: 'B'.repeat(86) }), first.command_digest);
  assert.equal(canonicalSigningBytes(first).toString('utf8'), canonicalSigningPayload(first));
  assert.equal(replayIdentity(first), replayIdentity(second));
  assert.notEqual(replayIdentity(first), replayIdentity({ ...first, nonce: 'B'.repeat(22) }));
});

test('object key ordering is canonical while array ordering remains semantic', () => {
  const first = command();
  const reorderedPayload = { ordered: ['b', 'a'], nested: { nullable: null, empty: '', unicode: 'ação' } };
  const reordered = command({ payload: reorderedPayload });
  assert.equal(reordered.payload_digest, first.payload_digest);
  assert.equal(reordered.command_digest, first.command_digest);

  const arrayChanged = command({ payload: { ...first.payload, ordered: ['a', 'b'] } });
  assert.notEqual(arrayChanged.payload_digest, first.payload_digest);
  assert.notEqual(arrayChanged.command_digest, first.command_digest);
});

test('all signed identity and domain fields are bound by the canonical digest', () => {
  const first = command();
  for (const [field, value] of [
    ['command_type', 'GOVERNANCE_ROOT_OTHER'],
    ['installation_id', 'installation-2'],
    ['root_subject_id', 'governance-root::installation-2'],
    ['root_generation', 1],
    ['root_digest', `sha256:${'2'.repeat(64)}`],
    ['root_key_id', 'root-key-1'],
    ['root_key_fingerprint', `sha256:${'2'.repeat(64)}`],
    ['root_key_digest', `sha256:${'3'.repeat(64)}`],
    ['domain', 'OTHER_HERMES_DOMAIN'],
    ['payload', { changed: true }]
  ]) {
    const changed = { ...first, [field]: value };
    assert.notEqual(changed.command_digest, commandDigest(changed));
    assert.equal(validateCommandEnvelope(changed).valid, false);
  }
});

test('public key, signature, nonce and algorithm encodings are strict', () => {
  const valid = command();
  assert.equal(validateCommandEnvelope(valid).valid, true);
  assert.equal(validateCommandEnvelope({ ...valid, signature: 'A'.repeat(85) }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, nonce: 'A'.repeat(21) }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, signature: `${'A'.repeat(42)}==` }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, signature_algorithm: 'RSA' }).valid, false);
  assert.equal(validateRootKeyRecord(rootKey()).valid, true);
  assert.equal(validateRootKeyRecord(rootKey({ public_key: 'public-key-material-0' })).valid, false);
  assert.equal(validateRootKeyRecord(rootKey({ key_fingerprint: `sha256:${'0'.repeat(64)}` })).valid, false);
});

test('missing, extra, null and malformed fields fail closed', () => {
  const valid = command();
  const missing = { ...valid };
  delete missing.command_id;
  assert.equal(validateCommandEnvelope(missing).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, command_id: null }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, extra: true }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, payload: null }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, contract_version: 'unknown' }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, issued_at: '2026-09-07T12:00:00Z' }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, expires_at: '2026-09-07T12:00:00.000Z' }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, nonce: 'not-a-nonce' }).valid, false);
  assert.equal(validateCommandEnvelope({ ...valid, payload: { private_key: 'fixture-not-a-key' } }).valid, false);
});

test('time validity is explicit and deterministic when a clock is supplied', () => {
  const valid = command();
  assert.equal(validateCommandEnvelope(valid, { now: '2026-09-07T12:05:00.000Z' }).valid, true);
  assert.ok(validateCommandEnvelope(valid, { now: '2026-09-07T11:59:59.999Z' }).errors.includes('command_not_yet_valid'));
  assert.ok(validateCommandEnvelope(valid, { now: '2026-09-07T12:15:00.000Z' }).errors.includes('command_expired'));
  assert.ok(validateCommandEnvelope(valid, { now: 'not-a-time' }).errors.includes('command_now_invalid'));
  assert.ok(validateCommandEnvelope({ ...valid, expires_at: '2026-09-07T11:00:00.000Z' }).errors.includes('command_expiry_invalid'));
});

test('root key evidence binds subject, generation, lifecycle, public key and fingerprints', () => {
  const valid = rootKey();
  assert.equal(validateRootKeyRecord(valid, { root_subject_id: valid.root_subject_id, generation: 0 }).valid, true);
  assert.ok(validateRootKeyRecord({ ...valid, lifecycle_state: 'REVOKED' }).errors.includes('root_key_not_active'));
  assert.ok(validateRootKeyRecord(valid, { root_subject_id: 'governance-root::other' }).errors.includes('root_key_root_subject_id_mismatch'));
  assert.ok(validateRootKeyRecord({ ...valid, generation: 1 }, { generation: 0 }).errors.includes('root_key_generation_mismatch'));
});

test('verification material binds the active root and key and never accepts caller key substitution', () => {
  const envelope = command();
  const root = {
    installation_id: envelope.installation_id,
    root_subject_id: envelope.root_subject_id,
    root_digest: envelope.root_digest,
    active_generation: envelope.root_generation,
    lifecycle_state: 'ACTIVE'
  };
  const material = buildSignatureVerificationMaterial(envelope, root, rootKey());
  assert.equal(material.valid, true);
  assert.equal(material.algorithm, ALGORITHM);
  assert.equal(material.public_key, PUBLIC_KEY);
  assert.equal(material.signature, envelope.signature);
  assert.equal(material.signed_payload, canonicalSigningPayload(envelope));
  assert.equal(material.command_digest, envelope.command_digest);

  assert.equal(buildSignatureVerificationMaterial(envelope, { ...root, root_digest: `sha256:${'2'.repeat(64)}` }, rootKey()).valid, false);
  assert.equal(buildSignatureVerificationMaterial(envelope, root, rootKey({ public_key: 'B'.repeat(43) })).valid, false);
  assert.equal(buildSignatureVerificationMaterial(envelope, root, rootKey({ lifecycle_state: 'REVOKED' })).valid, false);
});

test('root state projection is strict and rejects non-canonical root identity or inactive lifecycle', () => {
  const valid = {
    installation_id: 'installation-1',
    root_subject_id: 'governance-root::installation-1',
    root_digest: ROOT_DIGEST,
    active_generation: 0,
    lifecycle_state: 'ACTIVE'
  };
  assert.equal(validateRootState(valid).valid, true);
  assert.equal(validateRootState({ ...valid, root_subject_id: 'other-root' }).valid, false);
  assert.equal(validateRootState({ ...valid, lifecycle_state: 'REVOKED' }).valid, false);
  assert.equal(validateRootState({ ...valid, extra: true }).valid, false);
});

test('payload digest follows the official canonical digest helper', () => {
  const value = { z: 1, a: ['x', null] };
  assert.match(payloadDigest(value), /^sha256:[0-9a-f]{64}$/);
  assert.equal(payloadDigest({ a: ['x', null], z: 1 }), payloadDigest(value));
});
