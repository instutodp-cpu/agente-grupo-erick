'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  TRANSCRIPTION_ADAPTER_ID,
  TRANSCRIPTION_CONFIGURATION_ID,
  TRANSCRIPTION_CONNECTOR_ID,
  TRANSCRIPTION_PROVIDER_ID,
  TRANSCRIPTION_READINESS_CANDIDATE_ID,
  TRANSCRIPTION_SECRET_REFERENCE_ID
} = require('../src/core/transcription-contract');
const {
  TRANSCRIPTION_CANARY_ALLOWED_OPERATIONS,
  validateTranscriptionCanarySession
} = require('../src/core/transcription-canary-session-contract');
const { createTranscriptionCanarySessionRegistry } = require('../src/core/transcription-canary-session-registry');
const { evaluateTranscriptionCanaryPreflight } = require('../src/core/transcription-canary-preflight');
const {
  createTranscriptionCanaryAuthorizationRegistry,
  validateAuthorizationRecord
} = require('../src/core/transcription-canary-authorization');
const { runTranscriptionSyntheticCanary, validateRunnerInput } = require('../src/core/transcription-synthetic-canary-runner');
const { buildTranscriptionCanaryEvidenceBundle, validateEvidenceBundle } = require('../src/core/transcription-canary-evidence');
const { buildTranscriptionCanaryReport } = require('../src/core/transcription-canary-report');
const { cleanupTranscriptionCanarySession, rollbackTranscriptionCanarySession } = require('../src/core/transcription-canary-cleanup');
const { createTranscriptionSanitizedAdapter } = require('../src/adapters/transcription/transcription-sanitized-adapter');
const {
  lifecycleRecord,
  providerConfiguration,
  secretReference
} = require('../src/pilots/transcription-sanitized-adapter-pilot');

const repoRoot = path.resolve(__dirname, '../../..');
const docPath = path.join(repoRoot, 'docs', 'TRANSCRIPTION_CONTROLLED_CANARY_SESSION.md');
const fixturePath = path.join(__dirname, 'fixtures', 'hermes-transcription-controlled-canary-session.json');
const now = '2026-07-19T00:00:00.000Z';
const soon = '2026-07-19T00:05:00.000Z';
const future = '2026-07-19T00:15:00.000Z';
const later = '2026-07-19T00:20:00.000Z';
const past = '2026-07-18T00:00:00.000Z';

function session(overrides = {}) {
  return {
    session_id: 'session_transcription_canary_fixture_001',
    session_version: 1,
    candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
    readiness_evaluation_id: 'readiness_transcription_fixture_001',
    transcription_id: 'transcription_policy_fixture_001',
    consent_id: 'consent_transcription_fixture_001',
    approval_id: 'approval_transcription_fixture_001',
    retention_policy_id: 'retention_transcription_fixture_001',
    budget_policy_id: 'budget_transcription_fixture_001',
    provider_id: TRANSCRIPTION_PROVIDER_ID,
    adapter_id: TRANSCRIPTION_ADAPTER_ID,
    connector_id: TRANSCRIPTION_CONNECTOR_ID,
    configuration_id: TRANSCRIPTION_CONFIGURATION_ID,
    secret_reference_id: TRANSCRIPTION_SECRET_REFERENCE_ID,
    tenant_id: 'grupo_erick',
    workspace_type: 'corporate',
    environment: 'local_test',
    requested_by: 'operator_requester_fixture',
    approved_by: 'operator_approver_fixture',
    requested_at: now,
    starts_at: now,
    expires_at: future,
    session_status: 'created',
    operation: 'simulate_transcription_canary',
    rollout_percentage: 0,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true,
    ...overrides
  };
}

function consent(overrides = {}) {
  return {
    consent_id: 'consent_transcription_fixture_001',
    transcription_id: 'transcription_policy_fixture_001',
    tenant_id: 'grupo_erick',
    workspace_type: 'corporate',
    subject_type: 'synthetic_participant',
    purpose: 'training_summary',
    capture_source: 'synthetic_fixture',
    requested_at: now,
    granted_at: now,
    expires_at: future,
    consent_status: 'granted',
    consent_version: 1,
    granted_by: 'operator_consent_fixture',
    revocation_status: 'not_revoked',
    revoked_at: null,
    revocation_reason: null,
    allowed_operations: ['evaluate_transcription_candidate', 'simulate_transcription_readiness'],
    data_classification: 'synthetic_transcription_metadata',
    simulated: true,
    ...overrides
  };
}

