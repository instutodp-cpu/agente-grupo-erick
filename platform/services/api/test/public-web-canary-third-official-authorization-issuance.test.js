'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REQUIRED_CONFIRMATION,
  issuePublicWebThirdCanaryOfficialAuthorization
} = require('../src/core/public-web-canary-third-official-authorization-issuance');

const NOW = '2026-09-22T13:30:00.000Z';
const options = { clock: () => NOW };

function bindings(patch = {}) {
  return {
    ok: true,
    status: 'THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_READY_NOT_ISSUED_NOT_EXECUTED',
    trial_id: 'trial-3',
    preparatory_authorization_id: 'prep-auth-3',
    grant_id: 'grant-3',
    reservation_id: 'reservation-3',
    official_execution_authorization_issued: false,
    execution_authorized: false,
    official_authorization_input: {
      trial: {
        trial_id: 'trial-3',
        canary_session_id: 'session-3',
        plan_hash: 'plan-hash',
        environment: 'staging',
        target_origin: 'https://example.com',
        target_path_hash: 'path-hash',
        operation: 'fetch_public_page_summary',
        canary_session_version: 'session-v1',
        target_policy_version: 'policy-v1',
        lifecycle_version: 'lifecycle-v1',
        configuration_version: 'configuration-v1',
        readiness_evidence_id: 'readiness-3'
      },
      preflight_evidence_hash: 'preflight-hash',
      dry_run_evidence_hash: 'dry-run-hash',
      canary_session_version: 'session-v1',
      target_policy_version: 'policy-v1',
      lifecycle_version: 'lifecycle-v1',
      configuration_version: 'configuration-v1',
      readiness_evidence_id: 'readiness-3',
      maximum_authorization_age_ms: 120000
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
    runtime_authorization_bindings: bindings(),
    operator_confirmation: REQUIRED_CONFIRMATION,
    confirmed_at: '2026-09-22T13:29:30.000Z',
    production_allowed: false,
    ...patch
  };
}

test('issues official authorization but does not consume resources or execute', () => {
  const result = issuePublicWebThirdCanaryOfficialAuthorization(input(), options);
  assert.equal(result.ok, true);
  assert.equal(result.official_execution_authorization_issued, true);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.authorization_consumed, false);
  assert.equal(result.grant_consumed, false);
  assert.equal(result.reservation_consumed, false);
  assert.equal(result.execution_reserved, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.provider_invoked, false);
  assert.equal(result.transport_invoked, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.official_execution_authorization.trial_id, 'trial-3');
  assert.equal(result.official_execution_authorization.canary_session_id, 'session-3');
  assert.equal(result.official_execution_authorization.used, false);
  assert.equal(result.official_execution_authorization.expires_at, '2026-09-22T13:32:00.000Z');
});

test('requires exact fresh confirmation at issuance', () => {
  assert.equal(issuePublicWebThirdCanaryOfficialAuthorization(input({
    operator_confirmation: 'executar canary public web'
  }), options).ok, false);
  assert.equal(issuePublicWebThirdCanaryOfficialAuthorization(input({
    confirmed_at: '2026-09-22T13:27:59.999Z'
  }), options).ok, false);
  assert.equal(issuePublicWebThirdCanaryOfficialAuthorization(input({
    confirmed_at: '2026-09-22T13:30:00.001Z'
  }), options).ok, false);
});

test('fails closed on altered bindings or runtime scope', () => {
  for (const patch of [
    { trial_id: 'other' },
    { preparatory_authorization_id: 'other' },
    { grant_id: 'other' },
    { reservation_id: 'other' }
  ]) assert.equal(issuePublicWebThirdCanaryOfficialAuthorization(input(patch), options).ok, false);

  const bad = bindings();
  bad.official_authorization_input = {
    ...bad.official_authorization_input,
    trial: { ...bad.official_authorization_input.trial, target_origin: 'https://www.example.com' }
  };
  assert.equal(issuePublicWebThirdCanaryOfficialAuthorization(input({
    runtime_authorization_bindings: bad
  }), options).ok, false);
});

test('issuance cannot consume, reserve, execute or access network', () => {
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
  ]) {
    const result = issuePublicWebThirdCanaryOfficialAuthorization(input(patch), options);
    assert.equal(result.ok, false);
    assert.equal(result.execution_started, false);
    assert.equal(result.external_network_called, false);
  }
});
