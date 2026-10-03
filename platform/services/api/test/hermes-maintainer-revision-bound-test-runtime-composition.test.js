'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHermesMaintainerRevisionBoundTestRuntimeComposition } = require('../src/runtime/hermes-maintainer-revision-bound-test-runtime-composition');

const SHA = 'a'.repeat(40);
const binding = () => ({
  contract_version: 'hermes_maintainer_test_revision_binding_v1',
  status: 'MAINTAINER_TEST_REVISION_BOUND',
  binding_valid: true,
  repository: 'instutodp-cpu/agente-grupo-erick',
  ref: 'hermes/e2e-test',
  revision_sha: SHA,
  test_id: 'hermes_core_smoke',
  checkout_authorized: false,
  test_execution_authorized: false,
  production_allowed: false,
  merge_authority: false,
  human_merge_required: true
});

function workspaceSpawn(executable, args) {
  const handlers = {}; const stdoutHandlers = {};
  queueMicrotask(() => { if (args.includes('rev-parse')) stdoutHandlers.data?.(Buffer.from(SHA + '\n')); handlers.exit?.(0); });
  return { stdout: { on: (e,h) => { stdoutHandlers[e]=h; } }, once: (e,h) => { handlers[e]=h; }, kill: () => {} };
}

test('runs the allowlisted smoke test from the exact verified revision workspace', async () => {
  let testInvocation;
  const testSpawn = (executable, args, options) => {
    testInvocation = { executable, args, options };
    const handlers = {}; queueMicrotask(() => handlers.exit?.(0));
    return { once: (e,h) => { handlers[e]=h; }, kill: () => {} };
  };
  const composition = createHermesMaintainerRevisionBoundTestRuntimeComposition({
    workspaceSpawnImpl: workspaceSpawn,
    testSpawnImpl: testSpawn,
    workspaceTimeoutMs: 1000,
    testTimeoutMs: 1000
  });
  const result = await composition.execute(binding());
  assert.equal(result.status, 'MAINTAINER_REVISION_BOUND_TEST_PASSED');
  assert.equal(result.passed, true);
  assert.equal(result.revision_sha, SHA);
  assert.equal(testInvocation.options.cwd, '/tmp/hermes-maintainer-test-workspaces/' + SHA + '/platform/services/api');
  assert.equal(testInvocation.options.shell, false);
  assert.deepEqual(testInvocation.options.env, { NODE_ENV: 'test' });
  assert.equal(result.network_authorized_for_test, false);
  assert.equal(result.write_authorized_for_test, false);
  assert.equal(result.production_allowed, false);
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
});

test('invalid revision binding blocks before test execution', async () => {
  let testCalls = 0;
  const invalid = binding(); invalid.binding_valid = false;
  const result = await createHermesMaintainerRevisionBoundTestRuntimeComposition({
    workspaceSpawnImpl: () => { throw new Error('workspace must not run'); },
    testSpawnImpl: () => { testCalls += 1; throw new Error('test must not run'); }
  }).execute(invalid);
  assert.equal(result.status, 'MAINTAINER_REVISION_BOUND_TEST_BLOCKED');
  assert.equal(result.passed, false);
  assert.equal(testCalls, 0);
  assert.equal(result.merge_authority, false);
});

test('test process failure remains bound to the revision and fails closed', async () => {
  const testSpawn = () => {
    const handlers = {}; queueMicrotask(() => handlers.exit?.(1));
    return { once: (e,h) => { handlers[e]=h; }, kill: () => {} };
  };
  const result = await createHermesMaintainerRevisionBoundTestRuntimeComposition({
    workspaceSpawnImpl: workspaceSpawn,
    testSpawnImpl: testSpawn,
    workspaceTimeoutMs: 1000,
    testTimeoutMs: 1000
  }).execute(binding());
  assert.equal(result.status, 'MAINTAINER_REVISION_BOUND_TEST_FAILED');
  assert.equal(result.executed, true);
  assert.equal(result.passed, false);
  assert.equal(result.revision_sha, SHA);
  assert.equal(result.receipt, 'test_process_failed');
  assert.equal(result.production_allowed, false);
  assert.equal(result.human_merge_required, true);
});
