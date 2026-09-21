'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validatePublicWebThirdCanaryMaterialization } = require('../src/core/public-web-canary-third-materialization');

function resource(kind) {
  return {
    id: `third_canary_${kind}_candidate_fresh_1`,
    trial_id: 'third_canary_trial_1',
    fresh: true,
    single_use: true,
    consumed: false,
    reused: false
  };
}

function input(overrides = {}) {
  return {
    trial_id: 'third_canary_trial_1',
    environment: 'staging',
    production_allowed: false,
    target_origin: 'https://example.com',
    target_path: '/',
    method: 'GET',
    port: 443,
    maximum_requests: 1,
    rollout_percentage: 1,
    authorization_candidate: resource('authorization'),
    grant_candidate: resource('grant'),
    reservation_candidate: resource('reservation'),
    previous_resource_ids: ['old_authorization', 'old_grant', 'old_reservation'],
    ...overrides
  };
}

test('accepts only fresh candidates and remains side-effect free', () => {
  const result = validatePublicWebThirdCanaryMaterialization(input());
  assert.equal(result.ok, true);
  assert.equal(result.resources_materialized, false);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.next_gate, 'EXPLICIT_HUMAN_AUTHORIZATION_BEFORE_RESOURCE_MATERIALIZATION');
});

test('fails closed outside exact staging target and one-request scope', () => {
  for (const patch of [
    { environment: 'production' },
    { production_allowed: true },
    { target_origin: 'https://www.example.com' },
    { target_path: '/other' },
    { method: 'POST' },
    { port: 80 },
    { maximum_requests: 2 },
    { rollout_percentage: 2 }
  ]) assert.equal(validatePublicWebThirdCanaryMaterialization(input(patch)).ok, false);
});

test('rejects stale, consumed, reused and previous resource identities', () => {
  for (const patch of [
    { grant_candidate: { ...resource('grant'), fresh: false } },
    { reservation_candidate: { ...resource('reservation'), consumed: true } },
    { authorization_candidate: { ...resource('authorization'), reused: true } },
    { previous_resource_ids: ['third_canary_grant_candidate_fresh_1'] }
  ]) assert.equal(validatePublicWebThirdCanaryMaterialization(input(patch)).ok, false);
});

test('rejects cross-trial binding and candidate identity collisions', () => {
  assert.equal(validatePublicWebThirdCanaryMaterialization(input({
    grant_candidate: { ...resource('grant'), trial_id: 'other_trial' }
  })).ok, false);
  assert.equal(validatePublicWebThirdCanaryMaterialization(input({
    reservation_candidate: { ...resource('grant') }
  })).ok, false);
});

test('cannot carry human execution authority, materialization or runtime actions', () => {
  for (const patch of [
    { explicit_human_execution_authorized: true },
    { human_authorized: true },
    { materialize: true },
    { execute: true },
    { start: true },
    { consume: true },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true }
  ]) {
    const result = validatePublicWebThirdCanaryMaterialization(input(patch));
    assert.equal(result.ok, false);
    assert.equal(result.external_network_called, false);
  }
});
