'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  preparePublicWebThirdCanaryAtomicResourceGate
} = require('../src/core/public-web-canary-third-atomic-resource-gate');

const NOW = '2026-09-22T15:00:00.000Z';
const options = { clock: () => NOW };

function issuance(patch = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_OFFICIAL_EXECUTION_AUTHORIZATION_ISSUED_NOT_CONSUMED_NOT_EXECUTED',
    trial_id: 'trial-3',
    preparatory_authorization_id: 'prep-auth-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    official_execution_authorization_issued: true,
    authorization_consumed: false,
    grant_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    official_execution_authorization: {
      authorization_id: 'official-auth-3',
      trial_id: 'trial-3',
      environment: 'staging',
      expires_at: '2026-09-22T15:02:00.000Z',
      used: false
    },
    ...patch
  };
}

function input(patch = {}) {
  return {
    trial_id: 'trial-3',
    preparatory_authorization_id: 'prep-auth-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    official_authorization_issuance: issuance(),
    production_allowed: false,
    ...patch
  };
}

test('prepares atomic single-use plan without mutating any resource', () => {
  const result = preparePublicWebThirdCanaryAtomicResourceGate(input(), options);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'THIRD_CANARY_ATOMIC_RESOURCE_GATE_READY_NOT_CONSUMED_NOT_RESERVED_NOT_EXECUTED');
  assert.deepEqual(result.atomic_resource_plan.required_order, [
    'VALIDATE_ALL_SINGLE_USE_RESOURCES',
    'BEGIN_ATOMIC_BOUNDARY',
    'CONSUME_OFFICIAL_AUTHORIZATION',
    'CONSUME_GRANT',
    'RESERVE_RESERVATION_FOR_EXECUTION',
    'COMMIT_ATOMIC_BOUNDARY'
  ]);
  assert.equal(result.atomic_resource_plan.rollback_required_on_any_failure, true);
  assert.equal(result.atomic_resource_plan.same_runtime_registry_lifecycle_required, true);
  assert.equal(result.atomic_resource_plan.durable_replay_state_required_before_external_execution, true);
  assert.equal(result.official_authorization_consumed, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.execution_reserved, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
});

test('fails closed on stale, used, or mismatched authorization', () => {
  for (const authPatch of [
    { used: true },
    { trial_id: 'other' },
    { environment: 'production' },
    { expires_at: '2026-09-22T15:00:00.000Z' },
    { expires_at: '2026-09-22T15:02:00.001Z' }
  ]) {
    const step = issuance();
    step.official_execution_authorization = {
      ...step.official_execution_authorization,
      ...authPatch
    };
    assert.equal(preparePublicWebThirdCanaryAtomicResourceGate(input({
      official_authorization_issuance: step
    }), options).ok, false);
  }
});

test('fails closed on identity mismatch', () => {
  for (const patch of [
    { trial_id: 'other' },
    { preparatory_authorization_id: 'other' },
    { grant_id: 'other' },
    { reservation_id: 'other' }
  ]) assert.equal(preparePublicWebThirdCanaryAtomicResourceGate(input(patch), options).ok, false);
});

test('forbids mutation, execution, network, production and registry access', () => {
  for (const patch of [
    { production_allowed: true },
    { consume_authorization: true },
    { consume_grant: true },
    { consume_reservation: true },
    { reserve_execution: true },
    { start_execution: true },
    { execute: true },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true }
  ]) assert.equal(preparePublicWebThirdCanaryAtomicResourceGate(input(patch), options).ok, false);

  assert.equal(preparePublicWebThirdCanaryAtomicResourceGate(input(), {
    ...options,
    authorization_registry: {}
  }).ok, false);
});
