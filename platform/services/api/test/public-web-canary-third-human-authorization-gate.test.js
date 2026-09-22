'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REQUIRED_CONFIRMATION,
  preparePublicWebThirdCanaryHumanAuthorization
} = require('../src/core/public-web-canary-third-human-authorization-gate');

const NOW = '2026-09-22T00:30:00.000Z';

function readiness(requirementPatch = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_EXECUTION_AUTHORIZATION_REQUIREMENTS_READY_NOT_AUTHORIZED',
    trial_id: 'trial-3',
    requirements: {
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
      exact_human_confirmation_required: true,
      official_execution_authorization_required: true,
      maximum_execution_authorization_age_ms: 120000,
      fresh_grant_required: true,
      fresh_reservation_required: true,
      single_use_required: true,
      replay_forbidden: true,
      execution_authorized: false,
      execution_reserved: false,
      execution_started: false,
      ...requirementPatch
    }
  };
}

function input(patch = {}) {
  return {
    trial_id: 'trial-3',
    authorization_id: 'authorization-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    authorization_readiness: readiness(),
    production_allowed: false,
    operator_confirmation: REQUIRED_CONFIRMATION,
    authorized_at: '2026-09-22T00:29:30.000Z',
    ...patch
  };
}

const options = { clock: () => NOW };

test('accepts exact fresh human authorization but does not issue or execute anything', () => {
  const result = preparePublicWebThirdCanaryHumanAuthorization(input(), options);
  assert.equal(result.ok, true);
  assert.equal(result.human_authorization_accepted, true);
  assert.equal(result.execution_authorization_issued, false);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.authorization_consumed, false);
  assert.equal(result.reservation_consumed, false);
  assert.equal(result.execution_reserved, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.provider_invoked, false);
  assert.equal(result.transport_invoked, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.next_gate, 'ISSUE_FRESH_OFFICIAL_EXECUTION_AUTHORIZATION_WITHOUT_EXECUTION');
});

test('requires exact confirmation and freshness no older than 120 seconds', () => {
  assert.equal(preparePublicWebThirdCanaryHumanAuthorization(input({
    operator_confirmation: 'executar canary public web'
  }), options).ok, false);
  assert.equal(preparePublicWebThirdCanaryHumanAuthorization(input({
    authorized_at: '2026-09-22T00:27:59.999Z'
  }), options).ok, false);
  assert.equal(preparePublicWebThirdCanaryHumanAuthorization(input({
    authorized_at: '2026-09-22T00:30:00.001Z'
  }), options).ok, false);
});

test('requires exact readiness bindings and approved scope', () => {
  for (const patch of [
    { authorization_readiness: { ...readiness(), ok: false } },
    { trial_id: 'other-trial' },
    { authorization_id: 'other-authorization' },
    { grant_id: 'other-grant' },
    { reservation_id: 'other-reservation' }
  ]) assert.equal(preparePublicWebThirdCanaryHumanAuthorization(input(patch), options).ok, false);

  for (const patch of [
    { environment: 'production' },
    { target_origin: 'https://www.example.com' },
    { target_path: '/other' },
    { method: 'POST' },
    { port: 80 },
    { maximum_requests: 2 },
    { rollout_percentage: 2 },
    { maximum_execution_authorization_age_ms: 120001 },
    { fresh_grant_required: false },
    { fresh_reservation_required: false },
    { single_use_required: false },
    { replay_forbidden: false },
    { execution_authorized: true },
    { execution_reserved: true },
    { execution_started: true }
  ]) assert.equal(preparePublicWebThirdCanaryHumanAuthorization(input({
    authorization_readiness: readiness(patch)
  }), options).ok, false);
});

test('human authorization gate cannot issue, consume, reserve, execute or access network', () => {
  for (const patch of [
    { production_allowed: true },
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
    const result = preparePublicWebThirdCanaryHumanAuthorization(input(patch), options);
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
