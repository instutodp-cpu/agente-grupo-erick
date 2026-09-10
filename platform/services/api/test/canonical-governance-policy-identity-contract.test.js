'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONTRACT_VERSION,
  GOVERNANCE_POLICY_IDENTITY_FIELDS,
  POLICY_IDENTITY_DOMAIN,
  buildGovernancePolicyIdentity,
  canonicalGovernancePolicyIdentityBytes,
  governancePolicyIdentityDigest,
  validateGovernancePolicyIdentity
} = require('../src/core/canonical-governance-policy-identity-contract');

const VALID_ID = 'governance-policy::policy-001';

function identity(overrides = {}) {
  return buildGovernancePolicyIdentity({ governance_policy_id: VALID_ID, ...overrides });
}

test('builds the minimal canonical Governance Policy identity', () => {
  const result = identity();
  assert.deepEqual(Object.keys(result), [...GOVERNANCE_POLICY_IDENTITY_FIELDS].sort());
  assert.equal(result.contract_version, CONTRACT_VERSION);
  assert.equal(result.policy_identity_domain, POLICY_IDENTITY_DOMAIN);
  assert.equal(result.governance_policy_id, VALID_ID);
  assert.match(result.governance_policy_digest, /^sha256:[0-9a-f]{64}$/);
});

test('canonical serialization and digest are deterministic and field-order independent', () => {
  const first = identity();
  const reordered = {
    governance_policy_digest: first.governance_policy_digest,
    governance_policy_id: first.governance_policy_id,
    policy_identity_domain: first.policy_identity_domain,
    contract_version: first.contract_version
  };
  assert.equal(canonicalGovernancePolicyIdentityBytes(first).toString('utf8'), canonicalGovernancePolicyIdentityBytes(reordered).toString('utf8'));
  assert.equal(governancePolicyIdentityDigest(first), first.governance_policy_digest);
  assert.equal(governancePolicyIdentityDigest(reordered), first.governance_policy_digest);
  assert.deepEqual(first, identity());
});

test('identity is deeply immutable and does not retain mutable input state', () => {
  const input = { governance_policy_id: VALID_ID };
  const result = buildGovernancePolicyIdentity(input);
  input.governance_policy_id = 'governance-policy::changed';
  assert.equal(result.governance_policy_id, VALID_ID);
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.governance_policy_id = 'governance-policy::changed'; }, TypeError);
});

test('material identity changes alter the digest', () => {
  const base = identity();
  const changed = identity({ governance_policy_id: 'governance-policy::policy-002' });
  assert.notEqual(base.governance_policy_digest, changed.governance_policy_digest);
});

test('rejects missing, empty, whitespace, casing, aliases, wildcard, prefix, and substring identities', () => {
  for (const governance_policy_id of [
    undefined,
    '',
    ' governance-policy::policy-001',
    'governance-policy::policy 001',
    'Governance-Policy::policy-001',
    'policy::policy-001',
    'governance::policy-001',
    'governance-policy-extra::policy-001',
    'governance-policy::*',
    'governance-policy:policy-001',
    'governance-policy::policy:001'
  ]) {
    const candidate = { contract_version: CONTRACT_VERSION, policy_identity_domain: POLICY_IDENTITY_DOMAIN, governance_policy_id, governance_policy_digest: 'sha256:' + '0'.repeat(64) };
    assert.equal(validateGovernancePolicyIdentity(candidate).valid, false, String(governance_policy_id));
  }
});

test('rejects malformed contract, unknown fields, aliases, lifecycle, and operation fields', () => {
  const valid = identity();
  for (const [field, value] of [
    ['unknown_field', true],
    ['policy_id', VALID_ID],
    ['policy_name', 'display-name'],
    ['policy_type', 'SYSTEM_POLICY'],
    ['policy_version', 1],
    ['policy_status', 'DRAFT'],
    ['lifecycle_state', 'DRAFT'],
    ['operation', 'POLICY_CREATE'],
    ['policy_authorized', true]
  ]) {
    assert.equal(validateGovernancePolicyIdentity({ ...valid, [field]: value }).valid, false, field);
  }
  assert.equal(validateGovernancePolicyIdentity(null).valid, false);
  assert.equal(validateGovernancePolicyIdentity({}).valid, false);
  assert.equal(validateGovernancePolicyIdentity({ ...valid, contract_version: 'v2' }).valid, false);
  assert.equal(validateGovernancePolicyIdentity({ ...valid, policy_identity_domain: 'OTHER_DOMAIN' }).valid, false);
});

test('rejects tampered, malformed, and non-canonical digests', () => {
  const valid = identity();
  assert.equal(validateGovernancePolicyIdentity({ ...valid, governance_policy_digest: `sha256:${'a'.repeat(64)}` }).valid, false);
  assert.equal(validateGovernancePolicyIdentity({ ...valid, governance_policy_digest: 'SHA256:' + 'a'.repeat(64) }).valid, false);
  assert.equal(validateGovernancePolicyIdentity({ ...valid, governance_policy_digest: 'not-a-digest' }).valid, false);
});

test('rejects other policy domains and references instead of coercing them', () => {
  const candidates = [
    { policy_id: 'agent-policy-1', policy_version: 1, policy_status: 'DRAFT' },
    { target_policy_id: 'canary-policy-1', version: 1, enabled: true, revoked: false },
    { root_spec_digest: 'sha256:' + 'a'.repeat(64), authorized_action: 'OWNER_CONTROLLED_INSTALLATION_BOOTSTRAP' },
    { authority_grant_id: 'grant-1', grant_digest: 'sha256:' + 'b'.repeat(64) },
    { audit_id: 'audit-1', policy_fingerprint: 'fingerprint' },
    { policy_reference_id: 'generic-policy-1', policy_reference_fingerprint: 'fingerprint' }
  ];
  for (const candidate of candidates) {
    assert.equal(validateGovernancePolicyIdentity(candidate).valid, false);
  }
});

test('identity contract contains no lifecycle, operation, authorization, or execution outcome', () => {
  const keys = new Set(Object.keys(identity()));
  for (const forbidden of [
    'policy_status', 'lifecycle_state', 'transition', 'operation', 'authorized', 'policy_authorized',
    'approved', 'budget', 'risk', 'executed', 'dispatch'
  ]) assert.equal(keys.has(forbidden), false, forbidden);
});
