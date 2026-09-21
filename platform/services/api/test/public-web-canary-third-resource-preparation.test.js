'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  preparePublicWebThirdCanarySingleUseResources
} = require('../src/pilots/public-web-canary-third-resource-preparation');

function validInput(overrides = {}) {
  return {
    trial_id: 'public_web_third_canary_20260921',
    preparation_nonce: 'human-reviewed-preparation-1',
    previous_resource_ids: ['old_auth', 'old_grant', 'old_reservation'],
    environment: 'staging',
    production_allowed: false,
    maximum_requests: 1,
    rollout_percentage: 1,
    target_origin: 'https://example.com',
    target_path: '/',
    target_method: 'GET',
    target_port: 443,
    human_authorized: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    ...overrides
  };
}

test('prepares deterministic single-use candidates without execution authority', () => {
  const first = preparePublicWebThirdCanarySingleUseResources(validInput());
  const second = preparePublicWebThirdCanarySingleUseResources(validInput());
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  assert.equal(first.resources_materialized, false);
  assert.equal(first.human_authorized, false);
  assert.equal(first.execution_started, false);
  assert.equal(first.external_network_called, false);
  for (const resource of Object.values(first.resources)) {
    assert.equal(resource.fresh, true);
    assert.equal(resource.single_use, true);
    assert.equal(resource.consumed, false);
    assert.equal(resource.reused, false);
    assert.equal(resource.trial_id, validInput().trial_id);
  }
});

test('fails closed if human execution authorization is supplied during preparation', () => {
  const result = preparePublicWebThirdCanarySingleUseResources(validInput({ human_authorized: true }));
  assert.equal(result.ok, false);
  assert.ok(result.reason_codes.includes('human_authorization_forbidden_during_preparation'));
});

test('fails closed on any execution or network activity signal', () => {
  for (const patch of [
    { execute: true },
    { start: true },
    { consume: true },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true }
  ]) {
    const result = preparePublicWebThirdCanarySingleUseResources(validInput(patch));
    assert.equal(result.ok, false);
  }
});

test('binds preparation to the exact approved staging target and one-request budget', () => {
  for (const patch of [
    { environment: 'production' },
    { production_allowed: true },
    { maximum_requests: 2 },
    { rollout_percentage: 2 },
    { target_origin: 'https://www.example.com' },
    { target_path: '/other' },
    { target_method: 'POST' },
    { target_port: 80 }
  ]) {
    const result = preparePublicWebThirdCanarySingleUseResources(validInput(patch));
    assert.equal(result.ok, false);
  }
});

test('requires explicit identity inputs and rejects collision with previous resources', () => {
  assert.equal(preparePublicWebThirdCanarySingleUseResources(validInput({ trial_id: '' })).ok, false);
  assert.equal(preparePublicWebThirdCanarySingleUseResources(validInput({ preparation_nonce: '' })).ok, false);

  const prepared = preparePublicWebThirdCanarySingleUseResources(validInput());
  const collision = preparePublicWebThirdCanarySingleUseResources(validInput({
    previous_resource_ids: [prepared.resources.grant.id]
  }));
  assert.equal(collision.ok, false);
  assert.ok(collision.reason_codes.includes('resource_identity_collision'));
});
