'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  OWNER_TYPES,
  SAFE_FLAGS,
  buildOperationalOwnerIdentity,
  classifyPersistedOperationalOwner,
  planToInsertRow,
  validatePersistedOperationalOwnerIdentity
} = require('../src/core/runtime-operational-owner-identity');

function input(overrides = {}) {
  return {
    operational_owner_type: 'operational_owner',
    owner_reference_id: 'machine-principal-1',
    tenant_id: 'tenant-1',
    organization_id: 'organization-1',
    project_id: 'project-1',
    ...overrides
  };
}

function persisted(plan) {
  return {
    ...JSON.parse(JSON.stringify(planToInsertRow(plan))),
    created_at: '2026-09-02T00:00:00.000Z'
  };
}

test('P14-PRE builds deterministic identity, id and digests', () => {
  const first = buildOperationalOwnerIdentity(input());
  const second = buildOperationalOwnerIdentity(input());
  assert.equal(first.outcome, 'READY');
  assert.equal(first.operational_owner_id, second.operational_owner_id);
  assert.equal(first.owner_identity_fingerprint, second.owner_identity_fingerprint);
  assert.equal(first.owner_identity_digest, second.owner_identity_digest);
  assert.deepEqual(first.identity, {
    contract_name: CONTRACT_NAME,
    contract_version: CONTRACT_VERSION,
    operational_owner_type: 'operational_owner',
    owner_reference_id: 'machine-principal-1',
    tenant_id: 'tenant-1',
    organization_id: 'organization-1',
    project_id: 'project-1'
  });
  assert.equal(validatePersistedOperationalOwnerIdentity(persisted(first)).valid, true);
});

test('P14-PRE fails closed for unknown type and missing canonical fields', () => {
  assert.deepEqual(OWNER_TYPES, ['operational_owner']);
  for (const [field, value] of [
    ['operational_owner_type', 'unknown_owner'],
    ['owner_reference_id', undefined],
    ['tenant_id', undefined],
    ['organization_id', undefined],
    ['project_id', undefined]
  ]) {
    const result = buildOperationalOwnerIdentity(input({ [field]: value }));
    assert.equal(result.outcome, 'INVALID', field);
    assert.ok(result.errors.some((error) => error.includes(field)), field);
  }
  for (const field of ['owner_reference_id', 'tenant_id', 'organization_id', 'project_id']) {
    const result = buildOperationalOwnerIdentity(input({ [field]: '' }));
    assert.equal(result.outcome, 'INVALID', `${field}_empty`);
    assert.ok(result.errors.some((error) => error.includes(field)), `${field}_empty`);
  }
});

test('P14-PRE rejects tampered artifact, fingerprint and digest', () => {
  const plan = buildOperationalOwnerIdentity(input());
  const artifactTampered = persisted(plan);
  artifactTampered.owner_identity_artifact.owner_reference_id = 'other-reference';
  assert.equal(validatePersistedOperationalOwnerIdentity(artifactTampered).valid, false);

  const fingerprintTampered = persisted(plan);
  fingerprintTampered.owner_identity_fingerprint = 'tampered';
  assert.equal(validatePersistedOperationalOwnerIdentity(fingerprintTampered).valid, false);

  const digestTampered = persisted(plan);
  digestTampered.owner_identity_digest = `sha256:${'f'.repeat(64)}`;
  assert.equal(validatePersistedOperationalOwnerIdentity(digestTampered).valid, false);
});

test('P14-PRE classifies identical replay and divergent scope in the same slot', () => {
  const plan = buildOperationalOwnerIdentity(input());
  const replay = classifyPersistedOperationalOwner(persisted(plan), plan);
  assert.equal(replay.outcome, 'EXISTING_IDENTICAL');

  const divergent = buildOperationalOwnerIdentity(input({ project_id: 'project-2' }));
  const conflict = classifyPersistedOperationalOwner(persisted(plan), divergent);
  assert.equal(conflict.outcome, 'CONFLICT');
});

test('P14-PRE exposes only identity registration and later layers remain false', () => {
  const plan = buildOperationalOwnerIdentity(input());
  assert.equal(plan.operational_owner_identity_registered, true);
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) assert.equal(plan[field], expected, field);
  const row = planToInsertRow(plan);
  assert.deepEqual(Object.keys(row).sort(), FIELDS.filter((field) => field !== 'created_at').sort());
  for (const forbidden of ['binding_id', 'worker_id', 'lease_id', 'expires_at', 'fencing_token', 'capacity', 'execution_status', 'execution_authority']) {
    assert.equal(Object.hasOwn(row, forbidden), false, forbidden);
  }
  assert.equal(plan.owner_identity_artifact.identity_establishes_ownership, false);
  assert.equal(plan.owner_identity_artifact.production_blocked, true);
});
