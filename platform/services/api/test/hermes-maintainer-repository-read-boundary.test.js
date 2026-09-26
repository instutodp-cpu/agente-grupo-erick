'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_CONTENT_BYTES,
  invokeHermesMaintainerRepositoryReadBoundary,
  validateRepositoryPath
} = require('../src/core/hermes-maintainer-trusted-repository-read-adapter');

const AUTHORIZATION = Object.freeze({
  contract_version: 'hermes_maintainer_read_runtime_authorization_v1',
  status: 'MAINTAINER_READ_RUNTIME_AUTHORIZED_STAGING',
  authorization_valid: true,
  receipt_fingerprint: 'receipt-fingerprint',
  capability_fingerprint: 'capability-fingerprint',
  mission_id: 'mission-read-1',
  operation: 'repository_read',
  repository: 'instutodp-cpu/agente-grupo-erick',
  base_ref: 'main',
  executor_id: 'hermes-maintainer-staging',
  provider: 'GITHUB',
  trusted_adapter_id: 'github_read_only_staging',
  environment: 'staging',
  read_only: true,
  credential_resolution_authorized: true,
  network_authorized: true,
  credentials_authorized: true,
  write_authorized: false,
  provider_called: false,
  execution_allowed: true,
  execution_performed: false,
  production_allowed: false,
  blockers: []
});

const REQUEST = Object.freeze({
  repository: AUTHORIZATION.repository,
  ref: AUTHORIZATION.base_ref,
  path: 'platform/README.md'
});

function readerReturning(value) {
  let calls = 0;
  let payload;
  return {
    get calls() { return calls; },
    get payload() { return payload; },
    async readRepositoryPath(input) {
      calls += 1;
      payload = input;
      return typeof value === 'function' ? value(input) : value;
    }
  };
}

test('valid authorization and scoped request invoke the trusted reader once', async () => {
  const reader = readerReturning({ ok: true, content: 'read-only content', sha: 'sha-value' });
  const response = await invokeHermesMaintainerRepositoryReadBoundary(AUTHORIZATION, REQUEST, reader);
  assert.equal(response.outcome, 'SUCCEEDED');
  assert.equal(reader.calls, 1);
  assert.equal(response.provider_called, true);
  assert.equal(response.execution_performed, true);
  assert.equal(response.write_performed, false);
  assert.equal(response.production_used, false);
  assert.deepEqual(response.data, { path: REQUEST.path, content: 'read-only content', sha: 'sha-value' });
});

test('invalid authorization blocks before reader invocation', async () => {
  const reader = readerReturning({ ok: true, content: 'must not be read' });
  const response = await invokeHermesMaintainerRepositoryReadBoundary({ ...AUTHORIZATION, authorization_valid: false }, REQUEST, reader);
  assert.equal(response.outcome, 'BLOCKED');
  assert.equal(reader.calls, 0);
  assert.equal(response.provider_called, false);
  assert.equal(response.execution_performed, false);
});

for (const [name, field, value] of [
  ['network authority disabled', 'network_authorized', false],
  ['credential authority disabled', 'credentials_authorized', false],
  ['execution authority disabled', 'execution_allowed', false],
  ['write authority enabled', 'write_authorized', true],
  ['production authority enabled', 'production_allowed', true],
  ['wrong operation', 'operation', 'ci_read']
]) {
  test(`${name} blocks before reader invocation`, async () => {
    const reader = readerReturning({ ok: true, content: 'must not be read' });
    const response = await invokeHermesMaintainerRepositoryReadBoundary({ ...AUTHORIZATION, [field]: value }, REQUEST, reader);
    assert.equal(response.outcome, 'BLOCKED');
    assert.equal(reader.calls, 0);
  });
}

