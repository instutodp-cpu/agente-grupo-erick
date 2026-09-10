'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUTHORITY_GRANT_REVOCATION_FIELDS,
  CONTRACT_VERSION,
  REVOCATION_DOMAIN,
  REVOCATION_REASON_CODES,
  authorityGrantRevocationDigest,
  buildAuthorityGrantRevocation,
  canonicalAuthorityGrantRevocationBytes,
  validateAuthorityGrantRevocation
} = require('../src/core/canonical-governance-authority-grant-revocation-contract');

const INSTALLATION_ID = 'installation-revocation-test';
const ROOT_SUBJECT_ID = `governance-root::${INSTALLATION_ID}`;
const TARGET_GRANT_DIGEST = `sha256:${'1'.repeat(64)}`;
const ROOT_DIGEST = `sha256:${'2'.repeat(64)}`;
const ROOT_KEY_FINGERPRINT = `sha256:${'3'.repeat(64)}`;
const ROOT_KEY_DIGEST = `sha256:${'4'.repeat(64)}`;

function revocationInput(overrides = {}) {
  return {
    authority_grant_revocation_id: 'authority-grant-revocation-1',
    installation_id: INSTALLATION_ID,
    target_authority_grant_id: 'authority-grant-1',
    target_grant_digest: TARGET_GRANT_DIGEST,
    issuer_root_subject_id: ROOT_SUBJECT_ID,
    issuer_root_generation: 0,
    issuer_root_digest: ROOT_DIGEST,
    issuer_root_key_id: 'root-key-0',
    issuer_root_key_fingerprint: ROOT_KEY_FINGERPRINT,
    issuer_root_key_digest: ROOT_KEY_DIGEST,
    reason_code: 'SECURITY',
    issued_at: '2026-09-09T12:00:00.000Z',
    effective_at: '2026-09-09T12:00:00.000Z',
    ...overrides
  };
}

function validRevocation(overrides = {}) {
  return buildAuthorityGrantRevocation(revocationInput(overrides));
}

function validation(overrides = {}) {
  return validateAuthorityGrantRevocation({
    ...validRevocation(),
    ...overrides
  });
}

test('builds a valid immutable revocation with target and root bindings', () => {
  const revocation = validRevocation();

  assert.deepEqual(validateAuthorityGrantRevocation(revocation), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(revocation).sort(), [...AUTHORITY_GRANT_REVOCATION_FIELDS].sort());
  assert.equal(revocation.contract_version, CONTRACT_VERSION);
  assert.equal(revocation.revocation_domain, REVOCATION_DOMAIN);
  assert.ok(REVOCATION_REASON_CODES.includes(revocation.reason_code));
  assert.match(revocation.revocation_digest, /^sha256:[0-9a-f]{64}$/);
});

test('serialization and digest are deterministic and independent of input field order', () => {
  const source = revocationInput();
  const reordered = {};
  for (const key of Object.keys(source).reverse()) reordered[key] = source[key];

  const first = validRevocation();
  const second = buildAuthorityGrantRevocation(reordered);
  assert.deepEqual(canonicalAuthorityGrantRevocationBytes(first), canonicalAuthorityGrantRevocationBytes(second));
  assert.equal(authorityGrantRevocationDigest(first), authorityGrantRevocationDigest(second));
  assert.equal(authorityGrantRevocationDigest(first), first.revocation_digest);
});

test('rejects unknown fields, versions, domains, and malformed objects', () => {
  assert.equal(validation({ unknown_field: true }).valid, false);
  assert.equal(validation({ contract_version: 'v0' }).valid, false);
  assert.equal(validation({ revocation_domain: 'OTHER_DOMAIN' }).valid, false);
  assert.equal(validateAuthorityGrantRevocation(null).valid, false);
  assert.equal(validateAuthorityGrantRevocation([]).valid, false);
  assert.throws(() => buildAuthorityGrantRevocation(null), /input_must_be_object/);
});