function retention(overrides = {}) {
  return {
    retention_policy_id: 'retention_transcription_fixture_001',
    tenant_id: 'grupo_erick',
    workspace_type: 'corporate',
    data_classification: 'synthetic_transcription_metadata',
    retention_mode: 'sanitized_transcript_temporary',
    metadata_retention_days: 30,
    transcript_retention_days: 7,
    raw_media_retention_days: 0,
    deletion_required: true,
    legal_hold: false,
    policy_version: 1,
    effective_at: now,
    expires_at: future,
    simulated: true,
    ...overrides
  };
}

function budget(overrides = {}) {
  return {
    budget_policy_id: 'budget_transcription_fixture_001',
    tenant_id: 'grupo_erick',
    workspace_type: 'corporate',
    currency: 'BRL',
    monthly_budget_minor: 100000,
    daily_budget_minor: 10000,
    max_cost_per_request_minor: 1000,
    max_duration_ms: 120000,
    max_size_bytes: 1048576,
    daily_request_limit: 10,
    monthly_request_limit: 100,
    concurrent_request_limit: 1,
    rollout_percentage: 0,
    environment: 'local_test',
    simulated: true,
    ...overrides
  };
}

function operatorApproval(overrides = {}) {
  return {
    approval_id: 'approval_transcription_fixture_001',
    candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
    tenant_id: 'grupo_erick',
    environment: 'local_test',
    requested_by: 'operator_requester_fixture',
    approved_by: 'operator_approver_fixture',
    requested_at: now,
    approved_at: now,
    expires_at: future,
    approval_status: 'approved',
    allowed_operation: 'evaluate_transcription_candidate',
    single_use: true,
    consumed_at: null,
    simulated: true,
    ...overrides
  };
}

function readiness(overrides = {}) {
  return {
    readiness_evaluation_id: 'readiness_transcription_fixture_001',
    candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
    readiness_status: 'ready_for_controlled_canary_review',
    verdict: 'READY_FOR_CONTROLLED_CANARY_REVIEW',
    ready_for_next_review: true,
    ready_for_real_execution: false,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    rollout_percentage: 0,
    production_blocked: true,
    ...overrides
  };
}

function preflightContext(overrides = {}) {
  const adapter = createTranscriptionSanitizedAdapter();
  return {
    now,
    clock: () => now,
    readinessResult: readiness(),
    adapterMetadata: adapter.metadata,
    lifecycleRecord: lifecycleRecord({ lifecycle_state: 'readiness_passed', lifecycle_version: 4 }),
    providerConfiguration: providerConfiguration({ configuration_status: 'structurally_ready', configuration_version: 5 }),
    secretReference: secretReference({ status: 'structurally_ready', reference_version: 2 }),
    consentRecord: consent(),
    retentionPolicy: retention(),
    budgetPolicy: budget(),
    operatorApproval: operatorApproval(),
    featureFlagEnabled: false,
    killSwitchAvailable: true,
    killSwitchActive: false,
    networkBlocked: true,
    rawMediaPresent: false,
    storageConfigured: false,
    endpointConfigured: false,
    workerConfigured: false,
    schedulerConfigured: false,
    queueConfigured: false,
    uploadPresent: false,
    syntheticEvidence: {
      provider_called: false,
      real_provider_called: false,
      external_network_called: false,
      network_attempts: 0,
      raw_media_present: false,
      storage_configured: false,
      upload_present: false,
      can_trigger_real_execution: false
    },
    ...overrides
  };
}

function authorization(overrides = {}) {
  return {
    authorization_id: 'authorization_transcription_canary_fixture_001',
    session_id: 'session_transcription_canary_fixture_001',
    candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
    tenant_id: 'grupo_erick',
    requested_by: 'operator_requester_fixture',
    approved_by: 'operator_approver_fixture',
    issued_at: now,
    expires_at: soon,
    operation: 'simulate_transcription_canary',
    single_use: true,
    consumed_at: null,
    authorization_status: 'issued',
    simulated: true,
    ...overrides
  };
}

function runnerInput(overrides = {}) {
  return {
    session_id: 'session_transcription_canary_fixture_001',
    candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
    transcription_id: 'transcription_policy_fixture_001',
    authorization_id: 'authorization_transcription_canary_fixture_001',
    start_transition_id: 'transition_runner_start',
    complete_transition_id: 'transition_runner_complete',
    language: 'pt-BR',
    duration_ms: 1200,
    synthetic_segments_count: 2,
    synthetic_confidence: 0.93,
    synthetic_text_placeholder: 'Synthetic placeholder summary for controlled canary.',
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    ...overrides
  };
}

