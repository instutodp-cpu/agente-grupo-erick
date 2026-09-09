'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildCommandEnvelope, replayIdentity, publicKeyFingerprint, rootKeyDigest } = require('../src/core/canonical-governance-root-cryptographic-command-contract');
const {
  RESOLUTION_STATUS,
  validateResolutionInput
} = require('../src/core/canonical-governance-root-active-authority-resolution-contract');
const { createCanonicalGovernanceRootActiveAuthorityResolutionPostgres } = require('../src/adapters/postgres/canonical-governance-root-active-authority-resolution-postgres');

const PUBLIC_KEY = 'A'.repeat(43);
const ROOT_DIGEST = `sha256:${'1'.repeat(64)}`;
const ROOT_KEY_DIGEST = rootKeyDigest({ root_key_id: 'root-key-0', algorithm: 'Ed25519', public_key: PUBLIC_KEY });

function envelope() {
  return buildCommandEnvelope({
    command_id: 'command-1', installation_id: 'installation-1', root_subject_id: 'governance-root::installation-1',
    root_generation: 0, root_digest: ROOT_DIGEST, root_key_id: 'root-key-0',
    root_key_fingerprint: publicKeyFingerprint(PUBLIC_KEY), root_key_digest: ROOT_KEY_DIGEST,
    command_type: 'GOVERNANCE_ROOT_TEST', payload: { target: 'delegation-contract' },
    issued_at: '2026-09-08T12:00:00.000Z', expires_at: '2026-09-08T12:15:00.000Z',
    nonce: 'A'.repeat(22), signature_algorithm: 'Ed25519', signature: 'A'.repeat(86)
  });
}

function authentication(command) {
  return {
    authenticated: true, status: 'AUTHENTICATED', reason_code: null,
    command_digest: command.command_digest, replay_identity: replayIdentity(command)
  };
}

function fakePool(responses, calls = []) {
  return {
    async connect() {
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          const response = responses.shift();
          if (response instanceof Error) throw response;
          return response || { rowCount: 0, rows: [] };
        },
        release() { calls.push({ released: true }); }
      };
    }
  };
}

function validResponses() {
  return [
    { rowCount: 0, rows: [] },
    { rowCount: 1, rows: [{ installation_id: 'installation-1', lifecycle_state: 'BOOTSTRAPPED' }] },
    { rowCount: 1, rows: [{ installation_id: 'installation-1', root_subject_id: 'governance-root::installation-1', root_digest: ROOT_DIGEST, active_generation: 0, lifecycle_state: 'ACTIVE' }] },
    { rowCount: 1, rows: [{ root_key_id: 'root-key-0', root_subject_id: 'governance-root::installation-1', generation: 0, algorithm: 'Ed25519', public_key: PUBLIC_KEY, key_fingerprint: publicKeyFingerprint(PUBLIC_KEY), key_digest: ROOT_KEY_DIGEST, lifecycle_state: 'ACTIVE' }] },
    { rowCount: 1, rows: [] }
  ];
}

test('requires a structurally valid authenticated predecessor result', () => {
  const command = envelope();
  assert.equal(validateResolutionInput({ envelope: command, authentication: authentication(command) }).valid, true);
  assert.equal(validateResolutionInput({ envelope: command, authentication: { ...authentication(command), authenticated: false } }).reason_code, 'AUTHENTICATION_REQUIRED');
  assert.equal(validateResolutionInput({ envelope: command, authentication: authentication(command), extra: true }).reason_code, 'INVALID_RESOLUTION_INPUT');
});

test('resolves the persisted active root deterministically without writes', async () => {
  const command = envelope();
  const calls = [];
  const resolver = createCanonicalGovernanceRootActiveAuthorityResolutionPostgres({ pool: fakePool([...validResponses(), ...validResponses()], calls) });
  const first = await resolver.resolve({ envelope: command, authentication: authentication(command) });
  const second = await resolver.resolve({ envelope: command, authentication: authentication(command) });
  assert.equal(first.resolved, true);
  assert.equal(first.status, RESOLUTION_STATUS.RESOLVED);
  assert.deepEqual(first, second);
  assert.equal(calls.filter((call) => /INSERT|UPDATE|DELETE/i.test(call.sql || '')).length, 0);
});

test('rejects missing authentication before acquiring PostgreSQL', async () => {
  let connected = false;
  const resolver = createCanonicalGovernanceRootActiveAuthorityResolutionPostgres({
    pool: { async connect() { connected = true; throw new Error('must-not-connect'); } }
  });
  const result = await resolver.resolve({ envelope: envelope(), authentication: null });
  assert.deepEqual(result, { resolved: false, status: 'REJECTED', reason_code: 'AUTHENTICATION_REQUIRED' });
  assert.equal(connected, false);
});

