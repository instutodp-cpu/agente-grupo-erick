'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { preparePublicWebThirdCanaryExecutionWiring } = require('../src/core/public-web-canary-third-execution-wiring-gate');

function reservationMaterialization(reservationPatch = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_RESERVATION_MATERIALIZED_NOT_RESERVED_FOR_EXECUTION',
    trial_id: 'trial-3',
    reservation: {
      reservation_id: 'reservation-3',
      trial_id: 'trial-3',
      authorization_id: 'authorization-3',
      grant_id: 'grant-3',
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path: '/',
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1,
      single_use: true,
      used: false,
      execution_reserved: false,
      ...reservationPatch
    }
  };
}

function input(patch = {}) {
  return {
    trial_id: 'trial-3',
    authorization_id: 'authorization-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    reservation_materialization: reservationMaterialization(),
    production_allowed: false,
    ...patch
  };
}

test('prepares wiring only and stops before human execution authorization', () => {
  const result = preparePublicWebThirdCanaryExecutionWiring(input());
  assert.equal(result.ok, true);
  assert.equal(result.wiring_ready, true);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.execution_reserved, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.authorization_consumed, false);
  assert.equal(result.reservation_consumed, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.next_gate, 'EXPLICIT_HUMAN_AUTHORIZATION_FOR_REAL_THIRD_CANARY_EXECUTION');
});

test('requires exact materialized resource bindings', () => {
  for (const patch of [
    { reservation_materialization: { ...reservationMaterialization(), ok: false } },
    { trial_id: 'other-trial' },
    { authorization_id: 'other-authorization' },
    { grant_id: 'other-grant' },
    { reservation_id: 'other-reservation' }
  ]) assert.equal(preparePublicWebThirdCanaryExecutionWiring(input(patch)).ok, false);
});

test('fails closed on altered scope or reservation state', () => {
  for (const patch of [
    { environment: 'production' },
    { target_origin: 'https://www.example.com' },
    { target_path: '/other' },
    { method: 'POST' },
    { port: 80 },
    { maximum_requests: 2 },
    { rollout_percentage: 2 },
    { single_use: false },
    { used: true },
    { execution_reserved: true }
  ]) {
    assert.equal(preparePublicWebThirdCanaryExecutionWiring(input({
      reservation_materialization: reservationMaterialization(patch)
    })).ok, false);
  }
});

test('cannot issue or consume execution authority, reserve, start or touch network', () => {
  for (const patch of [
    { production_allowed: true },
    { explicit_human_execution_authorized: true },
    { human_authorized: true },
    { issue_execution_authorization: true },
    { consume_authorization: true },
    { consume_grant: true },
    { consume_reservation: true },
    { reserve_execution: true },
    { start_execution: true },
    { execute: true },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true }
  ]) {
    const result = preparePublicWebThirdCanaryExecutionWiring(input(patch));
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
