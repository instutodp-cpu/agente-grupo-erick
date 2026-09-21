'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPublicWebThirdCanaryGrantRegistry } = require('../src/core/public-web-canary-third-grant');

const NOW = '2026-09-21T15:00:00.000Z';

function input(overrides = {}) {
  return {
    grant_id: 'third_canary_grant_1',
    trial_id: 'third_canary_trial_1',
    environment: 'staging',
    production_allowed: false,
    target_origin: 'https://example.com',
    target_path: '/',
    method: 'GET',
    port: 443,
    maximum_requests: 1,
    rollout_percentage: 1,
    authorization_candidate_id: 'third_canary_authorization_candidate_1',
    expires_at: '2026-09-21T15:01:00.000Z',
    human_authorized: false,
    ...overrides
  };
}

function context(overrides = {}) {
  return {
    explicit_human_authorized: true,
    trial_id: 'third_canary_trial_1',
    environment: 'staging',
    target_origin: 'https://example.com',
    target_path: '/',
    method: 'GET',
    port: 443,
    authorization_candidate_id: 'third_canary_authorization_candidate_1',
    ...overrides
  };
}

test('issues one staging-only grant without executing anything', () => {
  const registry = createPublicWebThirdCanaryGrantRegistry({ clock: () => NOW });
  const result = registry.issueGrant(input());
  assert.equal(result.ok, true);
  assert.equal(result.grant.single_use, true);
  assert.equal(result.grant.used, false);
  assert.equal(result.executed, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.production_allowed, false);
});

test('fails closed outside exact approved target and one-request scope', () => {
  for (const patch of [
    { environment: 'production' },
    { production_allowed: true },
    { target_origin: 'https://www.example.com' },
    { target_path: '/other' },
    { method: 'POST' },
    { port: 80 },
    { maximum_requests: 2 },
    { rollout_percentage: 2 }
  ]) {
    const registry = createPublicWebThirdCanaryGrantRegistry({ clock: () => NOW });
    assert.equal(registry.issueGrant(input(patch)).ok, false);
  }
});

test('issuance cannot carry human execution authority or execution actions', () => {
  for (const patch of [{ human_authorized: true }, { execute: true }, { start: true }, { consume: true }]) {
    const registry = createPublicWebThirdCanaryGrantRegistry({ clock: () => NOW });
    const result = registry.issueGrant(input(patch));
    assert.equal(result.ok, false);
    assert.equal(result.external_network_called, false);
  }
});

test('consumption requires separate explicit human authorization and exact scope', () => {
  const registry = createPublicWebThirdCanaryGrantRegistry({ clock: () => NOW });
  assert.equal(registry.issueGrant(input()).ok, true);
  assert.equal(registry.consumeGrant('third_canary_grant_1', context({ explicit_human_authorized: false })).ok, false);
  assert.equal(registry.consumeGrant('third_canary_grant_1', context({ target_path: '/other' })).ok, false);
  const consumed = registry.consumeGrant('third_canary_grant_1', context());
  assert.equal(consumed.ok, true);
  assert.equal(consumed.grant.used, true);
  assert.equal(consumed.executed, false);
  assert.equal(registry.consumeGrant('third_canary_grant_1', context()).ok, false);
});

test('grant is expiring, revocable and replay-safe', () => {
  const registry = createPublicWebThirdCanaryGrantRegistry({ clock: () => NOW });
  assert.equal(registry.issueGrant(input()).ok, true);
  assert.equal(registry.issueGrant(input()).ok, false);
  assert.equal(registry.revokeGrant('third_canary_grant_1').ok, true);
  assert.equal(registry.consumeGrant('third_canary_grant_1', context()).ok, false);

  const expired = createPublicWebThirdCanaryGrantRegistry({ clock: () => '2026-09-21T15:02:00.000Z' });
  assert.equal(expired.issueGrant(input({ expires_at: '2026-09-21T15:01:00.000Z' })).ok, false);
});
