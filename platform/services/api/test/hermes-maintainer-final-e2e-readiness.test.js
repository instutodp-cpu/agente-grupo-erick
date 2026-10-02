'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveHermesMaintainerFinalE2eReadiness } = require('../src/core/hermes-maintainer-final-e2e-readiness');

const trusted = overrides => ({
  composition_version: 'hermes_maintainer_trusted_e2e_runtime_composition_v1',
  environment: 'staging',
  production_allowed: false,
  merge_authority: false,
  human_merge_required: true,
  execute() {},
  ...overrides
});

test('declares the trusted staging E2E runtime executable while still requiring a real canary', () => {
  const result = deriveHermesMaintainerFinalE2eReadiness(trusted());
  assert.equal(result.status, 'MAINTAINER_FINAL_E2E_RUNTIME_READY');
  assert.equal(result.execution_ready, true);
  assert.equal(result.trusted_runtime_ready, true);
  assert.equal(result.staging_canary_required, true);
  assert.equal(result.staging_canary_completed, false);
  assert.equal(result.production_allowed, false);
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
  assert.deepEqual(result.blockers, []);
});

for (const [name, override] of [
  ['wrong composition', {composition_version:'other'}],
  ['non-staging', {environment:'production'}],
  ['production authority', {production_allowed:true}],
  ['merge authority', {merge_authority:true}],
  ['missing human merge', {human_merge_required:false}],
  ['missing execute', {execute:null}]
]) {
  test('fails closed for ' + name, () => {
    const result = deriveHermesMaintainerFinalE2eReadiness(trusted(override));
    assert.equal(result.execution_ready, false);
    assert.equal(result.trusted_runtime_ready, false);
    assert.equal(result.staging_canary_required, true);
    assert.equal(result.production_allowed, false);
    assert.equal(result.merge_authority, false);
    assert.equal(result.human_merge_required, true);
    assert.deepEqual(result.blockers, ['TRUSTED_E2E_RUNTIME_COMPOSITION_INVALID']);
  });
}
