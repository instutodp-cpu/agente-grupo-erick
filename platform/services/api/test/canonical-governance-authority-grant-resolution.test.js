'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { authorityGrantDigest, buildAuthorityGrant } = require('../src/core/canonical-governance-authority-grant-contract');
const { buildAuthorityGrantRevocation } = require('../src/core/canonical-governance-authority-grant-revocation-contract');
const {
  RESOLUTION_INPUT_FIELDS,
  RESOLUTION_RESULT_FIELDS,
  RESOLUTION_STATUS,
  canonicalAuthorityGrantResolutionBytes,
  resolveCanonicalGovernanceAuthorityGrant
} = require('../src/core/canonical-governance-authority-grant-resolution');

const INSTALLATION_ID = 'installation-grant-resolution-unit';
const ROOT_SUBJECT_ID = `governance-root::${INSTALLATION_ID}`;
const GRANT_ID = 'authority-grant-resolution-unit';
const GRANT_DIGEST = `sha256:${'1'.repeat(64)}`;

function grant(overrides = {}) {
  return buildAuthorityGrant({
    authority_grant_id: GRANT_ID,
    installation_id: INSTALLATION_ID,
    issuer_root_subject_id: ROOT_SUBJECT_ID,
    issuer_root_generation: 0,
    issuer_root_digest: `sha256:${'2'.repeat(64)}`,
    issuer_root_key_id: 'root-key-resolution-unit',
    issuer_root_key_fingerprint: `sha256:${'3'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'4'.repeat(64)}`,
    subject_type: 'AGENT',
    subject_id: 'agent-resolution-unit',
    authority_scope: {
      scope_type: 'installation', installation_id: INSTALLATION_ID,
      tenant_ids: ['tenant-unit'], organization_ids: [], project_ids: [],
      cross_tenant: false, cross_organization: false, cross_project: false
    },
    capabilities: ['GOVERNANCE_AUDIT_READ'],
    restrictions: {
      allow_further_delegation: false, allow_cross_tenant: false,
      allow_cross_organization: false, allow_cross_project: false
    },
    issued_at: '2026-09-10T12:00:00.000Z',
    not_before: '2026-09-10T12:00:00.000Z',
    expires_at: '2026-09-10T12:10:00.000Z',
    ...overrides
  });
}

function revocation(target = grant(), overrides = {}) {
  return buildAuthorityGrantRevocation({
    authority_grant_revocation_id: `revocation-${overrides.reason_code || 'unit'}`,
    installation_id: target.installation_id,
    target_authority_grant_id: target.authority_grant_id,
    target_grant_digest: target.grant_digest,
    issuer_root_subject_id: `governance-root::${target.installation_id}`,
    issuer_root_generation: 0,
    issuer_root_digest: `sha256:${'5'.repeat(64)}`,
    issuer_root_key_id: 'root-key-resolution-unit',
    issuer_root_key_fingerprint: `sha256:${'6'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'7'.repeat(64)}`,
    reason_code: 'SECURITY',
    issued_at: '2026-09-10T12:00:00.000Z',
    effective_at: '2026-09-10T12:03:00.000Z',
    ...overrides
  });
}

function request(g = grant(), revocations = [], overrides = {}) {
  return {
    installation_id: g.installation_id,
    authority_grant_id: g.authority_grant_id,
    evaluation_time: '2026-09-10T12:05:00.000Z',
    grant: g,
    revocations,
    ...overrides
  };
}

test('resolution contract exposes exact input/result fields and active happy path', () => {
  assert.deepEqual(RESOLUTION_INPUT_FIELDS, [
    'installation_id', 'authority_grant_id', 'expected_grant_digest', 'evaluation_time', 'grant', 'revocations'
  ]);
  assert.equal(RESOLUTION_RESULT_FIELDS.includes('resolved_grant'), true);
  const result = resolveCanonicalGovernanceAuthorityGrant(request());
  assert.equal(result.status, RESOLUTION_STATUS.ACTIVE);
  assert.equal(result.reason_code, 'within_validity_window');
  assert.equal(result.effective_revocation_count, 0);
});

test('not-before and expiry boundaries are inclusive while outside values resolve explicitly', () => {
  const candidate = grant();
  assert.equal(resolveCanonicalGovernanceAuthorityGrant(request(candidate, [], { evaluation_time: candidate.not_before })).status, RESOLUTION_STATUS.ACTIVE);
  assert.equal(resolveCanonicalGovernanceAuthorityGrant(request(candidate, [], { evaluation_time: candidate.expires_at })).status, RESOLUTION_STATUS.ACTIVE);
  assert.equal(resolveCanonicalGovernanceAuthorityGrant(request(candidate, [], { evaluation_time: '2026-09-10T11:59:59.999Z' })).status, RESOLUTION_STATUS.NOT_YET_ACTIVE);
  assert.equal(resolveCanonicalGovernanceAuthorityGrant(request(candidate, [], { evaluation_time: '2026-09-10T12:10:00.001Z' })).status, RESOLUTION_STATUS.EXPIRED);
});

test('effective revocation at the exact effective timestamp wins over active grant', () => {
  const candidate = grant();
  const cancellation = revocation(candidate);
  const result = resolveCanonicalGovernanceAuthorityGrant(request(candidate, [cancellation], { evaluation_time: cancellation.effective_at }));
  assert.equal(result.status, RESOLUTION_STATUS.REVOKED);
  assert.equal(result.reason_code, 'effective_revocation');
  assert.deepEqual(result.effective_revocation_digests, [cancellation.revocation_digest]);
});

