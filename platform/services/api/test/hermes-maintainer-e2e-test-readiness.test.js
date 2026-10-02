'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHermesMaintainerTestExecutionRuntimeComposition } = require('../src/runtime/hermes-maintainer-test-execution-runtime-composition');
const { deriveHermesMaintainerE2eTestReadiness, REMAINING_BLOCKER } = require('../src/core/hermes-maintainer-e2e-test-readiness');

test('recognizes the trusted operational test composition and keeps e2e orchestration blocked', () => {
  const composition = createHermesMaintainerTestExecutionRuntimeComposition({ spawnImpl: () => { throw new Error('must not execute'); } });
  const readiness = deriveHermesMaintainerE2eTestReadiness(composition);
  assert.equal(readiness.status, 'MAINTAINER_E2E_TEST_DEPENDENCY_READY');
  assert.equal(readiness.test_execution_operational_ready, true);
  assert.equal(readiness.execution_ready, false);
  assert.deepEqual(readiness.blockers, [REMAINING_BLOCKER]);
  assert.equal(readiness.production_allowed, false);
  assert.equal(readiness.merge_authority, false);
  assert.equal(readiness.human_merge_required, true);
});

test('fails closed for incomplete or widened test composition', () => {
  const missing = deriveHermesMaintainerE2eTestReadiness({});
  const widened = deriveHermesMaintainerE2eTestReadiness({
    composition_version: 'hermes_maintainer_test_execution_runtime_composition_v1',
    environment: 'staging',
    test_id: 'hermes_core_smoke',
    network_authorized: true,
    secrets_authorized: false,
    write_authorized: false,
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    execute() {}
  });
  assert.equal(missing.test_execution_operational_ready, false);
  assert.equal(widened.test_execution_operational_ready, false);
  assert.equal(missing.execution_ready, false);
  assert.equal(widened.execution_ready, false);
});
