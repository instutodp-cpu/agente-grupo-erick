'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  materializePublicWebThirdCanaryAuthorization
} = require('../src/core/public-web-canary-third-authorization-materializer');

function grantMaterialization(overrides = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_GRANT_MATERIALIZED_NOT_AUTHORIZED_FOR_EXECUTION',
    trial_id: 'third_canary_trial_1',
    grant: {
      grant_id: 'third_canary_grant_candidate_1',
      trial_id: 'third_canary_trial_1',
      authorization_candidate_id: 'third_canary_authorization_candidate_1',
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path: '/',
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1,
      single_use: true,
      used: false,
      revoked: false
    },
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    trial_id: 'third_canary_trial_1',
    grant_materialization: grantMaterialization(),
    grant_id: 'third_canary_grant_candidate_1',
    authorization_candidate_id: 'third_canary_authorization_candidate_1',
    production_allowed: false,
    ...overrides
  };
}

test('materializes authorization identity without granting execution authority', () => {
  const result = materializePublicWebThirdCanaryAuthorization(input());
  assert.equal(result.ok, true);
  assert.equal(result.authorization_materialized, true);
  assert.equal(result.authorization.authorization_id, 'third_canary_authorization_candidate_1');
  assert.equal(result.authorization.execution_authorized, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.reservation_materialized, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.next_gate, 'SEPARATE_RESERVATION_MATERIALIZATION_LAYER');
});

test('requires exact grant and authorization candidate bindings', () => {
  for (const patch of [
    { grant_materialization: { ...grantMaterialization(), ok: false } },
    { trial_id: 'other_trial' },
    { grant_id: 'other_grant' },
    { authorization_candidate_id: 'other_authorization' }
  ]) assert.equal(materializePublicWebThirdCanaryAuthorization(input(patch)).ok, false);
});

test('fails closed when grant scope or single-use state is altered', () => {
  for (const grantPatch of [
    { environment: 'production' },
    { target_origin: 'https://www.example.com' },
    { target_path: '/other' },
    { method: 'POST' },
    { port: 80 },
    { maximum_requests: 2 },
    { rollout_percentage: 2 },
    { single_use: false },
    { used: true },
    { revoked: true }
  ]) {
    const grant_materialization = grantMaterialization({ grant: { ...grantMaterialization().grant, ...grantPatch } });
    assert.equal(materializePublicWebThirdCanaryAuthorization(input({ grant_materialization })).ok, false);
  }
});

test('cannot carry execution authority or runtime/network actions', () => {
  for (const patch of [
    { production_allowed: true },
    { explicit_human_execution_authorized: true },
    { human_authorized: true },
    { execute: true },
    { start: true },
    { consume: true },
    { reserve: true },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true }
  ]) {
    const result = materializePublicWebThirdCanaryAuthorization(input(patch));
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