test('future, multiple, and mixed revocations are deterministic and only effective evidence revokes', () => {
  const candidate = grant();
  const futureA = revocation(candidate, { authority_grant_revocation_id: 'revocation-future-a', reason_code: 'OTHER', effective_at: '2026-09-10T12:06:00.000Z' });
  const futureB = revocation(candidate, { authority_grant_revocation_id: 'revocation-future-b', reason_code: 'COMPROMISED', effective_at: '2026-09-10T12:07:00.000Z' });
  const effective = revocation(candidate, { authority_grant_revocation_id: 'revocation-effective', reason_code: 'SCOPE_CHANGED', effective_at: '2026-09-10T12:04:00.000Z' });
  const first = resolveCanonicalGovernanceAuthorityGrant(request(candidate, [futureB, effective, futureA]));
  const second = resolveCanonicalGovernanceAuthorityGrant(request(candidate, [futureA, futureB, effective]));
  assert.equal(first.status, RESOLUTION_STATUS.REVOKED);
  assert.equal(first.revocation_count, 3);
  assert.equal(first.effective_revocation_count, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(canonicalAuthorityGrantResolutionBytes(first), canonicalAuthorityGrantResolutionBytes(second));
});

test('wrong target ID is irrelevant, but matching ID with a different digest rejects fail-closed', () => {
  const candidate = grant();
  const unrelated = revocation(candidate, { authority_grant_revocation_id: 'revocation-unrelated', target_authority_grant_id: 'another-grant' });
  assert.equal(resolveCanonicalGovernanceAuthorityGrant(request(candidate, [unrelated])).status, RESOLUTION_STATUS.ACTIVE);
  const mismatched = revocation(candidate, { authority_grant_revocation_id: 'revocation-mismatched-digest', target_grant_digest: `sha256:${'8'.repeat(64)}` });
  const result = resolveCanonicalGovernanceAuthorityGrant(request(candidate, [mismatched]));
  assert.equal(result.status, RESOLUTION_STATUS.REJECTED);
  assert.equal(result.reason_code, 'revocation_target_digest_mismatch');
});

test('cross-installation, malformed, tampered, and unknown caller input reject', () => {
  const candidate = grant();
  const foreign = revocation(candidate, {
    authority_grant_revocation_id: 'revocation-foreign',
    installation_id: 'other-installation',
    issuer_root_subject_id: 'governance-root::other-installation'
  });
  assert.equal(resolveCanonicalGovernanceAuthorityGrant(request(candidate, [foreign])).status, RESOLUTION_STATUS.REJECTED);
  assert.equal(resolveCanonicalGovernanceAuthorityGrant(request({ ...candidate, grant_digest: `sha256:${'f'.repeat(64)}` })).status, RESOLUTION_STATUS.REJECTED);
  assert.equal(resolveCanonicalGovernanceAuthorityGrant(request(candidate, [], { expected_grant_digest: GRANT_DIGEST })).status, RESOLUTION_STATUS.REJECTED);
  assert.equal(resolveCanonicalGovernanceAuthorityGrant({ ...request(candidate), is_authorized: true }).status, RESOLUTION_STATUS.REJECTED);
  assert.equal(resolveCanonicalGovernanceAuthorityGrant({ ...request(candidate), evaluation_time: 'not-a-timestamp' }).status, RESOLUTION_STATUS.REJECTED);
  assert.equal(resolveCanonicalGovernanceAuthorityGrant({ ...request(candidate), revocations: [{ malformed: true }] }).status, RESOLUTION_STATUS.REJECTED);
});

test('missing grant is NOT_FOUND and does not accept revocation evidence', () => {
  const base = { installation_id: INSTALLATION_ID, authority_grant_id: GRANT_ID, evaluation_time: '2026-09-10T12:05:00.000Z', grant: null, revocations: [] };
  assert.equal(resolveCanonicalGovernanceAuthorityGrant(base).status, RESOLUTION_STATUS.NOT_FOUND);
  assert.equal(resolveCanonicalGovernanceAuthorityGrant({ ...base, revocations: [revocation()] }).status, RESOLUTION_STATUS.REJECTED);
});

test('result and nested evidence are deeply immutable', () => {
  const candidate = grant();
  const result = resolveCanonicalGovernanceAuthorityGrant(request(candidate, [revocation(candidate)]));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.resolved_grant), true);
  assert.equal(Object.isFrozen(result.revocation_digests), true);
  assert.throws(() => { result.resolved_grant.subject_id = 'tampered'; }, TypeError);
});

test('every relevant grant field contributes to canonical digest', () => {
  const baseline = grant();
  const variants = [
    { authority_grant_id: 'authority-grant-resolution-unit-2' },
    { issuer_root_generation: 1 },
    { issuer_root_digest: `sha256:${'8'.repeat(64)}` },
    { issuer_root_key_id: 'root-key-resolution-unit-2' },
    { issuer_root_key_fingerprint: `sha256:${'8'.repeat(64)}` },
    { issuer_root_key_digest: `sha256:${'8'.repeat(64)}` },
    { subject_id: 'agent-resolution-unit-2' },
    { capabilities: ['GOVERNANCE_ROTATE_ROOT_KEY'] },
    { issued_at: '2026-09-10T12:00:01.000Z', not_before: '2026-09-10T12:00:01.000Z' },
    { expires_at: '2026-09-10T12:11:00.000Z' }
  ];
  for (const variant of variants) assert.notEqual(grant(variant).grant_digest, baseline.grant_digest);
  assert.notEqual(authorityGrantDigest({
    ...baseline,
    restrictions: { ...baseline.restrictions, allow_further_delegation: true }
  }), baseline.grant_digest);
});