function assertSafe(result) {
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.can_trigger_real_execution, false);
}

function assertBlocks(errors, reason) {
  assert.ok(errors.includes(reason) || errors.some((error) => error.includes(reason)), `${reason} not found in ${errors.join(',')}`);
}

function createAuthorizedSession() {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  assert.equal(registry.createSession(session(), { now }).ok, true);
  assert.equal(registry.transitionSession({ session_id: session().session_id, expected_version: 1, transition_id: 'transition_preflight', next_status: 'preflight_passed' }, {}, { now }).applied, true);
  assert.equal(registry.transitionSession({ session_id: session().session_id, expected_version: 2, transition_id: 'transition_authorized', next_status: 'authorized' }, {}, { now }).applied, true);
  return registry;
}

test('transcription controlled canary docs and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('transcription controlled canary fixture is synthetic and complete', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.simulated, true);
  assert.equal(fixture.executed, false);
  assert.equal(fixture.real_provider_called, false);
  assert.equal(fixture.external_network_called, false);
  assert.equal(fixture.can_trigger_real_execution, false);
  assert.equal(fixture.rollout_percentage, 0);
  assert.equal(fixture.production_blocked, true);
  assert.equal(/https?:\/\//i.test(JSON.stringify(fixture)), false);
});

test('session contract accepts valid ephemeral session', () => {
  const validation = validateTranscriptionCanarySession(session(), { now });
  assert.equal(validation.valid, true);
  assert.ok(TRANSCRIPTION_CANARY_ALLOWED_OPERATIONS.includes('simulate_transcription_canary'));
});

test('session contract blocks missing fields', () => {
  const invalid = session();
  delete invalid.session_id;
  assertBlocks(validateTranscriptionCanarySession(invalid, { now }).errors, 'missing_session_id');
});

test('session contract blocks tenant candidate and transcription mismatch', () => {
  assertBlocks(validateTranscriptionCanarySession(session({ tenant_id: 'tenant_other' }), { tenant_id: 'grupo_erick', now }).errors, 'tenant_id_mismatch');
  assertBlocks(validateTranscriptionCanarySession(session({ candidate_id: 'candidate_other' }), { now }).errors, 'candidate_id_mismatch');
  assertBlocks(validateTranscriptionCanarySession(session({ transcription_id: 'other' }), { transcription_id: 'transcription_policy_fixture_001', now }).errors, 'transcription_id_mismatch');
});

test('session contract blocks invalid version expiration production rollout and operation', () => {
  assertBlocks(validateTranscriptionCanarySession(session({ session_version: 0 }), { now }).errors, 'session_version_invalid');
  assertBlocks(validateTranscriptionCanarySession(session({ expires_at: past }), { now }).errors, 'session_expired');
  assertBlocks(validateTranscriptionCanarySession(session({ environment: 'production' }), { now }).errors, 'production_blocked');
  assertBlocks(validateTranscriptionCanarySession(session({ rollout_percentage: 1 }), { now }).errors, 'rollout_percentage_must_be_zero');
  assertBlocks(validateTranscriptionCanarySession(session({ operation: 'transcribe_real_audio' }), { now }).errors, 'operation_not_allowed::transcribe_real_audio');
});

test('state machine executes happy path and preserves safety flags', () => {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  const created = registry.createSession(session(), { now });
  assert.equal(created.ok, true);
  let current = created.session;
  for (const [transition_id, next_status] of [['t1', 'preflight_passed'], ['t2', 'authorized'], ['t3', 'running_simulation'], ['t4', 'completed'], ['t5', 'cleaned_up']]) {
    const result = registry.transitionSession({ session_id: current.session_id, expected_version: current.session_version, transition_id, next_status }, {}, { now });
    assert.equal(result.applied, true, next_status);
    assertSafe(result);
    current = result.session;
  }
  assert.equal(current.session_status, 'cleaned_up');
});

