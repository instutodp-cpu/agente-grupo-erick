'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHermesMaintainerTestRevisionWorkspaceRuntime, ROOT } = require('../src/runtime/hermes-maintainer-test-revision-workspace-runtime');

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

function successfulSpawn(invocations) {
  return (executable, args, options) => {
    invocations.push({ executable, args, options });
    const handlers = {};
    const stdoutHandlers = {};
    queueMicrotask(() => {
      if (args.includes('rev-parse')) stdoutHandlers.data?.(Buffer.from(SHA + '\n'));
      handlers.exit?.(0);
    });
    return { stdout: { on: (event, handler) => { stdoutHandlers[event] = handler; } }, once: (event, handler) => { handlers[event] = handler; }, kill: () => {} };
  };
}

test('materializes only the exact bound revision using fixed git operations', async () => {
  const invocations = [];
  const runtime = createHermesMaintainerTestRevisionWorkspaceRuntime({ spawnImpl: successfulSpawn(invocations), timeoutMs: 1000 });
  const result = await runtime.materialize(binding());
  assert.equal(result.status, 'MAINTAINER_TEST_REVISION_WORKSPACE_READY');
  assert.equal(result.workspace_ready, true);
  assert.equal(result.workspace_path, ROOT + '/' + SHA);
  assert.equal(result.revision_sha, SHA);
  assert.equal(result.test_execution_authorized, false);
  assert.equal(result.production_used, false);
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
  assert.equal(invocations.length, 3);
  assert.equal(invocations[0].executable, 'git');
  assert.deepEqual(invocations[0].args.slice(0, 3), ['clone', '--no-checkout', '--filter=blob:none']);
  assert.deepEqual(invocations[1].args, ['-C', ROOT + '/' + SHA, 'checkout', '--detach', SHA]);
  assert.deepEqual(invocations[2].args, ['-C', ROOT + '/' + SHA, 'rev-parse', 'HEAD']);
  for (const invocation of invocations) {
    assert.equal(invocation.options.shell, false);
    assert.deepEqual(invocation.options.env, { GIT_TERMINAL_PROMPT: '0' });
  }
});

test('fails closed for invalid binding without spawning git', async () => {
  let calls = 0;
  const runtime = createHermesMaintainerTestRevisionWorkspaceRuntime({ spawnImpl: () => { calls += 1; throw new Error('must not run'); } });
  const invalid = binding(); invalid.status = 'FAKE';
  const result = await runtime.materialize(invalid);
  assert.equal(result.status, 'MAINTAINER_TEST_REVISION_WORKSPACE_BLOCKED');
  assert.equal(result.workspace_ready, false);
  assert.equal(calls, 0);
});

test('fails closed when checked out HEAD differs from bound revision', async () => {
  const spawnImpl = (executable, args) => {
    const handlers = {}; const stdoutHandlers = {};
    queueMicrotask(() => { if (args.includes('rev-parse')) stdoutHandlers.data?.(Buffer.from('b'.repeat(40) + '\n')); handlers.exit?.(0); });
    return { stdout: { on: (e,h) => { stdoutHandlers[e]=h; } }, once: (e,h) => { handlers[e]=h; }, kill: () => {} };
  };
  const result = await createHermesMaintainerTestRevisionWorkspaceRuntime({ spawnImpl, timeoutMs: 1000 }).materialize(binding());
  assert.equal(result.workspace_ready, false);
  assert.deepEqual(result.blockers, ['workspace_revision_mismatch']);
});

test('workspace root cannot be caller-selected', () => {
  assert.throws(() => createHermesMaintainerTestRevisionWorkspaceRuntime({ root: '/tmp/other' }), /fixed_workspace_root_required/);
});
