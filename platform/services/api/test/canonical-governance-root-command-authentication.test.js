'use strict';

const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const test = require('node:test');

const {
  ALGORITHM,
  COMMAND_DOMAIN,
  CONTRACT_VERSION,
  buildCommandEnvelope,
  canonicalSigningBytes,
  publicKeyFingerprint,
  rootKeyDigest
} = require('../src/core/canonical-governance-root-cryptographic-command-contract');
const { authenticateCanonicalGovernanceRootCommand } = require('../src/core/canonical-governance-root-command-authentication');

const ROOT_DIGEST = `sha256:${'1'.repeat(64)}`;
const NONCE = 'A'.repeat(22);
const PLACEHOLDER_SIGNATURE = 'A'.repeat(86);

function testKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const raw = spki.subarray(spki.length - 32);
  return { privateKey, publicKey: raw.toString('base64url') };
}

function signedCommand(overrides = {}) {
  const keyPair = testKeyPair();
  const base = {
    contract_version: CONTRACT_VERSION,
    domain: COMMAND_DOMAIN,
    command_id: 'command-1',
    installation_id: 'installation-1',
    root_subject_id: 'governance-root::installation-1',
    root_generation: 0,
    root_digest: ROOT_DIGEST,
    root_key_id: 'root-key-0',
    root_key_fingerprint: publicKeyFingerprint(keyPair.publicKey),
    root_key_digest: rootKeyDigest({ root_key_id: 'root-key-0', algorithm: ALGORITHM, public_key: keyPair.publicKey }),
    command_type: 'GOVERNANCE_ROOT_TEST',
    payload: { nested: { unicode: 'ação', empty: '' }, ordered: ['b', 'a'] },
    issued_at: '2026-09-08T12:00:00.000Z',
    expires_at: '2026-09-08T12:15:00.000Z',
    nonce: NONCE,
    signature_algorithm: ALGORITHM,
    signature: PLACEHOLDER_SIGNATURE,
    ...overrides
  };
  const envelope = buildCommandEnvelope(base);
  const signature = sign(null, canonicalSigningBytes(envelope), keyPair.privateKey).toString('base64url');
  return { envelope: { ...envelope, signature }, public_key: keyPair.publicKey, keyPair };
}

function authenticate(fixture) {
  return authenticateCanonicalGovernanceRootCommand({
    envelope: fixture.envelope,
    public_key: fixture.public_key
  });
}

test('authenticates a real Ed25519 signature over the canonical signing bytes', () => {
  const fixture = signedCommand();
  const result = authenticate(fixture);
  assert.deepEqual(result, {
    authenticated: true,
    status: 'AUTHENTICATED',
    reason_code: null,
    command_digest: fixture.envelope.command_digest,
    replay_identity: result.replay_identity
  });
});

test('repeated authentication of the same valid input is deterministic', () => {
  const fixture = signedCommand();
  assert.deepEqual(authenticate(fixture), authenticate(fixture));
});

test('rejects invalid signatures and signature bit flips', () => {
  const fixture = signedCommand();
  const flippedSignature = Buffer.from(fixture.envelope.signature, 'base64url');
  flippedSignature[0] ^= 1;
  const flipped = { ...fixture, envelope: { ...fixture.envelope, signature: flippedSignature.toString('base64url') } };
  assert.equal(authenticate(fixture).authenticated, true);
  assert.deepEqual(authenticate(flipped), { authenticated: false, status: 'REJECTED', reason_code: 'INVALID_SIGNATURE' });
});

test('rejects mutations of signed command material before cryptographic verification', () => {
  const fixture = signedCommand();
  for (const [field, value] of [
    ['payload', { changed: true }],
    ['command_id', 'command-2'],
    ['nonce', 'B'.repeat(22)],
    ['root_subject_id', 'governance-root::installation-2'],
    ['root_generation', 1],
    ['issued_at', '2026-09-08T12:01:00.000Z'],
    ['expires_at', '2026-09-08T12:16:00.000Z']
  ]) {
    assert.equal(authenticate({ ...fixture, envelope: { ...fixture.envelope, [field]: value } }).authenticated, false, field);
  }
});

