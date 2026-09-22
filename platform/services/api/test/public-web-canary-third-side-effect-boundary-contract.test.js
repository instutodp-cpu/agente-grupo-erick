'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REQUIRED_CONFIRMATION,
  preparePublicWebThirdCanarySideEffectBoundary
} = require('../src/core/public-web-canary-third-side-effect-boundary-contract');

const NOW = '2026-09-22T21:00:00.000Z';
const scope = {
  environment: 'staging', target_origin: 'https://example.com', target_path: '/',
  method: 'GET', port: 443, maximum_requests: 1, rollout_percentage: 1
};
const ids = {
  trial_id: 'trial-3', official_authorization_id: 'official-3',
  preparatory_authorization_id: 'prep-3', grant_id: 'grant-3', reservation_id: 'reservation-3'
};

function prior() {
  return {
    ok: true,
    status: 'THIRD_CANARY_PRE_EXECUTION_ORCHESTRATION_READY_NOT_STARTED',
    ...ids,
    durable_resources_materialized: true,
    resources_consumed: true,
    execution_reserved: true,
    execution_entry_ready: true,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    requires_fresh_explicit_human_execution_authorization_at_side_effect_boundary: true,
    required_confirmation: REQUIRED_CONFIRMATION,
    final_execution_entry: {
      ok: true,
      status: 'THIRD_CANARY_FINAL_EXECUTION_ENTRY_READY_NOT_STARTED',
      trial_id: ids.trial_id,
      official_authorization_id: ids.official_authorization_id,
      grant_id: ids.grant_id,
      reservation_id: ids.reservation_id,
      execution_scope: scope,
      execution_started: false,
      external_network_called: false,
      required_confirmation: REQUIRED_CONFIRMATION
    }
  };
}

function input(patch = {}) {
  return {
    ...ids,
    pre_execution_orchestration: prior(),
    execution_scope: scope,
    operator_confirmation: REQUIRED_CONFIRMATION,
    confirmed_at: '2026-09-22T20:59:30.000Z',
    production_allowed: false,
    ...patch
  };
}

const options = { clock: () => NOW };

test('prepares immutable single-request command but never invokes a side effect', () => {
  const result = preparePublicWebThirdCanarySideEffectBoundary(input(), options);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'THIRD_CANARY_SIDE_EFFECT_BOUNDARY_READY_COMMAND_PREPARED_NOT_EXECUTED');
  assert.equal(result.execution_command.maximum_requests, 1);
  assert.equal(result.execution_command.redirects_allowed, false);
  assert.equal(result.execution_command.production_allowed, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.provider_invoked, false);
  assert.equal(result.transport_invoked, false);
  assert.equal(result.external_network_called, false);
  assert.equal(Object.isFrozen(result.execution_command), true);
});

test('requires exact fresh confirmation at this boundary', () => {
  assert.equal(preparePublicWebThirdCanarySideEffectBoundary(input({ operator_confirmation: 'EXECUTAR' }), options).ok, false);
  assert.equal(preparePublicWebThirdCanarySideEffectBoundary(input({ confirmed_at: '2026-09-22T20:57:59.000Z' }), options).ok, false);
  assert.equal(preparePublicWebThirdCanarySideEffectBoundary(input({ confirmed_at: '2026-09-22T21:00:01.000Z' }), options).ok, false);
});

test('fails closed on identity, scope or upstream-state drift', () => {
  assert.equal(preparePublicWebThirdCanarySideEffectBoundary(input({ grant_id: 'other' }), options).ok, false);
  assert.equal(preparePublicWebThirdCanarySideEffectBoundary(input({
    execution_scope: { ...scope, target_origin: 'https://other.example' }
  }), options).ok, false);
  const p = prior();
  p.resources_consumed = false;
  assert.equal(preparePublicWebThirdCanarySideEffectBoundary(input({ pre_execution_orchestration: p }), options).ok, false);
});

test('forbids runtime dependencies and actions in the contract layer', () => {
  for (const patch of [
    { execute: true }, { start_execution: true }, { provider_invoked: true },
    { transport_invoked: true }, { external_network_called: true }, { production_allowed: true },
    { runner: {} }, { transport: {} }, { http_client: {} }, { network_client: {} }
  ]) {
    const result = preparePublicWebThirdCanarySideEffectBoundary(input(patch), options);
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