test('rejects invalid installation, target, and root bindings fail-closed', () => {
  assert.equal(validation({ installation_id: 'other-installation' }).valid, false);
  assert.equal(validation({ target_authority_grant_id: 'target with spaces' }).valid, false);
  assert.equal(validation({ target_authority_grant_id: '' }).valid, false);
  assert.equal(validation({ target_grant_digest: 'sha256:not-a-digest' }).valid, false);
  assert.equal(validation({ issuer_root_subject_id: 'governance-root::other-installation' }).valid, false);
  assert.equal(validation({ issuer_root_generation: -1 }).valid, false);
  assert.equal(validation({ issuer_root_generation: 1.5 }).valid, false);
  assert.equal(validation({ issuer_root_digest: 'sha256:not-a-digest' }).valid, false);
  assert.equal(validation({ issuer_root_key_id: '' }).valid, false);
  assert.equal(validation({ issuer_root_key_fingerprint: 'sha256:not-a-fingerprint' }).valid, false);
  assert.equal(validation({ issuer_root_key_digest: 'sha256:not-a-key-digest' }).valid, false);
});

test('rejects unknown or malformed reason codes', () => {
  assert.equal(validation({ reason_code: 'UNKNOWN_REASON' }).valid, false);
  assert.equal(validation({ reason_code: '' }).valid, false);
  assert.equal(validation({ reason_code: null }).valid, false);
  assert.equal(validation({ reason_detail: 'free text' }).valid, false);
});

test('rejects malformed timestamps and invalid temporal ordering', () => {
  assert.equal(validation({ issued_at: 'not-a-timestamp' }).valid, false);
  assert.equal(validation({ effective_at: '2026-09-09T11:59:59.999Z' }).valid, false);
  assert.equal(validation({ effective_at: '2026-09-09T11:59:59.999+00:00' }).valid, false);
});

test('rejects tampered revocation digest', () => {
  const revocation = validRevocation();
  assert.equal(validateAuthorityGrantRevocation({ ...revocation, reason_code: 'COMPROMISED' }).valid, false);
  assert.equal(validateAuthorityGrantRevocation({
    ...revocation,
    revocation_digest: `sha256:${'f'.repeat(64)}`
  }).valid, false);
});

test('changes to every revocation material field change the deterministic digest', () => {
  const revocation = validRevocation();
  const mutations = {
    contract_version: 'other-version',
    revocation_domain: 'OTHER_DOMAIN',
    authority_grant_revocation_id: 'authority-grant-revocation-2',
    installation_id: 'installation-revocation-other',
    target_authority_grant_id: 'authority-grant-2',
    target_grant_digest: `sha256:${'5'.repeat(64)}`,
    issuer_root_subject_id: 'governance-root::installation-revocation-other',
    issuer_root_generation: 1,
    issuer_root_digest: `sha256:${'6'.repeat(64)}`,
    issuer_root_key_id: 'root-key-1',
    issuer_root_key_fingerprint: `sha256:${'7'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'8'.repeat(64)}`,
    reason_code: 'COMPROMISED',
    issued_at: '2026-09-09T12:00:01.000Z',
    effective_at: '2026-09-09T12:00:01.000Z'
  };

  for (const [field, value] of Object.entries(mutations)) {
    assert.notEqual(authorityGrantRevocationDigest({ ...revocation, [field]: value }), revocation.revocation_digest, field);
  }
});

test('built revocations are deeply immutable and reject cyclic malformed input', () => {
  const revocation = validRevocation();

  assert.equal(Object.isFrozen(revocation), true);
  assert.throws(() => { revocation.reason_code = 'OTHER'; }, TypeError);
  const cyclic = revocationInput();
  cyclic.cycle = cyclic;
  assert.throws(() => buildAuthorityGrantRevocation(cyclic), /cyclic_reference_not_serializable/);
});