test('state machine blocks invalid transition optimistic conflict and replay', () => {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  registry.createSession(session(), { now });
  assertBlocks(registry.transitionSession({ session_id: session().session_id, expected_version: 1, transition_id: 'bad', next_status: 'completed' }).blocking_reasons, 'session_transition_not_allowed');
  assertBlocks(registry.transitionSession({ session_id: session().session_id, expected_version: 9, transition_id: 'conflict', next_status: 'preflight_passed' }).blocking_reasons, 'session_version_conflict');
  assert.equal(registry.transitionSession({ session_id: session().session_id, expected_version: 1, transition_id: 'once', next_status: 'preflight_passed' }).applied, true);
  assertBlocks(registry.transitionSession({ session_id: session().session_id, expected_version: 2, transition_id: 'once', next_status: 'authorized' }).blocking_reasons, 'transition_replay_detected');
});

test('state machine blocks terminal restart and protects history', () => {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  registry.createSession(session(), { now });
  registry.transitionSession({ session_id: session().session_id, expected_version: 1, transition_id: 'cancel', next_status: 'cancelled' }, {}, { now });
  assertBlocks(registry.transitionSession({ session_id: session().session_id, expected_version: 2, transition_id: 'restart', next_status: 'preflight_passed' }).blocking_reasons, 'terminal_session_cannot_restart');
  const history = registry.getHistory(session().session_id);
  history[0].tenant_id = 'mutated';
  assert.equal(registry.getHistory(session().session_id)[0].tenant_id, 'grupo_erick');
});

test('state machine blocks immutable identity changes', () => {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  registry.createSession(session(), { now });
  const result = registry.transitionSession({ session_id: session().session_id, expected_version: 1, transition_id: 'immutable', next_status: 'preflight_passed' }, { tenant_id: 'other' }, { now });
  assertBlocks(result.blocking_reasons, 'tenant_id_immutable');
});

test('preflight passes with all synthetic requirements satisfied', () => {
  const result = evaluateTranscriptionCanaryPreflight(session(), preflightContext());
  assert.equal(result.allowed, true);
  assert.equal(result.allowed_for_real_provider, false);
  assert.equal(result.allowed_for_real_audio, false);
  assert.equal(result.rollout_percentage, 0);
  assertSafe(result);
});

test('preflight blocks each mandatory policy when missing', () => {
  for (const [field, reason] of [
    ['consentRecord', 'consent_missing'],
    ['retentionPolicy', 'retention_policy_missing'],
    ['budgetPolicy', 'budget_policy_missing'],
    ['operatorApproval', 'operator_approval_missing']
  ]) {
    assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ [field]: null })).blocking_requirements, reason);
  }
});

test('preflight blocks expired consent approval and invalid readiness', () => {
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ consentRecord: consent({ expires_at: past }) })).blocking_requirements, 'consent_expired');
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ operatorApproval: operatorApproval({ expires_at: past }) })).blocking_requirements, 'operator_approval_expired');
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ readinessResult: readiness({ verdict: 'BLOCKED', ready_for_next_review: false }) })).blocking_requirements, 'readiness_not_ready_for_controlled_canary_review');
});

test('preflight blocks provider runtime feature flag kill switch network raw media and secret', () => {
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ lifecycleRecord: lifecycleRecord({ lifecycle_state: 'readiness_passed', real_provider_enabled: true }) })).blocking_requirements, 'provider_or_runtime_enabled');
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ lifecycleRecord: lifecycleRecord({ lifecycle_state: 'readiness_passed', runtime_enabled: true }) })).blocking_requirements, 'provider_or_runtime_enabled');
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ featureFlagEnabled: true })).blocking_requirements, 'feature_flag_enabled_or_missing');
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ killSwitchAvailable: false })).blocking_requirements, 'kill_switch_unavailable_or_active');
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ networkBlocked: false })).blocking_requirements, 'network_not_blocked');
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ rawMediaPresent: true })).blocking_requirements, 'raw_media_present');
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ secretReference: { ...secretReference(), secret_value: 'never' } })).blocking_requirements, 'secret_value_present');
});

test('preflight blocks endpoint worker scheduler queue storage upload and production', () => {
  for (const [field, reason] of [
    ['endpointConfigured', 'endpoint_configured'],
    ['workerConfigured', 'worker_configured'],
    ['schedulerConfigured', 'scheduler_configured'],
    ['queueConfigured', 'queue_configured'],
    ['storageConfigured', 'storage_configured'],
    ['uploadPresent', 'upload_present']
  ]) {
    assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ [field]: true })).blocking_requirements, reason);
  }
  assertBlocks(evaluateTranscriptionCanaryPreflight(session({ environment: 'production' }), preflightContext()).blocking_requirements, 'production_blocked');
});

