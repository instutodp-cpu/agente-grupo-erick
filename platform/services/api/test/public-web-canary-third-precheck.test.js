'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createPublicWebCanaryTargetAllowlist } = require('../src/core/public-web-canary-target-allowlist');
const {
  preparePublicWebThirdCanaryPrecheck,
  validateThirdCanaryTelemetry
} = require('../src/pilots/public-web-canary-third-precheck');

const NOW = '2026-09-19T12:00:00.000Z';
const TRIAL_ID = 'public_web_trial_third_precheck_offline';

function allowlist() {
  const targetAllowlist = createPublicWebCanaryTargetAllowlist({ clock: () => NOW });
  const registered = targetAllowlist.registerTargetPolicy({
    target_policy_id: 'staging_external_target_policy_test',
    environment: 'staging',
    origin: 'https://staging.example.test',
    allowed_path_prefixes: ['/approved'],
    allowed_operations: ['fetch_public_page_summary'],
    allowed_source_types: ['public_product_page'],
    allowed_content_types: ['text/html'],
    maximum_requests: 1,
    maximum_response_bytes: 4096,
    timeout_ms: 3000,
    redirects_allowed: false,
    enabled: true,
    revoked: false,
    expires_at: '2026-09-19T13:00:00.000Z',
    approved_by: 'human_staging_approver',
    created_at: NOW,
    version: 1
  });
  assert.equal(registered.ok, true);
  return targetAllowlist;
}

function validInput(overrides = {}) {
  return {
    identity: { trial_id: TRIAL_ID, previous_canary_ids: ['public_web_trial_second_20260919'], previous_resource_ids: ['previous-authorization', 'previous-grant', 'previous-reservation'] },
    environment: 'staging',
    production_allowed: false,
    maximum_requests: 1,
    rollout_percentage: 1,
    transport: {
      selected: 'official_public_web_real_transport_candidate',
      source: 'official_public_web_node_https_client',
      provider: 'official_public_web_provider',
      synthetic: false,
      enabled: true
    },
    gates: { feature_flag_enabled: true, kill_switch_active: false },
    target: {
      source: 'human_approved_staging_external',
      synthetic: false,
      origin: 'https://staging.example.test',
      path: '/approved/page',
      operation: 'fetch_public_page_summary',
      source_type: 'public_product_page',
      targetAllowlist: allowlist()
    },
    resources: {
      human_authorization: { id: 'third-authorization', trial_id: TRIAL_ID, fresh: true, single_use: true, consumed: false, reused: false, previously_used: false, human_authorized: false },
      grant: { id: 'third-grant', trial_id: TRIAL_ID, fresh: true, single_use: true, consumed: false, reused: false, previously_used: false },
      reservation: { id: 'third-reservation', trial_id: TRIAL_ID, fresh: true, single_use: true, consumed: false, reused: false, previously_used: false }
    },
    secret_reference: { reference_id: 'third-secret-reference', valid: true, revoked: false, disabled: false, materialized: false },
    audit_sink: { available: true, durable: true, append_durably_available: true },
    execution_policy: { attempt_count: 0, retry_enabled: false, replay_attempt: false, second_attempt: false },
    cleanup: { required: true, revocation_required: true, target_disable_required: true },
    evidence: { sanitized: true, sensitive_output_redacted: true },
    telemetry: { provider_invoked: false, transport_invoked: false, external_network_called: false, external_network_evidence: false },
    ...overrides
  };
}

test('valid staging precheck is offline-only and does not authorize execution', () => {
  const input = validInput();
  let httpCalls = 0;
  let dnsCalls = 0;
  input.transport.nodeHttpsClient = { execute() { httpCalls += 1; throw new Error('network_forbidden'); } };
  input.transport.dnsResolver = { resolve() { dnsCalls += 1; throw new Error('dns_forbidden'); } };
  const result = preparePublicWebThirdCanaryPrecheck(input);
  assert.equal(result.ok, true);
  assert.equal(result.real_canary_executable, false);
  assert.equal(result.grant_created, false);
  assert.equal(result.reservation_created, false);
  assert.equal(httpCalls, 0);
  assert.equal(dnsCalls, 0);
});

test('staging real transport requires explicit opt-in and synthetic transport cannot satisfy it', () => {
  assert.equal(preparePublicWebThirdCanaryPrecheck(validInput({ transport: { selected: 'official_public_web_real_transport_candidate', source: 'official_public_web_node_https_client', synthetic: false, enabled: false } })).ok, false);
  const synthetic = validInput({ transport: { selected: 'synthetic_local', source: 'fakeNodeHttpsClient', synthetic: true, enabled: true } });
  assert.equal(preparePublicWebThirdCanaryPrecheck(synthetic).reason_codes.includes('synthetic_transport_forbidden'), true);
});

