'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUTHORITY_GRANT_CAPABILITIES,
  AUTHORITY_GRANT_FIELDS,
  CONTRACT_VERSION,
  GRANT_DOMAIN,
  authorityGrantDigest,
  buildAuthorityGrant,
  canonicalAuthorityGrantBytes,
  validateAuthorityGrant
} = require('../src/core/canonical-governance-authority-grant-contract');
const { ROOT_CAPABILITIES } = require('../src/core/canonical-governance-root-bootstrap-contract');

const INSTALLATION_ID = 'installation-grant-test';
const ROOT_SUBJECT_ID = `governance-root::${INSTALLATION_ID}`;
const ROOT_DIGEST = `sha256:${'1'.repeat(64)}`;
const ROOT_KEY_FINGERPRINT = `sha256:${'2'.repeat(64)}`;
const ROOT_KEY_DIGEST = `sha256:${'3'.repeat(64)}`;

function grantInput(overrides = {}) {
  return {
    authority_grant_id: 'authority-grant-1',
    installation_id: INSTALLATION_ID,
    issuer_root_subject_id: ROOT_SUBJECT_ID,
    issuer_root_generation: 0,
    issuer_root_digest: ROOT_DIGEST,
    issuer_root_key_id: 'root-key-0',
    issuer_root_key_fingerprint: ROOT_KEY_FINGERPRINT,
    issuer_root_key_digest: ROOT_KEY_DIGEST,
    subject_type: 'AGENT',
    subject_id: 'agent-delegate-1',
    authority_scope: {
      scope_type: 'installation',
      installation_id: INSTALLATION_ID,
      tenant_ids: ['tenant-1'],
      organization_ids: [],
      project_ids: [],
      cross_tenant: false,
      cross_organization: false,
      cross_project: false
    },
    capabilities: ['GOVERNANCE_AUDIT_READ', 'GOVERNANCE_REVOKE_AUTHORITY'],
    restrictions: {
      allow_further_delegation: false,
      allow_cross_tenant: false,
      allow_cross_organization: false,
      allow_cross_project: false
    },
    issued_at: '2026-09-09T12:00:00.000Z',
    not_before: '2026-09-09T12:00:00.000Z',
    expires_at: '2026-09-10T12:00:00.000Z',
    ...overrides
  };
}

function validGrant(overrides = {}) {
  return buildAuthorityGrant(grantInput(overrides));
}

function validation(overrides = {}) {
  return validateAuthorityGrant({
    ...validGrant(),
    ...overrides
  });
}

test('builds a valid bounded grant with the root binding and canonical evidence', () => {
  const grant = validGrant();

  assert.deepEqual(validateAuthorityGrant(grant), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(grant).sort(), [...AUTHORITY_GRANT_FIELDS].sort());
  assert.equal(grant.contract_version, CONTRACT_VERSION);
  assert.equal(grant.grant_domain, GRANT_DOMAIN);
  assert.ok(ROOT_CAPABILITIES.includes(grant.capabilities[0]));
  assert.ok(grant.capabilities.every((capability) => AUTHORITY_GRANT_CAPABILITIES.includes(capability)));
  assert.match(grant.grant_digest, /^sha256:[0-9a-f]{64}$/);
});

test('serialization and digest are deterministic and independent of input field order', () => {
  const source = grantInput();
  const reordered = {};
  for (const key of Object.keys(source).reverse()) {
    const value = source[key];
    if (key === 'authority_scope') {
      reordered[key] = {};
      for (const nestedKey of Object.keys(value).reverse()) reordered[key][nestedKey] = value[nestedKey];
    } else if (key === 'restrictions') {
      reordered[key] = {};
      for (const nestedKey of Object.keys(value).reverse()) reordered[key][nestedKey] = value[nestedKey];
    } else {
      reordered[key] = value;
    }
  }

  const first = buildAuthorityGrant(source);
  const second = buildAuthorityGrant(reordered);
  assert.deepEqual(canonicalAuthorityGrantBytes(first), canonicalAuthorityGrantBytes(second));
  assert.equal(authorityGrantDigest(first), authorityGrantDigest(second));
  assert.equal(authorityGrantDigest(first), first.grant_digest);
});

test('rejects unknown fields, versions, domains, and unsupported parent/nonce material', () => {
  assert.equal(validation({ unknown_field: true }).valid, false);
  assert.equal(validation({ contract_version: 'v0' }).valid, false);
  assert.equal(validation({ grant_domain: 'OTHER_DOMAIN' }).valid, false);
  assert.throws(() => buildAuthorityGrant({ ...grantInput(), parent_authority_reference: null }), /authority_grant_invalid/);
  assert.throws(() => buildAuthorityGrant({ ...grantInput(), nonce: 'nonce' }), /authority_grant_invalid/);
});

test('rejects invalid installation and issuer root bindings fail-closed', () => {
  assert.equal(validation({ installation_id: 'other-installation' }).valid, false);
  assert.equal(validation({ issuer_root_subject_id: 'governance-root::other-installation' }).valid, false);
  assert.equal(validation({ issuer_root_generation: -1 }).valid, false);
  assert.equal(validation({ issuer_root_generation: 1.5 }).valid, false);
  assert.equal(validation({ issuer_root_digest: 'sha256:not-a-digest' }).valid, false);
  assert.equal(validation({ issuer_root_key_fingerprint: 'sha256:not-a-fingerprint' }).valid, false);
  assert.equal(validation({ issuer_root_key_digest: 'sha256:not-a-key-digest' }).valid, false);
  assert.equal(validation({ issuer_root_key_id: '' }).valid, false);
  assert.equal(validation({ authority_scope: { ...validGrant().authority_scope, installation_id: 'other-installation' } }).valid, false);
});