for (const [name, request] of [
  ['repository mismatch', { ...REQUEST, repository: 'other/repository' }],
  ['ref mismatch', { ...REQUEST, ref: 'other-ref' }],
  ['empty path', { ...REQUEST, path: '' }],
  ['parent traversal', { ...REQUEST, path: 'platform/../README.md' }],
  ['absolute path', { ...REQUEST, path: '/README.md' }],
  ['URL path', { ...REQUEST, path: 'https://example.invalid/file' }],
  ['method override', { ...REQUEST, method: 'POST' }],
  ['host override', { ...REQUEST, host: 'example.invalid' }],
  ['NUL path', { ...REQUEST, path: 'platform/\u0000README.md' }],
  ['control character path', { ...REQUEST, path: 'platform/\u001fREADME.md' }]
]) {
  test(`${name} blocks before reader invocation`, async () => {
    const reader = readerReturning({ ok: true, content: 'must not be read' });
    const response = await invokeHermesMaintainerRepositoryReadBoundary(AUTHORIZATION, request, reader);
    assert.equal(response.outcome, 'BLOCKED');
    assert.equal(reader.calls, 0);
  });
}

test('missing reader blocks before provider call', async () => {
  const response = await invokeHermesMaintainerRepositoryReadBoundary(AUTHORIZATION, REQUEST, null);
  assert.equal(response.outcome, 'BLOCKED');
  assert.equal(response.provider_called, false);
});

test('reader exception is generic and records an attempted provider read', async () => {
  const reader = readerReturning(() => { throw new Error('sensitive reader detail'); });
  const response = await invokeHermesMaintainerRepositoryReadBoundary(AUTHORIZATION, REQUEST, reader);
  assert.equal(response.outcome, 'FAILED');
  assert.equal(response.provider_called, true);
  assert.equal(response.execution_performed, true);
  assert.equal(JSON.stringify(response).includes('sensitive reader detail'), false);
  assert.equal(response.data, null);
});

test('invalid reader response fails without exposing provider data', async () => {
  const reader = readerReturning({ ok: true, content: Buffer.from('binary') });
  const response = await invokeHermesMaintainerRepositoryReadBoundary(AUTHORIZATION, REQUEST, reader);
  assert.equal(response.outcome, 'FAILED');
  assert.equal(response.provider_called, true);
  assert.equal(response.execution_performed, true);
  assert.equal(response.data, null);
});

test('textual response above the byte limit fails closed without content', async () => {
  const reader = readerReturning({ ok: true, content: 'x'.repeat(MAX_CONTENT_BYTES + 1) });
  const response = await invokeHermesMaintainerRepositoryReadBoundary(AUTHORIZATION, REQUEST, reader);
  assert.equal(response.outcome, 'FAILED');
  assert.equal(response.data, null);
  assert.equal(response.blockers[0], 'READER_RESPONSE_INVALID');
});

test('reader payload is sovereign and derived from authorization plus safe path only', async () => {
  const reader = readerReturning({ ok: true, content: 'ok' });
  const request = { repository: AUTHORIZATION.repository, ref: AUTHORIZATION.base_ref, path: 'README.md' };
  const response = await invokeHermesMaintainerRepositoryReadBoundary(AUTHORIZATION, request, reader);
  assert.equal(response.outcome, 'SUCCEEDED');
  assert.deepEqual(reader.payload, {
    provider: 'GITHUB',
    repository: AUTHORIZATION.repository,
    ref: AUTHORIZATION.base_ref,
    path: 'README.md',
    method: 'GET',
    read_only: true
  });
  assert.equal(Object.prototype.hasOwnProperty.call(reader.payload, 'host'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(reader.payload, 'token'), false);
});

test('repository paths reject traversal, absolute paths, URLs and control characters', () => {
  for (const path of ['', '../README.md', 'a/../../b', '/README.md', 'C:\\README.md', 'https://example.invalid/x', 'a\\b', 'a?b', 'a#b', 'a\u0000b']) {
    assert.equal(validateRepositoryPath(path), false, path);
  }
  assert.equal(validateRepositoryPath('platform/services/api/src/index.js'), true);
});
