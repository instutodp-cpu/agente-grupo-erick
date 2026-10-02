'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHermesMaintainerTestExecutionRuntimeComposition, TEST_ID } = require('../src/runtime/hermes-maintainer-test-execution-runtime-composition');

test('trusted composition fixes staging test execution inputs and preserves authority boundaries', async () => {
  let invocation;
  const spawnImpl = (executable, args, options) => {
    invocation = { executable, args, options };
    const handlers = {};
    queueMicrotask(() => handlers.exit(0));
    return { once: (event, handler) => { handlers[event] = handler; }, kill: () => {} };
  };
  const composition = createHermesMaintainerTestExecutionRuntimeComposition({ spawnImpl, timeoutMs: 1000 });
  const result = await composition.execute({ test_id: 'arbitrary', command: 'sh' });
  assert.equal(composition.test_id, TEST_ID);
  assert.equal(result.status, 'MAINTAINER_TEST_EXECUTION_PASSED');
  assert.equal(result.test_id, TEST_ID);
  assert.equal(result.network_authorized, false);
  assert.equal(result.secrets_authorized, false);
  assert.equal(result.write_authorized, false);
  assert.equal(result.production_allowed, false);
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.env, { NODE_ENV: 'test' });
});

test('runtime timeout fails closed and terminates the child process', async () => {
  let killed = null;
  const spawnImpl = () => ({ once: () => {}, kill: signal => { killed = signal; } });
  const composition = createHermesMaintainerTestExecutionRuntimeComposition({ spawnImpl, timeoutMs: 5 });
  const result = await composition.execute();
  assert.equal(result.status, 'MAINTAINER_TEST_EXECUTION_FAILED');
  assert.equal(result.receipt, 'test_process_timeout');
  assert.equal(result.passed, false);
  assert.equal(killed, 'SIGTERM');
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
});