test('authorization record accepts valid explicit one-use authorization', () => {
  const validation = validateAuthorizationRecord(authorization(), { now });
  assert.equal(validation.valid, true);
});

test('authorization blocks self approval expiration tenant session candidate operation and consumed_at', () => {
  assertBlocks(validateAuthorizationRecord(authorization({ approved_by: 'operator_requester_fixture' }), { now }).errors, 'authorization_self_approval_blocked');
  assertBlocks(validateAuthorizationRecord(authorization({ expires_at: past }), { now }).errors, 'authorization_expired');
  assertBlocks(validateAuthorizationRecord(authorization({ tenant_id: 'tenant_other' }), { tenant_id: 'grupo_erick', now }).errors, 'authorization_tenant_mismatch');
  assertBlocks(validateAuthorizationRecord(authorization({ session_id: 'other' }), { session_id: session().session_id, now }).errors, 'authorization_session_mismatch');
  assertBlocks(validateAuthorizationRecord(authorization({ candidate_id: 'other' }), { candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, now }).errors, 'authorization_candidate_mismatch');
  assertBlocks(validateAuthorizationRecord(authorization({ operation: 'execute_external_provider' }), { now }).errors, 'authorization_operation_not_allowed::execute_external_provider');
  assertBlocks(validateAuthorizationRecord(authorization({ consumed_at: now }), { now }).errors, 'authorization_already_consumed');
});

