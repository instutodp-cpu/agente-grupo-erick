'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  materializePublicWebThirdCanaryReservation
} = require('../src/core/public-web-canary-third-reservation-materializer');

function authorizationMaterialization(overrides = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_AUTHORIZATION_MATERIALIZED_NOT_AUTHORIZED_FOR_EXECUTION',
    trial_id: 'third_canary_trial_1',
    authorization: {
      authorization_id: 'third_canary_authorization_candidate_1',
      trial_id: 'third_canary_trial_1',
      grant_id: 'third_canary_grant_candidate_1',
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path: '/',
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1,
      single_use: true,
      used: false,
      execution_authorized: false
    },
    ...overrides
  };
}

function materializationContract(overrides = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_MATERIALIZATION_CONTRACT_READY',
    trial_id: 'third_canary_trial_1',
    candidate_ids: {
      authorization_candidate_id: 'third_canary_authorization_candidate_1',
      grant_candidate_id: 'third_canary_grant_candidate_1',
      reservation_candidate_id: 'third_canary_reservation_candidate_1'
    },
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    trial_id: 'third_canary_trial_1',
    materialization_contract: materializationContract(),
    authorization_materialization: authorizationMaterialization(),
    authorization_id: 'third_canary_authorization_candidate_1',
    grant_id: 'third_canary_grant_candidate_1',
    reservation_candidate_id: 'third_canary_reservation_candidate_1',
    production_allowed: false,
    ...overrides
  };
}

test('materializes reservation identity without reserving execution', () => {
  const result = materializePublicWebThirdCanaryReservation(input());
  assert.equal(result.ok, true);
  assert.equal(result.reservation_materialized, true);
  assert.equal(result.reservation.reservation_id, 'third_canary_reservation_candidate_1');
  assert.equal(result.reservation.execution_reserved, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.authorization_consumed, false);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.next_gate, 'EXPLICIT_HUMAN_AUTHORIZATION_BEFORE_EXECUTION_WIRING');
});

test('requires exact trial, grant and authorization bindings', () => {
  for (const patch of [
    { materialization_contract: { ...materializationContract(), ok: false } },
    { materialization_contract: materializationContract({ trial_id: 'other_trial' }) },
    { materialization_contract: materializationContract({ candidate_ids: { ...materializationContract().candidate_ids, reservation_candidate_id: 'other_reservation' } }) },
    { authorization_materialization: { ...authorizationMaterialization(), ok: false } },
    { trial_id: 'other_trial' },
    { authorization_id: 'other_authorization' },
    { grant_id: 'other_grant' },
    { reservation_candidate_id: '' }
  ]) assert.equal(materializePublicWebThirdCanaryReservation(input(patch)).ok, false);
});

test('fails closed when authorization scope or state is altered', () => {
  for (const authorizationPatch of [
    { environment: 'production' },
    { target_origin: 'https://www.example.com' },
    { target_path: '/other' },
    { method: 'POST' },
    { port: 80 },
    { maximum_requests: 2 },
    { rollout_percentage: 2 },
    { single_use: false },
    { used: true },
    { execution_authorized: true }
  ]) {
    const authorization_materialization = authorizationMaterialization({
      authorization: { ...authorizationMaterialization().authorization, ...authorizationPatch }
    });
    assert.equal(materializePublicWebThirdCanaryReservation(input({ authorization_materialization })).ok, false);
  }
});

test('cannot carry execution authority, execution reservation or network actions', () => {
  for (const patch of [
    { production_allowed: true },
    { explicit_human_execution_authorized: true },
    { human_authorized: true },
    { execute: true },
    { start: true },
    { consume: true },
    { reserve_execution: true },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true }
  ]) {
    const result = materializePublicWebThirdCanaryReservation(input(patch));
    assert.equal(result.ok, false);
    assert.equal(result.execution_reserved, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
