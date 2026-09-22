'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  preparePublicWebThirdCanaryRuntimeAuthorizationBindings
} = require('../src/core/public-web-canary-third-runtime-authorization-bindings');

const NOW = '2026-09-22T10:10:00.000Z';
const options = { clock: () => NOW };

function gate(intentPatch = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_HUMAN_AUTHORIZATION_ACCEPTED_NOT_ISSUED_NOT_EXECUTED',
    trial_id: 'trial-3',
    human_authorization_accepted: true,
    execution_authorization_issued: false,
    execution_authorized: false,
    authorization_intent: {
      trial_id: 'trial-3',
      authorization_id: 'prep-auth-3',
      grant_id: 'grant-3',
      reservation_id: 'reservation-3',
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path: '/',
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1,
      authorized_at: '2026-09-22T10:09:30.000Z',
      maximum_age_ms: 120000,
      single_use: true,
      used: false,
      official_execution_authorization_issued: false,
      execution_reserved: false,
      execution_started: false,
      ...intentPatch
    }
  };
}

function runtime(patch = {}) {
  return {
    trial_id: 'trial-3',
    canary_session_id: 'session-3',
    plan_hash: 'plan-hash',
    preflight_evidence_hash: 'preflight-hash',
    dry_run_evidence_hash: 'dry-run-hash',
    environment: 'staging',
    target_origin: 'https://example.com',
    target_path: '/',
    target_path_hash: 'path-hash',
    operation: 'fetch_public_page_summary',
    canary_session_version: 'session-v1',
    target_policy_version: 'policy-v1',
    lifecycle_version: 'lifecycle-v1',
    configuration_version: 'configuration-v1',
    readiness_evidence_id: 'readiness-3',
    ...patch
  };
}

function input(patch = {}) {
  return {
    trial_id: 'trial-3',
    authorization_id: 'prep-auth-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    human_authorization_gate: gate(),
    runtime_bindings: runtime(),
    production_allowed: false,
    ...patch
  };
}

test('prepares complete official authorization bindings without issuing or executing', () => {
  const result = preparePublicWebThirdCanaryRuntimeAuthorizationBindings(input(), options);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_READY_NOT_ISSUED_NOT_EXECUTED');
  assert.equal(result.official_execution_authorization_issued, false);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.reservation_consumed, false);
  assert.equal(result.execution_reserved, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.official_authorization_input.trial.canary_session_id, 'session-3');
  assert.equal(result.official_authorization_input.preflight_evidence_hash, 'preflight-hash');
  assert.equal(result.next_gate, 'ISSUE_FRESH_OFFICIAL_EXECUTION_AUTHORIZATION');
});

test('fails closed on stale human authorization or altered identity/scope', () => {
  assert.equal(preparePublicWebThirdCanaryRuntimeAuthorizationBindings(input({
    human_authorization_gate: gate({ authorized_at: '2026-09-22T10:07:59.999Z' })
  }), options).ok, false);
  for (const patch of [
    { trial_id: 'other' },
    { authorization_id: 'other' },
    { grant_id: 'other' },
    { reservation_id: 'other' }
  ]) assert.equal(preparePublicWebThirdCanaryRuntimeAuthorizationBindings(input(patch), options).ok, false);
  for (const patch of [
    { environment: 'production' },
    { target_origin: 'https://www.example.com' },
    { target_path: '/other' }
  ]) assert.equal(preparePublicWebThirdCanaryRuntimeAuthorizationBindings(input({
    runtime_bindings: runtime(patch)
  }), options).ok, false);
});

test('requires every official runtime authorization binding', () => {
  const keys = [
    'canary_session_id',
    'plan_hash',
    'preflight_evidence_hash',
    'dry_run_evidence_hash',
    'target_path_hash',
    'operation',
    'canary_session_version',
    'target_policy_version',
    'lifecycle_version',
    'configuration_version',
    'readiness_evidence_id'
  ];
  for (const key of keys) {
    assert.equal(preparePublicWebThirdCanaryRuntimeAuthorizationBindings(input({
      runtime_bindings: runtime({ [key]: '' })
    }), options).ok, false);
  }
});

test('cannot issue, consume, reserve, execute or access network', () => {
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
    const result = preparePublicWebThirdCanaryRuntimeAuthorizationBindings(input(patch), options);
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