test('production, request count, rollout, feature flag, and kill switch fail closed', () => {
  for (const [field, value, reason] of [
    ['production_allowed', true, 'production_must_remain_blocked'],
    ['maximum_requests', 2, 'maximum_requests_must_be_one'],
    ['rollout_percentage', 1.1, 'rollout_percentage_must_equal_one']
  ]) {
    const result = preparePublicWebThirdCanaryPrecheck(validInput({ [field]: value }));
    assert.equal(result.reason_codes.includes(reason), true);
  }
  assert.equal(preparePublicWebThirdCanaryPrecheck(validInput({ gates: { feature_flag_enabled: false, kill_switch_active: false } })).ok, false);
  assert.equal(preparePublicWebThirdCanaryPrecheck(validInput({ gates: { feature_flag_enabled: true, kill_switch_active: true } })).ok, false);
});

test('target and path require an explicitly approved external staging allowlist', () => {
  assert.equal(preparePublicWebThirdCanaryPrecheck(validInput({ target: undefined })).reason_codes.includes('target_required_from_human'), true);
  const outsidePath = validInput({ target: { ...validInput().target, path: '/not-approved/page' } });
  assert.equal(preparePublicWebThirdCanaryPrecheck(outsidePath).reason_codes.includes('target_or_path_not_allowlisted'), true);
  const synthetic = validInput({ target: { ...validInput().target, source: 'synthetic_local', synthetic: true } });
  assert.equal(preparePublicWebThirdCanaryPrecheck(synthetic).reason_codes.includes('target_external_staging_approval_required'), true);
});

test('fresh authorization, Grant, and Reservation are mandatory and prior resources are rejected', () => {
  assert.equal(preparePublicWebThirdCanaryPrecheck(validInput({ identity: { trial_id: TRIAL_ID } })).reason_codes.includes('previous_identity_snapshot_required'), true);
  for (const name of ['human_authorization', 'grant', 'reservation']) {
    const missing = validInput({ resources: { ...validInput().resources, [name]: undefined } });
    const resourceName = name === 'human_authorization' ? 'authorization' : name;
    assert.equal(preparePublicWebThirdCanaryPrecheck(missing).reason_codes.includes(`${resourceName}_missing`), true);
    const consumed = validInput({ resources: { ...validInput().resources, [name]: { ...validInput().resources[name], consumed: true } } });
    assert.equal(preparePublicWebThirdCanaryPrecheck(consumed).reason_codes.includes(`${resourceName}_already_consumed`), true);
    const old = validInput({ resources: { ...validInput().resources, [name]: { ...validInput().resources[name], id: 'public_web_trial_second_20260919', trial_id: TRIAL_ID } } });
    assert.equal(preparePublicWebThirdCanaryPrecheck(old).reason_codes.includes(`${resourceName}_belongs_to_previous_canary`), true);
  }
});

test('secret reference, durable audit, cleanup, retry, replay, and second attempt are required', () => {
  assert.equal(preparePublicWebThirdCanaryPrecheck(validInput({ secret_reference: undefined })).reason_codes.includes('secret_reference_invalid'), true);
  assert.equal(preparePublicWebThirdCanaryPrecheck(validInput({ audit_sink: undefined })).reason_codes.includes('durable_audit_sink_required'), true);
  assert.equal(preparePublicWebThirdCanaryPrecheck(validInput({ cleanup: { required: false, revocation_required: false, target_disable_required: false } })).reason_codes.includes('cleanup_and_revocation_required'), true);
  assert.equal(preparePublicWebThirdCanaryPrecheck(validInput({ execution_policy: { attempt_count: 1, retry_enabled: true, replay_attempt: true, second_attempt: true } })).ok, false);
});

test('telemetry semantics do not infer external network from provider or transport invocation', () => {
  assert.equal(validateThirdCanaryTelemetry({ provider_invoked: true, transport_invoked: false, external_network_called: false }).valid, true);
  assert.equal(validateThirdCanaryTelemetry({ provider_invoked: true, transport_invoked: true, external_network_called: false }).valid, true);
  assert.equal(validateThirdCanaryTelemetry({ provider_invoked: true, transport_invoked: true, external_network_called: true, external_network_evidence: false }).valid, false);
  assert.equal(validateThirdCanaryTelemetry({ provider_invoked: true, transport_invoked: true, external_network_called: true, external_network_evidence: true }).valid, true);
});

test('precheck forbids execution telemetry and unsafe evidence', () => {
  const executed = preparePublicWebThirdCanaryPrecheck(validInput({ telemetry: { provider_invoked: true, transport_invoked: true, external_network_called: false } }));
  assert.equal(executed.reason_codes.includes('precheck_must_not_execute'), true);
  const unsafe = preparePublicWebThirdCanaryPrecheck(validInput({ evidence: { sanitized: false, sensitive_output_redacted: false } }));
  assert.equal(unsafe.reason_codes.includes('sanitized_evidence_required'), true);
});
