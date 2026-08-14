'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
  MachineIdentityError,
  createMachineIdentityRegistry
} = require('../src/core/machine-identity-registry');
const {
  MAX_CREDENTIAL_LENGTH,
  resolveMachineIdentity
} = require('../src/core/machine-identity-resolver');

function digestFor(credential) {
  return createHash('sha256').update(credential, 'utf8').digest('hex');
}

function entry({ key_id, credential, principal_id, tenant_id, active = true }) {
  return { key_id, key_digest: digestFor(credential), principal_id, tenant_id, active };
}

function registryWith(...entries) {
  return createMachineIdentityRegistry({ entries });
}

function resolve(registry, credential, extra = {}) {
  return resolveMachineIdentity({ authorization: `Bearer ${credential}`, ...extra }, registry);
}

function assertCode(code, callback) {
  assert.throws(callback, (error) => error instanceof MachineIdentityError && error.code === code);
}

test('valid bearer credential resolves the server-side principal and tenant', () => {
  const registry = registryWith(entry({
    key_id: 'key-grupo-erick-1',
    credential: 'fixture-machine-credential-a',
    principal_id: 'hermes-service',
    tenant_id: 'grupo_erick'
  }));

  const identity = resolve(registry, 'fixture-machine-credential-a');

  assert.deepEqual(identity, {
    principal: { type: 'machine', id: 'hermes-service' },
    tenant_id: 'grupo_erick',
    auth_source: 'machine_bearer',
    key_id: 'key-grupo-erick-1'
  });
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.isFrozen(identity.principal), true);
});

test('request body and arbitrary headers cannot override the mapped tenant', () => {
  const registry = registryWith(entry({
    key_id: 'key-a',
    credential: 'fixture-tenant-a',
    principal_id: 'service-a',
    tenant_id: 'grupo_erick'
  }));

  const identity = resolve(registry, 'fixture-tenant-a', {
    body: { tenant_id: 'client::attacker' },
    headers: { 'x-tenant-id': 'client::attacker' },
    tenant_id: 'client::attacker'
  });

  assert.equal(identity.tenant_id, 'grupo_erick');
});

test('missing, malformed and unknown credentials fail closed', () => {
  const registry = registryWith(entry({
    key_id: 'key-a',
    credential: 'fixture-valid',
    principal_id: 'service-a',
    tenant_id: 'grupo_erick'
  }));

  assertCode('MISSING_CREDENTIAL', () => resolveMachineIdentity({}, registry));
  assertCode('MALFORMED_CREDENTIAL', () => resolveMachineIdentity({ authorization: '' }, registry));
  assertCode('MALFORMED_CREDENTIAL', () => resolveMachineIdentity({ authorization: 'Basic fixture-valid' }, registry));
  assertCode('MALFORMED_CREDENTIAL', () => resolveMachineIdentity({ authorization: 'Bearer' }, registry));
  assertCode('MALFORMED_CREDENTIAL', () => resolveMachineIdentity({ authorization: 'Bearer  fixture-valid' }, registry));
  assertCode('UNKNOWN_CREDENTIAL', () => resolve(registry, 'fixture-unknown'));
  assertCode('MALFORMED_CREDENTIAL', () => resolveMachineIdentity({ authorization: `Bearer ${'x'.repeat(MAX_CREDENTIAL_LENGTH + 1)}` }, registry));
});

test('inactive credentials fail closed without exposing credential material', () => {
  const credential = 'fixture-revoked-credential';
  const registry = registryWith(entry({
    key_id: 'key-revoked',
    credential,
    principal_id: 'service-a',
    tenant_id: 'grupo_erick',
    active: false
  }));

  assertCode('INACTIVE_CREDENTIAL', () => resolve(registry, credential));
  assert.doesNotMatch(JSON.stringify(registry), /fixture-revoked-credential/);
  assert.doesNotMatch(JSON.stringify(new MachineIdentityError('INACTIVE_CREDENTIAL')), /fixture-revoked-credential/);
});

test('registry rejects missing mappings and ambiguous configuration', () => {
  assertCode('MISSING_TENANT_MAPPING', () => registryWith(entry({
    key_id: 'key-without-tenant',
    credential: 'fixture-no-tenant',
    principal_id: 'service-a',
    tenant_id: ''
  })));

  const first = entry({ key_id: 'key-a', credential: 'fixture-duplicate', principal_id: 'service-a', tenant_id: 'grupo_erick' });
  const second = entry({ key_id: 'key-b', credential: 'fixture-duplicate', principal_id: 'service-b', tenant_id: 'client::b' });
  assertCode('DUPLICATE_KEY_DIGEST', () => registryWith(first, second));
  assertCode('DUPLICATE_KEY_ID', () => registryWith(first, { ...first, key_digest: digestFor('fixture-other') }));
  assertCode('INVALID_IDENTITY_ENTRY', () => createMachineIdentityRegistry({ entries: [{ ...first, credential: 'fixture-plaintext' }] }));
});

test('two active credentials can rotate for one tenant and tenants do not cross', () => {
  const registry = registryWith(
    entry({ key_id: 'key-old', credential: 'fixture-old', principal_id: 'service-a', tenant_id: 'grupo_erick' }),
    entry({ key_id: 'key-new', credential: 'fixture-new', principal_id: 'service-a', tenant_id: 'grupo_erick' }),
    entry({ key_id: 'key-other', credential: 'fixture-other-tenant', principal_id: 'service-b', tenant_id: 'client::b' })
  );

  assert.equal(resolve(registry, 'fixture-old').tenant_id, 'grupo_erick');
  assert.equal(resolve(registry, 'fixture-new').tenant_id, 'grupo_erick');
  assert.equal(resolve(registry, 'fixture-other-tenant').tenant_id, 'client::b');
});

test('identity modules have no environment or import-time operational side effects', () => {
  const files = [
    path.join(__dirname, '../src/core/machine-identity-registry.js'),
    path.join(__dirname, '../src/core/machine-identity-resolver.js')
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /process\.env/);
    assert.doesNotMatch(source, /createPool|new Pool|pool\.end|process\.on|process\.exit/);
  }
});
