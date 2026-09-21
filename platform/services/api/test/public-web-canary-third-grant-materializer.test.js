'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  materializePublicWebThirdCanaryGrant
} = require('../src/core/public-web-canary-third-grant-materializer');

const NOW = '2026-09-21T16:30:00.000Z';

function readiness(overrides = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_MATERIALIZATION_CONTRACT_READY',
    trial_id: 'third_canary_trial_1',
    candidate_ids: {
      authorization_candidate_id: 'third_canary_authorization_candidate_1',
      grant_candidate_id: 'third_canary_grant_candidate_1',
      reservation_candidate_id: 'third_canary_reservation_candidate_1'
    },
    exact_scope: {
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path: '/',
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1
    },
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    trial_id: 'third_canary_trial_1',
    materialization_contract: readiness(),
    authorization_candidate_id: 'third_canary_authorization_candidate_1',
    grant_candidate_id: 'third_canary_grant_candidate_1',
    reservation_candidate_id: 'third_canary_reservation_candidate_1',
    expires_at: '2026-09-21T16:31:00.000Z',
    production_allowed: false,
    ...overrides
  };
}

const options = () => ({ clock: () => NOW });

test('materializes only the fresh grant and keeps execution blocked', () => {
  const result = materializePublicWebThirdCanaryGrant(input(), options());
  assert.equal(result.ok, true);
  assert.equal(result.grant_materialized, true);
  assert.equal(result.authorization_materialized, false);
  assert.equal(result.reservation_materialized, false);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.grant.grant_id, 'third_canary_grant_candidate_1');
  assert.equal(result.grant.authorization_candidate_id, 'third_canary_authorization_candidate_1');
  assert.equal(result.next_gate, 'SEPARATE_AUTHORIZATION_MATERIALIZATION_LAYER');
});

test('requires the preceding materialization contract and exact candidate bindings', () => {
  for (const patch of [
    { materialization_contract: { ...readiness(), ok: false } },
    { trial_id: 'other_trial' },
    { grant_candidate_id: 'other_grant' },
    { authorization_candidate_id: 'other_authorization' },
    { reservation_candidate_id: 'other_reservation' }
  ]) assert.equal(materializePublicWebThirdCanaryGrant(input(patch), options()).ok, false);
});

test('fails closed when the approved scope is altered', () => {
  for (const exact_scope of [
    { ...readiness().exact_scope, environment: 'production' },
    { ...readiness().exact_scope, target_origin: 'https://www.example.com' },
    { ...readiness().exact_scope, target_path: '/other' },
    { ...readiness().exact_scope, method: 'POST' },
    { ...readiness().exact_scope, port: 80 },
    { ...readiness().exact_scope, maximum_requests: 2 },
    { ...readiness().exact_scope, rollout_percentage: 2 }
  ]) {
    const materialization_contract = readiness({ exact_scope });
    assert.equal(materializePublicWebThirdCanaryGrant(input({ materialization_contract }), options()).ok, false);
  }
});

test('cannot carry execution authority or reservation/start/consume actions', () => {
  for (const patch of [
    { production_allowed: true },
    { human_authorized: true },
    { explicit_human_execution_authorized: true },
    { execute: true },
    { start: true },
    { consume: true },
    { reserve: true }
  ]) {
    const result = materializePublicWebThirdCanaryGrant(input(patch), options());
    assert.equal(result.ok, false);
    assert.equal(result.external_network_called, false);
  }
});

test('fails closed for expired or oversized grant windows', () => {
  assert.equal(materializePublicWebThirdCanaryGrant(input({ expires_at: NOW }), options()).ok, false);
  assert.equal(materializePublicWebThirdCanaryGrant(input({ expires_at: '2026-09-21T16:33:00.001Z' }), options()).ok, false);
});
