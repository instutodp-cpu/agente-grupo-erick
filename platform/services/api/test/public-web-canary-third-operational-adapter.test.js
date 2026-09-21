'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { preparePublicWebThirdCanaryOperationalAdapter } = require('../src/core/public-web-canary-third-operational-adapter');

function executionWiring(wiringPatch = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_EXECUTION_WIRING_READY_NOT_AUTHORIZED',
    trial_id: 'trial-3',
    wiring: {
      trial_id: 'trial-3',
      authorization_id: 'authorization-3',
      grant_id: 'grant-3',
      reservation_id: 'reservation-3',
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path: '/',
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1,
      execution_authorization_required: true,
      execution_reservation_required: true,
      execution_authorized: false,
      execution_reserved: false,
      execution_started: false,
      ...wiringPatch
    }
  };
}

function input(patch = {}) {
  return {
    trial_id: 'trial-3',
    authorization_id: 'authorization-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    execution_wiring: executionWiring(),
    production_allowed: false,
    ...patch
  };
}

test('adapts #226 wiring offline and stops before execution authorization', () => {
  const result = preparePublicWebThirdCanaryOperationalAdapter(input());
  assert.equal(result.ok, true);
  assert.equal(result.adapter_ready, true);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.execution_reserved, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.authorization_consumed, false);
  assert.equal(result.reservation_consumed, false);
  assert.equal(result.provider_invoked, false);
  assert.equal(result.transport_invoked, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.next_gate, 'SEPARATE_EXPLICIT_HUMAN_EXECUTION_AUTHORIZATION_LAYER');
});

test('requires exact #226 wiring bindings', () => {
  for (const patch of [
    { execution_wiring: { ...executionWiring(), ok: false } },
    { trial_id: 'other-trial' },
    { authorization_id: 'other-authorization' },
    { grant_id: 'other-grant' },
    { reservation_id: 'other-reservation' }
  ]) assert.equal(preparePublicWebThirdCanaryOperationalAdapter(input(patch)).ok, false);
});

test('fails closed on altered scope or wiring execution state', () => {
  for (const patch of [
    { environment: 'production' },
    { target_origin: 'https://www.example.com' },
    { target_path: '/other' },
    { method: 'POST' },
    { port: 80 },
    { maximum_requests: 2 },
    { rollout_percentage: 2 },
    { execution_authorization_required: false },
    { execution_reservation_required: false },
    { execution_authorized: true },
    { execution_reserved: true },
    { execution_started: true }
  ]) {
    assert.equal(preparePublicWebThirdCanaryOperationalAdapter(input({
      execution_wiring: executionWiring(patch)
    })).ok, false);
  }
});

test('forbids human authorization, resource consumption, runtime and network actions', () => {
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
    const result = preparePublicWebThirdCanaryOperationalAdapter(input(patch));
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