test('rejects invalid subjects and self-grants', () => {
  assert.equal(validation({ subject_type: 'UNKNOWN' }).valid, false);
  assert.equal(validation({ subject_id: '' }).valid, false);
  assert.equal(validation({ subject_id: ROOT_SUBJECT_ID }).valid, false);
  assert.equal(validation({ subject_id: 'subject with spaces' }).valid, false);
});

test('rejects empty, duplicate, unknown, delegated, and non-canonical capabilities', () => {
  assert.equal(validation({ capabilities: [] }).valid, false);
  assert.equal(validation({ capabilities: ['GOVERNANCE_AUDIT_READ', 'GOVERNANCE_AUDIT_READ'] }).valid, false);
  assert.equal(validation({ capabilities: ['UNKNOWN_CAPABILITY'] }).valid, false);
  assert.equal(validation({ capabilities: ['GOVERNANCE_REVOKE_AUTHORITY', 'GOVERNANCE_AUDIT_READ'] }).valid, false);
  assert.equal(validation({ capabilities: ['GOVERNANCE_DELEGATE_AUTHORITY'] }).valid, false);
});

test('rejects invalid restrictions and ambiguous or widening scopes', () => {
  assert.equal(validation({ restrictions: { ...validGrant().restrictions, allow_cross_tenant: true } }).valid, false);
  assert.equal(validation({ restrictions: { ...validGrant().restrictions, unknown: false } }).valid, false);
  assert.equal(validation({ restrictions: { ...validGrant().restrictions, allow_cross_project: 'false' } }).valid, false);
  assert.equal(validation({ authority_scope: { ...validGrant().authority_scope, tenant_ids: [], organization_ids: [], project_ids: [] } }).valid, false);
  assert.equal(validation({ authority_scope: { ...validGrant().authority_scope, tenant_ids: ['*'] } }).valid, false);
  assert.equal(validation({ authority_scope: { ...validGrant().authority_scope, tenant_ids: ['tenant-2', 'tenant-1'] } }).valid, false);
  assert.equal(validation({ authority_scope: { ...validGrant().authority_scope, tenant_ids: ['tenant-1', 'tenant-1'] } }).valid, false);
  assert.equal(validation({ authority_scope: { ...validGrant().authority_scope, cross_tenant: true } }).valid, false);
});

test('rejects malformed and non-canonical validity windows without consulting runtime time', () => {
  assert.equal(validateAuthorityGrant(null).valid, false);
  assert.equal(validation({ issued_at: 'not-a-timestamp' }).valid, false);
  assert.equal(validation({ not_before: '2026-09-09T11:59:59.000Z' }).valid, false);
  assert.equal(validation({ expires_at: '2026-09-09T12:00:00.000Z' }).valid, false);
  assert.equal(validation({ expires_at: '2026-09-09T11:00:00.000Z' }).valid, false);
  assert.equal(validation({ expires_at: '2026-09-09T12:00:00.001+00:00' }).valid, false);
});

test('changes to each grant material field change the deterministic digest', () => {
  const grant = validGrant();
  const mutations = {
    contract_version: 'other-version',
    grant_domain: 'OTHER_DOMAIN',
    authority_grant_id: 'authority-grant-2',
    installation_id: 'installation-grant-other',
    issuer_root_subject_id: 'governance-root::installation-grant-other',
    issuer_root_generation: 1,
    issuer_root_digest: `sha256:${'4'.repeat(64)}`,
    issuer_root_key_id: 'root-key-1',
    issuer_root_key_fingerprint: `sha256:${'5'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'6'.repeat(64)}`,
    subject_type: 'USER',
    subject_id: 'user-delegate-1',
    authority_scope: { ...grant.authority_scope, tenant_ids: ['tenant-2'] },
    capabilities: ['GOVERNANCE_AUDIT_READ'],
    restrictions: { ...grant.restrictions, allow_cross_project: true },
    issued_at: '2026-09-09T12:00:01.000Z',
    not_before: '2026-09-09T12:00:01.000Z',
    expires_at: '2026-09-11T12:00:00.000Z'
  };

  for (const [field, value] of Object.entries(mutations)) {
    const mutated = { ...grant, [field]: value };
    assert.notEqual(authorityGrantDigest(mutated), grant.grant_digest, field);
  }
});

test('built grants are deeply immutable', () => {
  const grant = validGrant();

  assert.equal(Object.isFrozen(grant), true);
  assert.equal(Object.isFrozen(grant.authority_scope), true);
  assert.equal(Object.isFrozen(grant.capabilities), true);
  assert.equal(Object.isFrozen(grant.restrictions), true);
  assert.throws(() => {
    grant.subject_id = 'mutated';
  }, TypeError);
  assert.throws(() => {
    grant.authority_scope.tenant_ids.push('tenant-2');
  }, TypeError);
});

test('cyclic or binary malformed input cannot become canonical grant material', () => {
  const cyclic = grantInput();
  cyclic.authority_scope.cycle = cyclic;
  assert.throws(() => buildAuthorityGrant(cyclic), /cyclic_reference_not_serializable/);
  assert.equal(validateAuthorityGrant({ ...validGrant(), issuer_root_digest: Buffer.from('digest') }).valid, false);
});
