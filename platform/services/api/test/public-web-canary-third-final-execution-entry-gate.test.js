'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  preparePublicWebThirdCanaryFinalExecutionEntry
} = require('../src/core/public-web-canary-third-final-execution-entry-gate');

const NOW = '2026-09-22T20:00:00.000Z';

function atomicCommit(overrides = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_COMMITTED_EXECUTION_RESERVED_NOT_EXECUTED',
    trial_id: 'trial-3',
    official_authorization_id: 'official-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    transaction_committed: true,
    resources_consumed: true,
    execution_reserved: true,
    execution_started: false,
    external_network_called: false,
    production_allowed: false,
    ...overrides
  };
}

function input(overrides = {}) {
  return {
    atomic_commit: atomicCommit(),
    trial_id: 'trial-3',
    official_authorization_id: 'official-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    execution_scope: {
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path: '/',
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1
    },
    official_execution_authorization: {
      authorization_id: 'official-3',
      trial_id: 'trial-3',
      environment: 'staging',
      issued_at: '2026-09-22T19:59:30.000Z',
      expires_at: '2026-09-22T20:01:30.000Z',
      used: false
    },
    production_allowed: false,
    ...overrides
  };
}

const clock = () => NOW;

test('final gate prepares exact execution entry but does not execute', () => {
  const result = preparePublicWebThirdCanaryFinalExecutionEntry(input(), { clock });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'THIRD_CANARY_FINAL_EXECUTION_ENTRY_READY_NOT_STARTED');
  assert.equal(result.execution_entry_ready, true);
  assert.equal(result.execution_authorized, true);
  assert.equal(result.execution_started, false);
  assert.equal(result.provider_invoked, false);
  assert.equal(result.transport_invoked, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.production_allowed, false);
  assert.equal(result.requires_fresh_explicit_human_execution_authorization_at_side_effect_boundary, true);
  assert.equal(result.required_confirmation, 'EXECUTAR CANARY PUBLIC WEB');
});

test('final gate fails closed without exact durable atomic commit', () => {
  for (const mutation of [
    { transaction_committed: false },
    { resources_consumed: false },
    { execution_reserved: false },
    { execution_started: true },
    { external_network_called: true },
    { production_allowed: true }
  ]) {
    const result = preparePublicWebThirdCanaryFinalExecutionEntry(input({ atomic_commit: atomicCommit(mutation) }), { clock });
    assert.equal(result.ok, false);
  }
});

test('final gate rejects identity and target scope drift', () => {
  assert.equal(preparePublicWebThirdCanaryFinalExecutionEntry(input({ grant_id: 'other' }), { clock }).ok, false);
  assert.equal(preparePublicWebThirdCanaryFinalExecutionEntry(input({
    execution_scope: { ...input().execution_scope, target_origin: 'https://other.example' }
  }), { clock }).ok, false);
});

test('final gate rejects stale or mismatched official authorization evidence', () => {
  assert.equal(preparePublicWebThirdCanaryFinalExecutionEntry(input({
    official_execution_authorization: { ...input().official_execution_authorization, authorization_id: 'other' }
  }), { clock }).ok, false);
  assert.equal(preparePublicWebThirdCanaryFinalExecutionEntry(input({
    official_execution_authorization: { ...input().official_execution_authorization, expires_at: '2026-09-22T19:59:59.000Z' }
  }), { clock }).ok, false);
});

test('final gate forbids execution and network activity in this layer', () => {
  for (const mutation of [
    { execute: true },
    { start_execution: true },
    { provider_invoked: true },
    { transport_invoked: true },
    { external_network_called: true },
    { production_allowed: true }
  ]) {
    const result = preparePublicWebThirdCanaryFinalExecutionEntry(input(mutation), { clock });
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
