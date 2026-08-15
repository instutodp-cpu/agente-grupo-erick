'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const http = require('node:http');
const test = require('node:test');

const {
  REQUEST_IDENTITY_CONTRACT_VERSION,
  REQUEST_IDENTITY_MODES,
  RequestIdentityError,
  attachRequestIdentity,
  getRequestIdentity,
  requireRequestIdentity
} = require('../src/core/request-identity');
const { createMachineIdentityRegistry, MachineIdentityError } = require('../src/core/machine-identity-registry');
const { createServer } = require('../src/index');

function digestFor(credential) {
  return createHash('sha256').update(credential, 'utf8').digest('hex');
}

function registryFor(credential = 'fixture-request-credential', tenant_id = 'grupo_erick') {
  return createMachineIdentityRegistry({
    entries: [{
      key_id: 'request-key',
      key_digest: digestFor(credential),
      principal_id: 'hermes-service',
      tenant_id,
      active: true
    }]
  });
}

function request(authorization) {
  return {
    headers: authorization === undefined ? {} : { authorization },
    body: { tenant_id: 'client::spoof', principal_id: 'spoofed-principal' },
    url: '/message'
  };
}

function assertCode(code, callback) {
  assert.throws(callback, (error) => {
    return (error instanceof MachineIdentityError || error instanceof RequestIdentityError) && error.code === code;
  });
}

function requestServer(server, headers = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: address.address,
      port: address.port,
      path: '/health',
      headers
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

test('request identity contract is versioned and optional identity preserves public requests', () => {
  const req = request();
  const context = attachRequestIdentity(req, { mode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY });

  assert.equal(REQUEST_IDENTITY_CONTRACT_VERSION, 'hermes-request-identity-v1');
  assert.deepEqual(context, { identity: null });
  assert.equal(getRequestIdentity(req), null);
  assertCode('IDENTITY_REQUIRED', () => requireRequestIdentity(req));
  assert.equal(Object.isFrozen(context), true);
});

test('valid machine identity is attached once and exposes no credential material', () => {
  const credential = 'fixture-request-credential';
  const registry = registryFor(credential);
  const req = request(`Bearer ${credential}`);
  const context = attachRequestIdentity(req, { mode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY, registry });
  const secondContext = attachRequestIdentity(req, { mode: REQUEST_IDENTITY_MODES.REQUIRED_IDENTITY });

  assert.strictEqual(secondContext, context);
  assert.deepEqual(getRequestIdentity(req), {
    principal: { type: 'machine', id: 'hermes-service' },
    tenant_id: 'grupo_erick',
    auth_source: 'machine_bearer',
    key_id: 'request-key'
  });
  assert.equal(Object.isFrozen(context.identity), true);
  assert.equal(Object.isFrozen(context.identity.principal), true);
  assert.equal(JSON.stringify(context).includes(credential), false);
  assert.equal(JSON.stringify(context).includes('digest'), false);
});

test('presented invalid credentials fail closed even in optional mode', () => {
  const registry = registryFor();

  assertCode('MALFORMED_CREDENTIAL', () => attachRequestIdentity(request('Basic fixture'), { mode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY, registry }));
  assertCode('UNKNOWN_CREDENTIAL', () => attachRequestIdentity(request('Bearer fixture-unknown'), { mode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY, registry }));
  assertCode('MISSING_CREDENTIAL', () => attachRequestIdentity(request(), { mode: REQUEST_IDENTITY_MODES.REQUIRED_IDENTITY, registry }));
  assertCode('INVALID_IDENTITY_REGISTRY', () => attachRequestIdentity(request('Bearer fixture'), { mode: REQUEST_IDENTITY_MODES.REQUIRED_IDENTITY }));
});

test('body, query-like URL and arbitrary tenant/principal headers cannot override identity', () => {
  const credential = 'fixture-tenant-a';
  const req = request(`Bearer ${credential}`);
  req.url = '/message?tenant_id=client::spoof';
  req.headers['x-tenant-id'] = 'client::spoof';
  req.headers['x-principal-id'] = 'spoofed-principal';

  attachRequestIdentity(req, { mode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY, registry: registryFor(credential) });
  const identity = requireRequestIdentity(req);

  assert.equal(identity.tenant_id, 'grupo_erick');
  assert.equal(identity.principal.id, 'hermes-service');
});

test('two requests resolve independently without cross-request identity leakage', () => {
  const tenantA = registryFor('fixture-a', 'grupo_erick');
  const tenantB = registryFor('fixture-b', 'client::b');
  const requestA = request('Bearer fixture-a');
  const requestB = request('Bearer fixture-b');

  attachRequestIdentity(requestA, { mode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY, registry: tenantA });
  attachRequestIdentity(requestB, { mode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY, registry: tenantB });

  assert.equal(getRequestIdentity(requestA).tenant_id, 'grupo_erick');
  assert.equal(getRequestIdentity(requestB).tenant_id, 'client::b');
  assert.notStrictEqual(requestA.context, requestB.context);
});

test('public mode does not resolve credentials and does not require a registry', () => {
  const req = request('Bearer malformed-or-unconfigured');
  attachRequestIdentity(req, { mode: REQUEST_IDENTITY_MODES.PUBLIC });

  assert.equal(getRequestIdentity(req), null);
});

test('identity resolution is performed once per request', () => {
  const credential = 'fixture-counted';
  const baseRegistry = registryFor(credential);
  let calls = 0;
  const registry = {
    findByDigest(digest) {
      calls += 1;
      return baseRegistry.findByDigest(digest);
    }
  };
  const req = request(`Bearer ${credential}`);

  attachRequestIdentity(req, { mode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY, registry });
  attachRequestIdentity(req, { mode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY, registry });

  assert.equal(calls, 1);
});

test('optional HTTP mode preserves public requests and rejects presented invalid credentials', async () => {
  const server = createServer({
    machineIdentityRegistry: registryFor(),
    requestIdentityMode: REQUEST_IDENTITY_MODES.OPTIONAL_IDENTITY
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    assert.equal(await requestServer(server), 200);
    assert.equal(await requestServer(server, { Authorization: 'Bearer fixture-unknown' }), 401);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