test('rejects wrong public keys and fingerprint mutations', () => {
  const fixture = signedCommand();
  const other = testKeyPair();
  assert.deepEqual(authenticate({ ...fixture, public_key: other.publicKey }), {
    authenticated: false, status: 'REJECTED', reason_code: 'PUBLIC_KEY_FINGERPRINT_MISMATCH'
  });

  const wrongFingerprint = signedCommand({ root_key_fingerprint: publicKeyFingerprint(other.publicKey) });
  assert.deepEqual(authenticate(wrongFingerprint), {
    authenticated: false, status: 'REJECTED', reason_code: 'PUBLIC_KEY_FINGERPRINT_MISMATCH'
  });
});

test('rejects malformed public key encodings and lengths', () => {
  const fixture = signedCommand();
  for (const publicKey of [
    `${fixture.public_key}=`,
    `${fixture.public_key} `,
    'not-base64url',
    'A'.repeat(42),
    'A'.repeat(44),
    '0'.repeat(64),
    '-----BEGIN PUBLIC KEY-----'
  ]) {
    assert.deepEqual(authenticate({ ...fixture, public_key: publicKey }), {
      authenticated: false, status: 'REJECTED', reason_code: 'INVALID_PUBLIC_KEY'
    });
  }
});

test('rejects malformed signatures and unsupported algorithms through the command contract', () => {
  const fixture = signedCommand();
  for (const signature of [PLACEHOLDER_SIGNATURE.slice(0, -1), `${PLACEHOLDER_SIGNATURE}=`, 'not-base64url']) {
    assert.deepEqual(authenticate({ ...fixture, envelope: { ...fixture.envelope, signature } }), {
      authenticated: false, status: 'REJECTED', reason_code: 'INVALID_COMMAND_CONTRACT'
    });
  }
  assert.deepEqual(authenticate({ ...fixture, envelope: { ...fixture.envelope, signature_algorithm: 'RSA' } }), {
    authenticated: false, status: 'REJECTED', reason_code: 'INVALID_COMMAND_CONTRACT'
  });
});

test('rejects wrong domain, version, unknown fields and digest mutations', () => {
  const fixture = signedCommand();
  for (const envelope of [
    { ...fixture.envelope, domain: 'OTHER_DOMAIN' },
    { ...fixture.envelope, contract_version: 'unknown' },
    { ...fixture.envelope, unknown: true },
    { ...fixture.envelope, command_digest: `sha256:${'2'.repeat(64)}` }
  ]) {
    assert.deepEqual(authenticate({ ...fixture, envelope }), {
      authenticated: false, status: 'REJECTED', reason_code: 'INVALID_COMMAND_CONTRACT'
    });
  }
});

test('rejects structurally inconsistent root binding even when the envelope is signed', () => {
  const fixture = signedCommand({ root_subject_id: 'not-a-canonical-root' });
  assert.deepEqual(authenticate(fixture), {
    authenticated: false, status: 'REJECTED', reason_code: 'ROOT_BINDING_MISMATCH'
  });
});

test('rejects missing or extra authentication input fields and serializer failures', () => {
  const fixture = signedCommand();
  assert.deepEqual(authenticateCanonicalGovernanceRootCommand({ envelope: fixture.envelope }), {
    authenticated: false, status: 'REJECTED', reason_code: 'INVALID_AUTHENTICATION_INPUT'
  });
  assert.deepEqual(authenticateCanonicalGovernanceRootCommand({ envelope: fixture.envelope, public_key: fixture.public_key, extra: true }), {
    authenticated: false, status: 'REJECTED', reason_code: 'INVALID_AUTHENTICATION_INPUT'
  });
  assert.equal(authenticateCanonicalGovernanceRootCommand({ envelope: { ...fixture.envelope, payload: { invalid: undefined } }, public_key: fixture.public_key }).authenticated, false);
});