test('authorization registry consumes once and failed consume does not mutate', () => {
  const registry = createTranscriptionCanaryAuthorizationRegistry({ clock: () => now });
  assert.equal(registry.issueAuthorization(authorization(), { now }).ok, true);
  const failed = registry.consumeAuthorization({ authorization_id: authorization().authorization_id, session_id: 'other', candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', consumed_at: now }, { now });
  assertBlocks(failed.blocking_reasons, 'authorization_session_mismatch');
  assert.equal(registry.getAuthorization(authorization().authorization_id).consumed_at, null);
  assert.equal(registry.consumeAuthorization({ authorization_id: authorization().authorization_id, session_id: session().session_id, candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', consumed_at: now }, { now }).consumed, true);
  assertBlocks(registry.consumeAuthorization({ authorization_id: authorization().authorization_id, session_id: session().session_id, candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', consumed_at: now }, { now }).blocking_reasons, 'authorization_reuse_blocked');
});

test('authorization consumption blocks invalid timestamps and expiration', () => {
  const registry = createTranscriptionCanaryAuthorizationRegistry({ clock: () => now });
  registry.issueAuthorization(authorization({ authorization_id: 'auth_time' }), { now });
  assertBlocks(registry.consumeAuthorization({ authorization_id: 'auth_time', session_id: session().session_id, candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', consumed_at: 'bad' }, { now }).blocking_reasons, 'consumed_at_invalid');
  assertBlocks(registry.consumeAuthorization({ authorization_id: 'auth_time', session_id: session().session_id, candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', consumed_at: '2026-07-18T23:59:59.000Z' }, { now }).blocking_reasons, 'consumed_at_before_issued_at');
  assertBlocks(registry.consumeAuthorization({ authorization_id: 'auth_time', session_id: session().session_id, candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', consumed_at: later }, { now }).blocking_reasons, 'consumption_after_expiration');
  assertBlocks(registry.consumeAuthorization({ authorization_id: 'auth_time', session_id: session().session_id, candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', consumed_at: later }, { now: later }).blocking_reasons, 'consumption_after_expiration');
  assert.equal(registry.getAuthorization('auth_time').consumed_at, null);
});

test('runner validates synthetic input and blocks forbidden payloads', () => {
  assert.equal(validateRunnerInput(runnerInput()).length, 0);
  for (const field of ['raw_audio', 'buffer', 'base64', 'url', 'endpoint', 'provider_response', 'token', 'file', 'path', 'stream', 'upload']) {
    assertBlocks(validateRunnerInput(runnerInput({ [field]: field === 'buffer' ? Buffer.from('x') : 'synthetic' })), `forbidden_field::${field}`);
  }
});

test('runner completes a valid synthetic canary without provider or network', async () => {
  const sessionRegistry = createAuthorizedSession();
  const authorizationRegistry = createTranscriptionCanaryAuthorizationRegistry({ clock: () => now });
  authorizationRegistry.issueAuthorization(authorization(), { now });
  const result = await runTranscriptionSyntheticCanary(runnerInput(), {
    sessionRegistry,
    authorizationRegistry,
    preflightResult: evaluateTranscriptionCanaryPreflight(session(), preflightContext())
  }, { now, clock: () => now });
  assert.equal(result.status, 'transcription_canary_simulation_completed');
  assert.equal(result.synthetic_segments_count, 2);
  assert.equal(sessionRegistry.getSession(session().session_id).session_status, 'completed');
  assert.equal(authorizationRegistry.getAuthorization(authorization().authorization_id).authorization_status, 'consumed');
  assertSafe(result);
});

test('runner blocks missing session preflight and authorization', async () => {
  assertBlocks((await runTranscriptionSyntheticCanary(runnerInput(), {}, { now })).blocking_reasons, 'session_registry_missing');
  const sessionRegistry = createAuthorizedSession();
  assertBlocks((await runTranscriptionSyntheticCanary(runnerInput(), { sessionRegistry, authorizationRegistry: createTranscriptionCanaryAuthorizationRegistry(), preflightResult: null }, { now })).blocking_reasons, 'preflight_required');
  assertBlocks((await runTranscriptionSyntheticCanary(runnerInput({ authorization_id: 'missing' }), { sessionRegistry, authorizationRegistry: createTranscriptionCanaryAuthorizationRegistry(), preflightResult: evaluateTranscriptionCanaryPreflight(session(), preflightContext()) }, { now })).blocking_reasons, 'authorization_not_found');
});

test('runner blocks unauthorized or mismatched session', async () => {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  registry.createSession(session(), { now });
  const auth = createTranscriptionCanaryAuthorizationRegistry({ clock: () => now });
  auth.issueAuthorization(authorization(), { now });
  assertBlocks((await runTranscriptionSyntheticCanary(runnerInput(), { sessionRegistry: registry, authorizationRegistry: auth, preflightResult: evaluateTranscriptionCanaryPreflight(session(), preflightContext()) }, { now })).blocking_reasons, 'session_not_authorized');
});

test('evidence bundle is sanitized immutable and serializable', () => {
  const built = buildTranscriptionCanaryEvidenceBundle({ session: session(), authorization_id: authorization().authorization_id, synthetic_result_metadata: { language: 'pt-BR', synthetic_segments_count: 2 }, state_transitions: [], blocking_reasons: [] }, { now });
  assert.equal(built.ok, true);
  assert.equal(Object.isFrozen(built.evidence_bundle), true);
  assert.equal(validateEvidenceBundle(built.evidence_bundle).valid, true);
  assert.doesNotThrow(() => JSON.stringify(built.evidence_bundle));
});

test('evidence bundle rejects forbidden fields', () => {
  const built = buildTranscriptionCanaryEvidenceBundle({ session: session(), authorization_id: authorization().authorization_id, synthetic_result_metadata: { token: 'never' } }, { now });
  assert.equal(built.ok, false);
  assertBlocks(built.validation.errors, 'forbidden_field::token');
});

test('report returns READY_FOR_NEXT_SYNTHETIC_REVIEW only after completed cleanup', () => {
  const built = buildTranscriptionCanaryEvidenceBundle({ session: session({ session_status: 'completed', session_version: 5 }), authorization_id: authorization().authorization_id, synthetic_result_metadata: { synthetic_segments_count: 2 }, state_transitions: [] }, { now });
  const report = buildTranscriptionCanaryReport({
    session: session({ session_status: 'completed' }),
    preflight: { allowed: true },
    authorization: { consumed: true },
    evidence_bundle: built.evidence_bundle,
    cleanup: { cleanup_status: 'cleanup_completed' }
  }, { now });
  assert.equal(report.decision, 'READY_FOR_NEXT_SYNTHETIC_REVIEW');
  assert.equal(report.ready_for_real_execution, false);
});

test('report returns NO_GO CLEANUP_REQUIRED and ROLLBACK_REQUIRED safely', () => {
  assert.equal(buildTranscriptionCanaryReport({ session: session(), preflight: { allowed: false }, authorization: { consumed: false }, evidence_bundle: { executed: false, real_provider_called: false, external_network_called: false } }, { now }).decision, 'CLEANUP_REQUIRED');
  assert.equal(buildTranscriptionCanaryReport({ session: session({ session_status: 'completed' }), preflight: { allowed: true }, authorization: { consumed: true }, evidence_bundle: { executed: true, real_provider_called: true, external_network_called: false, safety_flags: { production_blocked: true, rollout_percentage: 0 } }, cleanup: { cleanup_status: 'cleanup_completed' } }, { now }).decision, 'NO_GO');
  assert.equal(buildTranscriptionCanaryReport({ session: session({ session_status: 'rolled_back' }), rollback_required: true }, { now }).decision, 'ROLLBACK_REQUIRED');
});

test('cleanup is idempotent and preserves terminal session history', () => {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  registry.createSession(session(), { now });
  registry.transitionSession({ session_id: session().session_id, expected_version: 1, transition_id: 'block', next_status: 'blocked' }, {}, { now });
  const first = cleanupTranscriptionCanarySession({ session_id: session().session_id, authorization_id: authorization().authorization_id, transition_id: 'cleanup_once' }, { sessionRegistry: registry, authorizationRegistry: createTranscriptionCanaryAuthorizationRegistry() }, { now });
  assert.equal(first.cleanup_status, 'cleanup_completed');
  const second = cleanupTranscriptionCanarySession({ session_id: session().session_id, transition_id: 'cleanup_twice' }, { sessionRegistry: registry }, { now });
  assert.equal(second.cleanup_status, 'cleanup_completed');
  assert.ok(registry.getHistory(session().session_id).length >= 2);
});

test('rollback is idempotent and replay protected', () => {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  registry.createSession(session(), { now });
  registry.transitionSession({ session_id: session().session_id, expected_version: 1, transition_id: 'preflight', next_status: 'preflight_passed' }, {}, { now });
  registry.transitionSession({ session_id: session().session_id, expected_version: 2, transition_id: 'auth', next_status: 'authorized' }, {}, { now });
  registry.transitionSession({ session_id: session().session_id, expected_version: 3, transition_id: 'running', next_status: 'running_simulation' }, {}, { now });
  const first = rollbackTranscriptionCanarySession({ session_id: session().session_id, transition_id: 'rollback_once' }, { sessionRegistry: registry }, { now });
  assert.equal(first.rollback_status, 'rollback_completed');
  assert.equal(rollbackTranscriptionCanarySession({ session_id: session().session_id, transition_id: 'rollback_twice' }, { sessionRegistry: registry }, { now }).rollback_status, 'rollback_completed');
  const replay = registry.transitionSession({ session_id: session().session_id, expected_version: 5, transition_id: 'rollback_once', next_status: 'cleaned_up' }, {}, { now });
  assertBlocks(replay.blocking_reasons, 'transition_replay_detected');
});

test('cleanup after expiration and rollback after timeout remain synthetic', () => {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  registry.createSession(session(), { now });
  registry.transitionSession({ session_id: session().session_id, expected_version: 1, transition_id: 'expire', next_status: 'preflight_passed' }, {}, { now });
  registry.transitionSession({ session_id: session().session_id, expected_version: 2, transition_id: 'expired', next_status: 'expired' }, {}, { now });
  assert.equal(cleanupTranscriptionCanarySession({ session_id: session().session_id, transition_id: 'cleanup_expired' }, { sessionRegistry: registry }, { now }).cleanup_status, 'cleanup_completed');
});

test('session expiration after preflight blocks simulation start', () => {
  const registry = createTranscriptionCanarySessionRegistry({ clock: () => now });
  registry.createSession(session(), { now });
  registry.transitionSession({ session_id: session().session_id, expected_version: 1, transition_id: 'pf', next_status: 'preflight_passed' }, {}, { now });
  registry.transitionSession({ session_id: session().session_id, expected_version: 2, transition_id: 'au', next_status: 'authorized' }, {}, { now });
  const result = registry.transitionSession({ session_id: session().session_id, expected_version: 3, transition_id: 'run_late', next_status: 'running_simulation' }, {}, { now: later, clock: () => later });
  assertBlocks(result.blocking_reasons, 'session_expired');
});

test('session contract blocks sessions longer than fifteen minutes', () => {
  assertBlocks(validateTranscriptionCanarySession(session({ expires_at: later }), { now }).errors, 'session_duration_exceeds_limit');
});

test('preflight blocks budget rollout and raw media retention drift', () => {
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ budgetPolicy: budget({ rollout_percentage: 1 }) })).blocking_requirements, 'rollout_percentage_must_be_zero');
  assertBlocks(evaluateTranscriptionCanaryPreflight(session(), preflightContext({ retentionPolicy: retention({ raw_media_retention_days: 1 }) })).blocking_requirements, 'raw_media_retention_must_be_zero');
});

test('preflight blocks readiness that claims real execution capability', () => {
  const result = evaluateTranscriptionCanaryPreflight(session(), preflightContext({ readinessResult: readiness({ ready_for_real_execution: true }) }));
  assertBlocks(result.blocking_requirements, 'readiness_real_execution_not_allowed');
});

test('authorization issue blocks long windows and duplicate issue replay', () => {
  assertBlocks(validateAuthorizationRecord(authorization({ expires_at: future }), { now }).errors, 'authorization_window_exceeds_limit');
  const registry = createTranscriptionCanaryAuthorizationRegistry({ clock: () => now });
  assert.equal(registry.issueAuthorization(authorization(), { now }).ok, true);
  assertBlocks(registry.issueAuthorization(authorization(), { now }).blocking_reasons, 'authorization_replay_duplicate');
});

test('runner blocks session binding mismatch before simulation', async () => {
  const sessionRegistry = createAuthorizedSession();
  const authorizationRegistry = createTranscriptionCanaryAuthorizationRegistry({ clock: () => now });
  authorizationRegistry.issueAuthorization(authorization(), { now });
  const result = await runTranscriptionSyntheticCanary(runnerInput({ candidate_id: 'candidate_other' }), {
    sessionRegistry,
    authorizationRegistry,
    preflightResult: evaluateTranscriptionCanaryPreflight(session(), preflightContext())
  }, { now });
  assertBlocks(result.blocking_reasons, 'session_binding_mismatch');
});

test('report never emits real execution or production decisions', () => {
  const forbidden = ['GO_PRODUCTION', 'READY_FOR_REAL_PROVIDER', 'READY_FOR_REAL_EXECUTION', 'PRODUCTION_READY'];
  const decisions = [
    buildTranscriptionCanaryReport({ session: session(), cleanup: { cleanup_status: 'cleanup_completed' } }, { now }).decision,
    buildTranscriptionCanaryReport({ session: session({ session_status: 'rolled_back' }), rollback_required: true }, { now }).decision
  ];
  for (const decision of decisions) assert.equal(forbidden.includes(decision), false);
});

test('cleanup blocks missing registry and missing session without external effects', () => {
  assert.equal(cleanupTranscriptionCanarySession({ session_id: session().session_id }, {}, { now }).cleanup_status, 'cleanup_blocked');
  assert.equal(cleanupTranscriptionCanarySession({ session_id: session().session_id }, { sessionRegistry: createTranscriptionCanarySessionRegistry() }, { now }).cleanup_status, 'cleanup_blocked');
});

test('runner evidence preserves false safety flags after simulation', async () => {
  const sessionRegistry = createAuthorizedSession();
  const authorizationRegistry = createTranscriptionCanaryAuthorizationRegistry({ clock: () => now });
  authorizationRegistry.issueAuthorization(authorization(), { now });
  const result = await runTranscriptionSyntheticCanary(runnerInput(), {
    sessionRegistry,
    authorizationRegistry,
    preflightResult: evaluateTranscriptionCanaryPreflight(session(), preflightContext())
  }, { now });
  assertSafe(result.evidence_bundle);
  assert.equal(result.evidence_bundle.safety_flags.rollout_percentage, 0);
});

test('regression keeps canary modules out of runtime message confirm endpoint scheduler worker surfaces', () => {
  const runtimeFiles = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js'),
    path.join(repoRoot, 'services', 'worker', 'src', 'index.js')
  ];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-canary'), false);
    assert.equal(source.includes('transcription-synthetic-canary-runner'), false);
  }
});

test('regression canary modules do not call network env filesystem timers or provider APIs', () => {
  const files = [
    'transcription-canary-session-contract.js',
    'transcription-canary-session-registry.js',
    'transcription-canary-preflight.js',
    'transcription-canary-authorization.js',
    'transcription-synthetic-canary-runner.js',
    'transcription-canary-evidence.js',
    'transcription-canary-report.js',
    'transcription-canary-cleanup.js'
  ].map((file) => path.join(repoRoot, 'services', 'api', 'src', 'core', file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes("require('node:http')"), false);
    assert.equal(source.includes("require('node:https')"), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('setInterval('), false);
    assert.equal(source.includes('setTimeout('), false);
    assert.equal(source.includes('.summarize('), false);
  }
});
