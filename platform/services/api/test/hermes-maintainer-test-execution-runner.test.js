'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHermesMaintainerTestExecutionRunner, TEST_SPECS } = require('../src/core/hermes-maintainer-test-execution-runner');

test('runs a fixed node test spec without shell or inherited environment', async () => {
  let invocation;
  const spawnImpl = (executable, args, options) => {
    invocation = { executable, args, options };
    const handlers = {};
    queueMicrotask(() => handlers.exit(0));
    return { once: (event, handler) => { handlers[event] = handler; } };
  };
  const runner = createHermesMaintainerTestExecutionRunner({ cwd: '/repo/platform/services/api', spawnImpl });
  const result = await runner.run({ test_id: 'hermes_core_smoke', environment: 'staging', network_authorized: false, secrets_authorized: false, write_authorized: false });
  assert.equal(result.passed, true);
  assert.equal(result.receipt, 'test_process_passed');
  assert.equal(invocation.executable, process.execPath);
  assert.deepEqual(invocation.args, [...TEST_SPECS.hermes_core_smoke.args]);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.env, { NODE_ENV: 'test' });
});

test('rejects unknown tests and any widened authority before spawning', async () => {
  let calls = 0;
  const spawnImpl = () => { calls += 1; throw new Error('must not spawn'); };
  const runner = createHermesMaintainerTestExecutionRunner({ spawnImpl });
  const unknown = await runner.run({ test_id: 'arbitrary', environment: 'staging', network_authorized: false, secrets_authorized: false, write_authorized: false });
  const widened = await runner.run({ test_id: 'hermes_core_smoke', environment: 'staging', network_authorized: true, secrets_authorized: false, write_authorized: false });
  assert.equal(unknown.passed, false);
  assert.equal(unknown.receipt, 'test_not_registered');
  assert.equal(widened.passed, false);
  assert.equal(widened.receipt, 'authority_boundary_invalid');
  assert.equal(calls, 0);
});

test('reports a fixed failed receipt for nonzero test exit', async () => {
  const spawnImpl = () => {
    const handlers = {};
    queueMicrotask(() => handlers.exit(1));
    return { once: (event, handler) => { handlers[event] = handler; } };
  };
  const runner = createHermesMaintainerTestExecutionRunner({ spawnImpl });
  const result = await runner.run({ test_id: 'hermes_core_smoke', environment: 'staging', network_authorized: false, secrets_authorized: false, write_authorized: false });
  assert.deepEqual(result, { test_id: 'hermes_core_smoke', passed: false, receipt: 'test_process_failed' });
});