test('fails closed for installation, root, key, ambiguity and database errors', async () => {
  const command = envelope();
  const cases = [
    [[{ rowCount: 0, rows: [] }], 'UNKNOWN_INSTALLATION'],
    [[{ rowCount: 1, rows: [{ lifecycle_state: 'SUSPENDED' }] }], 'INSTALLATION_NOT_ACTIVE'],
    [[{ rowCount: 1, rows: [{ lifecycle_state: 'BOOTSTRAPPED' }] }, { rowCount: 0, rows: [] }], 'ROOT_NOT_FOUND'],
    [[{ rowCount: 1, rows: [{ lifecycle_state: 'BOOTSTRAPPED' }] }, { rowCount: 2, rows: [] }], 'STATE_AMBIGUOUS'],
    [[{ rowCount: 1, rows: [{ lifecycle_state: 'BOOTSTRAPPED' }] }, { rowCount: 1, rows: [{ installation_id: 'installation-1', root_subject_id: command.root_subject_id, root_digest: ROOT_DIGEST, active_generation: 0, lifecycle_state: 'ACTIVE' }] }, { rowCount: 0, rows: [] }], 'ROOT_KEY_NOT_FOUND'],
    [[new Error('database unavailable')], 'DATABASE_READ_FAILED']
  ];
  for (const [responses, reason] of cases) {
    const resolver = createCanonicalGovernanceRootActiveAuthorityResolutionPostgres({ pool: fakePool([{ rowCount: 0, rows: [] }, ...responses]) });
    const result = await resolver.resolve({ envelope: command, authentication: authentication(command) });
    assert.equal(result.reason_code, reason);
  }
});

test('rejects key identity, fingerprint, digest and lifecycle inconsistencies', async () => {
  const command = envelope();
  const root = { rowCount: 1, rows: [{ installation_id: 'installation-1', root_subject_id: command.root_subject_id, root_digest: ROOT_DIGEST, active_generation: 0, lifecycle_state: 'ACTIVE' }] };
  const baseKey = { root_key_id: 'root-key-0', root_subject_id: command.root_subject_id, generation: 0, algorithm: 'Ed25519', public_key: PUBLIC_KEY, key_fingerprint: publicKeyFingerprint(PUBLIC_KEY), key_digest: ROOT_KEY_DIGEST, lifecycle_state: 'ACTIVE' };
  for (const [override, reason] of [
    [{ root_key_id: 'other-key' }, 'ROOT_KEY_MISMATCH'],
    [{ key_fingerprint: `sha256:${'2'.repeat(64)} ` }, 'ROOT_KEY_FINGERPRINT_MISMATCH'],
    [{ key_digest: `sha256:${'2'.repeat(64)}` }, 'ROOT_KEY_DIGEST_MISMATCH'],
    [{ algorithm: 'RSA' }, 'ROOT_KEY_INVALID']
  ]) {
    const resolver = createCanonicalGovernanceRootActiveAuthorityResolutionPostgres({ pool: fakePool([{ rowCount: 0, rows: [] }, { rowCount: 1, rows: [{ installation_id: 'installation-1', lifecycle_state: 'BOOTSTRAPPED' }] }, root, { rowCount: 1, rows: [{ ...baseKey, ...override }] }]) });
    const result = await resolver.resolve({ envelope: command, authentication: authentication(command) });
    assert.equal(result.reason_code, reason);
  }
});

test('distinguishes root subject and root digest mismatches', async () => {
  const command = envelope();
  const installation = { rowCount: 1, rows: [{ installation_id: 'installation-1', lifecycle_state: 'BOOTSTRAPPED' }] };
  const key = { root_key_id: 'root-key-0', root_subject_id: command.root_subject_id, generation: 0, algorithm: 'Ed25519', public_key: PUBLIC_KEY, key_fingerprint: publicKeyFingerprint(PUBLIC_KEY), key_digest: ROOT_KEY_DIGEST, lifecycle_state: 'ACTIVE' };
  const root = { installation_id: 'installation-1', root_subject_id: command.root_subject_id, root_digest: ROOT_DIGEST, active_generation: 0, lifecycle_state: 'ACTIVE' };
  for (const [rootOverride, reason] of [
    [{ root_subject_id: 'governance-root::other-installation' }, 'ROOT_SUBJECT_MISMATCH'],
    [{ root_digest: `sha256:${'2'.repeat(64)}` }, 'ROOT_DIGEST_MISMATCH']
  ]) {
    const resolver = createCanonicalGovernanceRootActiveAuthorityResolutionPostgres({
      pool: fakePool([{ rowCount: 0, rows: [] }, installation, { rowCount: 1, rows: [{ ...root, ...rootOverride }] }, { rowCount: 1, rows: [key] }])
    });
    const result = await resolver.resolve({ envelope: command, authentication: authentication(command) });
    assert.equal(result.reason_code, reason);
  }
});
