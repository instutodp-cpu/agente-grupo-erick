'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AUTHORIZATION_REQUEST_DOMAIN,
  AUTHORIZATION_REQUEST_FIELDS,
  AUTHORITY_GRANT_CAPABILITIES,
  CONTRACT_VERSION,
  authorizationRequestDigest,
  buildAuthorizationRequest,
  canonicalAuthorizationRequestBytes,
  validateAuthorizationRequest
} = require('../src/core/canonical-governance-authorization-request-contract');

const INSTALLATION_ID = 'installation-authorization-request-test';

function requestInput(overrides = {}) {
  return {
    authorization_request_id: 'authorization-request-1',
    installation_id: INSTALLATION_ID,
    subject_type: 'AGENT',
    subject_id: 'agent-requester-1',
    requested_capability: 'GOVERNANCE_AUDIT_READ',
    requested_scope: {
      scope_type: 'installation',
      installation_id: INSTALLATION_ID,
      tenant_ids: ['tenant-1'],
      organization_ids: [],
      project_ids: [],
      cross_tenant: false,
      cross_organization: false,
      cross_project: false
    },
    source_command_id: null,
    source_command_digest: null,
    ...overrides
  };
}

function validRequest(overrides = {}) {
  return buildAuthorizationRequest(requestInput(overrides));
}

function validation(overrides = {}) {
  return validateAuthorizationRequest({ ...validRequest(), ...overrides });
}

test('builds a canonical request with explicit subject, capability, scope, and installation', () => {
  const request = validRequest();

  assert.deepEqual(validateAuthorizationRequest(request), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(request).sort(), [...AUTHORIZATION_REQUEST_FIELDS].sort());
  assert.equal(request.contract_version, CONTRACT_VERSION);
  assert.equal(request.authorization_request_domain, AUTHORIZATION_REQUEST_DOMAIN);
  assert.ok(AUTHORITY_GRANT_CAPABILITIES.includes(request.requested_capability));
  assert.match(request.authorization_request_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(request.source_command_id, null);
  assert.equal(request.source_command_digest, null);
});

test('canonical serialization and digest are deterministic and independent of input field order', () => {
  const source = requestInput();
  const reordered = {};
  for (const key of Object.keys(source).reverse()) {
    const value = source[key];
    if (key === 'requested_scope') {
      reordered[key] = {};
      for (const nestedKey of Object.keys(value).reverse()) reordered[key][nestedKey] = value[nestedKey];
    } else {
      reordered[key] = value;
    }
  }

  const first = validRequest();
  const second = buildAuthorizationRequest(reordered);
  assert.deepEqual(canonicalAuthorizationRequestBytes(first), canonicalAuthorizationRequestBytes(second));
  assert.equal(authorizationRequestDigest(first), authorizationRequestDigest(second));
  assert.equal(authorizationRequestDigest(first), first.authorization_request_digest);
});

test('built requests are deeply immutable', () => {
  const request = validRequest();

  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.requested_scope), true);
  assert.equal(Object.isFrozen(request.requested_scope.tenant_ids), true);
  assert.throws(() => {
    request.subject_id = 'mutated-subject';
  }, TypeError);
  assert.throws(() => {
    request.requested_scope.tenant_ids.push('tenant-2');
  }, TypeError);
});

test('every material subject, capability, scope, and installation mutation changes the digest', () => {
  const request = validRequest();
  const mutations = {
    subject_id: 'agent-requester-2',
    requested_capability: 'GOVERNANCE_REVOKE_AUTHORITY',
    requested_scope: { ...request.requested_scope, tenant_ids: ['tenant-2'] },
    installation_id: 'installation-authorization-request-other'
  };

  for (const [field, value] of Object.entries(mutations)) {
    const mutated = { ...request, [field]: value };
    assert.notEqual(authorizationRequestDigest(mutated), request.authorization_request_digest, field);
  }
});

test('rejects unknown fields, authority booleans, invalid version/domain, and unknown capability', () => {
  assert.equal(validation({ unknown_field: true }).valid, false);
  assert.equal(validation({ requested_action: 'GOVERNANCE_AUDIT_READ' }).valid, false);
  for (const field of [
    'authenticated', 'is_authenticated', 'authorized', 'is_authorized',
    'grant_active', 'scope_matches', 'capability_matches', 'approved'
  ]) {
    assert.equal(validation({ [field]: true }).valid, false, field);
  }
  assert.equal(validation({ contract_version: 'v0' }).valid, false);
  assert.equal(validation({ authorization_request_domain: 'OTHER_DOMAIN' }).valid, false);
  assert.equal(validation({ requested_capability: 'UNKNOWN_CAPABILITY' }).valid, false);
});

test('rejects malformed subject, installation, and source command binding', () => {
  assert.equal(validation({ subject_type: 'UNKNOWN' }).valid, false);
  assert.equal(validation({ subject_id: '' }).valid, false);
  assert.equal(validation({ subject_id: 'subject with spaces' }).valid, false);
  assert.equal(validation({ installation_id: '' }).valid, false);
  assert.equal(validation({ source_command_id: 'command-1' }).valid, false);
  assert.equal(validation({ source_command_digest: 'sha256:not-a-digest' }).valid, false);
  assert.equal(buildAuthorizationRequest({
    ...requestInput(),
    source_command_id: 'command-1',
    source_command_digest: `sha256:${'a'.repeat(64)}`
  }) !== undefined, true);
});

test('reuses the bounded #186 scope semantics and rejects malformed or ambiguous scope', () => {
  const base = validRequest().requested_scope;
  assert.equal(validation({ requested_scope: null }).valid, false);
  assert.equal(validation({ requested_scope: { ...base, tenant_ids: ['tenant-2', 'tenant-1'] } }).valid, false);
  assert.equal(validation({ requested_scope: { ...base, tenant_ids: ['tenant-1', 'tenant-1'] } }).valid, false);
  assert.equal(validation({ requested_scope: { ...base, tenant_ids: ['*'] } }).valid, false);
  assert.equal(validation({ requested_scope: { ...base, tenant_ids: [], organization_ids: [], project_ids: [] } }).valid, false);
  assert.equal(validation({ requested_scope: { ...base, installation_id: 'other-installation' } }).valid, false);
  assert.equal(validation({ requested_scope: { ...base, unknown_selector: ['tenant-1'] } }).valid, false);
  assert.equal(validation({ requested_scope: { ...base, cross_tenant: true } }).valid, false);
});

test('rejects tampered or malformed request digests and cyclic material', () => {
  const request = validRequest();
  assert.equal(validation({ authorization_request_digest: `sha256:${'b'.repeat(64)}` }).valid, false);
  assert.equal(validation({ authorization_request_digest: 'not-a-digest' }).valid, false);

  const cyclic = requestInput();
  cyclic.requested_scope.cycle = cyclic;
  assert.throws(() => buildAuthorizationRequest(cyclic), /cyclic_reference_not_serializable/);
});

test('does not contain authorization, authentication, approval, budget, or execution outcomes', () => {
  const request = validRequest();
  for (const forbidden of ['AUTHORIZED', 'DENIED', 'APPROVED', 'EXECUTED']) {
    assert.equal(Object.values(request).includes(forbidden), false, forbidden);
  }
});
