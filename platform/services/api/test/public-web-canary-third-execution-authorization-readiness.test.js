'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  preparePublicWebThirdCanaryExecutionAuthorizationReadiness
} = require('../src/core/public-web-canary-third-execution-authorization-readiness');

function adapter(adapterPatch = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_OPERATIONAL_ADAPTER_READY_OFFLINE_NOT_AUTHORIZED',
    trial_id: 'trial-3',
    adapter: {
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
      ...adapterPatch
    }
  };
}

function input(patch = {}) {
  return {
    trial_id: 'trial-3',
    authorization_id: 'authorization-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    operational_adapter: adapter(),
    production_allowed: false,
    ...patch
  };
}

test('prepares freshness requirements but does not accept or issue execution authority', () => {
  const result = preparePublicWebThirdCanaryExecutionAuthorizationReadiness(input());
  assert.equal(result.ok, true);
  assert.equal(result.authorization_readiness, true);
  assert.equal(result.human_authorization_accepted, false);
  assert.equal(result.execution_authorization_issued, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.requirements.maximum_execution_authorization_age_ms, 120000);
  assert.equal(result.requirements.fresh_grant_required, true);
  assert.equal(result.requirements.fresh_reservation_required, true);
  assert.equal(result.requirements.single_use_required, true);
  assert.equal(result.requirements.replay_forbidden, true);
  assert.equal(result.next_gate, 'FRESH_EXPLICIT_HUMAN_EXECUTION_AUTHORIZATION');
});

test('requires exact operational adapter bindings', () => {
  for (const patch of [
    { operational_adapter: { ...adapter(), ok: false } },
    { trial_id: 'other-trial' },
    { authorization_id: 'other-authorization' },
    { grant_id: 'other-grant' },
    { reservation_id: 'other-reservation' }
  ]) assert.equal(preparePublicWebThirdCanaryExecutionAuthorizationReadiness(input(patch)).ok, false);
});

test('fails closed on altered target or execution state', () => {
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
    assert.equal(preparePublicWebThirdCanaryExecutionAuthorizationReadiness(input({
      operational_adapter: adapter(patch)
    })).ok, false);
  }
});

test('refuses human confirmation, authority issuance, resource consumption and network actions', () => {
  for (const patch of [
    { production_allowed: true },
    { operator_confirmation: 'EXECUTAR CANARY PUBLIC WEB' },
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
    const result = preparePublicWebThirdCanaryExecutionAuthorizationReadiness(input(patch));
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
