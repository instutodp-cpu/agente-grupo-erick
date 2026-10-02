'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHermesMaintainerTestExecutionBoundary } = require('../src/core/hermes-maintainer-test-execution-boundary');

test('executes only an allowlisted staging test through the injected runner', async () => {
  const calls = [];
  const boundary = createHermesMaintainerTestExecutionBoundary({ runner: { run: async input => { calls.push(input); return { test_id: input.test_id, passed: true, receipt: 'test-receipt-1' }; } } });
  const result = await boundary.execute({ action: 'test_execution', environment: 'staging', test_id: 'hermes_core_smoke' });
  assert.equal(result.status, 'MAINTAINER_TEST_EXECUTION_PASSED');
  assert.equal(result.executed, true);
  assert.equal(result.passed, true);
  assert.equal(result.write_authorized, false);
  assert.equal(result.network_authorized, false);
  assert.equal(result.secrets_authorized, false);
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
  assert.deepEqual(calls, [{ test_id: 'hermes_core_smoke', environment: 'staging', network_authorized: false, secrets_authorized: false, write_authorized: false }]);
});

test('fails closed for arbitrary execution parameters or non-allowlisted tests', async () => {
  let calls = 0;
  const boundary = createHermesMaintainerTestExecutionBoundary({ runner: { run: async () => { calls += 1; return { test_id: 'hermes_core_smoke', passed: true }; } } });
  for (const request of [
    { action: 'test_execution', environment: 'production', test_id: 'hermes_core_smoke' },
    { action: 'test_execution', environment: 'staging', test_id: 'arbitrary' },
    { action: 'test_execution', environment: 'staging', test_id: 'hermes_core_smoke', command: 'npm test' },
    { action: 'test_execution', environment: 'staging', test_id: 'hermes_core_smoke', args: ['--anything'] },
    { action: 'test_execution', environment: 'staging', test_id: 'hermes_core_smoke', env: { TOKEN: 'x' } }
  ]) {
    const result = await boundary.execute(request);
    assert.equal(result.executed, false);
    assert.equal(result.write_authorized, false);
    assert.equal(result.production_allowed, false);
  }
  assert.equal(calls, 0);
});

test('fails closed on malformed runner result and preserves human-only merge', async () => {
  const boundary = createHermesMaintainerTestExecutionBoundary({ runner: { run: async () => ({ passed: true }) } });
  const result = await boundary.execute({ action: 'test_execution', environment: 'staging', test_id: 'hermes_core_smoke' });
  assert.equal(result.status, 'MAINTAINER_TEST_EXECUTION_BLOCKED');
  assert.equal(result.reason, 'test_runner_result_invalid');
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
});
