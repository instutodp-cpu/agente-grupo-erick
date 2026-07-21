'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-transcription-secret-resolution-boundary.json');
const capabilityFixture = require('./fixtures/hermes-transcription-provider-capability-matrix.json');
const {
  TRANSCRIPTION_SECRET_RESOLUTION_BOUNDARY_VALIDATOR_VERSION,
  createTranscriptionSecretReferenceRegistry,
  findSecretMaterial,
  resolveTranscriptionSecretReference,
  validateSecretReference,
  validateSecretResolutionRequest
} = require('../src/core/transcription-secret-resolution-boundary');
const {
  TRANSCRIPTION_SECRET_ACCESS_POLICY_VERSION,
  evaluateSecretAccessPolicy,
  validateAccessContext
} = require('../src/core/transcription-secret-access-policy');
const { validateSecretResolutionAudit } = require('../src/core/transcription-secret-resolution-audit');
const { validateSecretResolutionResult } = require('../src/core/transcription-secret-resolution-result');
const {
  TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION,
  runMockTranscriptionOrchestrator
} = require('../src/core/transcription-orchestrator');
const { validateTranscriptionExecutionContext } = require('../src/core/transcription-execution-context');
const { createTranscriptionProviderAdapterMock } = require('../src/adapters/transcription/transcription-provider-adapter-mock');
const { TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION, TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION } = require('../src/core/transcription-transport-contract');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reference(overrides = {}) {
  return { ...clone(fixture.references[0]), ...overrides };
}

function accessContext(overrides = {}) {
  return {
    actor_type: 'USER',
    actor_id: 'actor_secret_reviewer',
    actor_role: 'ADMIN',
    tenant_id: 'tenant_secret',
    requested_by: 'actor_secret_reviewer',
    approval_state: 'APPROVED_SIMULATION',
    mfa_verified: true,
    service_identity_verified: false,
    policy_version: TRANSCRIPTION_SECRET_ACCESS_POLICY_VERSION,
    ...overrides
  };
}

function simulationContext(overrides = {}) {
  return {
    simulation: true,
    production_blocked: true,
    network_used: false,
    provider_called: false,
    executed: false,
    secret_resolved: false,
    runtime_enabled: false,
    rollout_percentage: 0,
    ...overrides
  };
}

function resolutionRequest(overrides = {}) {
  const base = {
    resolution_request_id: 'resolution_request_1',
    resolution_request_version: 1,
    tenant_id: 'tenant_secret',
    conversation_id: 'conversation_secret',
    provider_slug: 'mock-provider-a',
    adapter_id: 'adapter_secret_boundary',
    secret_reference: reference(),
    requested_scope: 'TRANSCRIPTION_PROVIDER',
    requested_purpose: 'validate_provider_secret_reference',
    access_context: accessContext(),
    simulation_context: simulationContext(),
    metadata: {
      reason: 'synthetic_secret_reference_review',
      evaluated_at: '2026-07-21T00:00:00.000Z'
    },
    validator_version: TRANSCRIPTION_SECRET_RESOLUTION_BOUNDARY_VALIDATOR_VERSION
  };
  return { ...base, ...overrides };
}

function assertSafe(value) {
  assert.equal(value.secret_material_present, false);
  assert.equal(value.secret_material_returned, false);
  assert.equal(value.secret_loaded, false);
  assert.equal(value.secret_decrypted, false);
  assert.equal(value.secret_resolved, false);
  assert.equal(value.network_used, false);
  assert.equal(value.provider_called, false);
  assert.equal(value.executed, false);
  assert.equal(value.simulation, true);
  assert.equal(value.production_blocked, true);
  assert.equal(value.runtime_enabled, false);
  assert.equal(value.rollout_percentage, 0);
}

test('secret resolution docs and fixture exist without secret material', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'TRANSCRIPTION_SECRET_RESOLUTION_BOUNDARY.md')), true);
  assert.equal(fixture.simulation, true);
  assert.equal(findSecretMaterial(fixture).length, 0);
});

test('secret reference and resolution request valid', () => {
  assert.equal(validateSecretReference(reference()).valid, true);
  assert.equal(validateSecretResolutionRequest(resolutionRequest()).valid, true);
});

test('resolution request blocks missing fields extras and invalid versions', () => {
  const missing = resolutionRequest();
  delete missing.tenant_id;
  assert.ok(validateSecretResolutionRequest(missing).errors.includes('resolution_request_missing_tenant_id'));
  assert.ok(validateSecretResolutionRequest(resolutionRequest({ extra: true })).errors.includes('resolution_request_unexpected_field::extra'));
  assert.ok(validateSecretResolutionRequest(resolutionRequest({ resolution_request_version: 0 })).errors.includes('resolution_request_version_invalid'));
});

[
  ['campo secreto proibido', { secret_value: 'hidden' }, 'forbidden_sensitive_field'],
  ['token em valor', { metadata: { marker: 'sk_abcdefghijklmnopqrstuvwxyz1234567890' } }, 'suspicious_api_key_value'],
  ['JWT', { metadata: { marker: 'aaa.bbb.ccc' } }, 'suspicious_jwt_value'],
  ['Bearer', { metadata: { marker: 'Bearer abcdefghijklmnopqrstuvwxyz' } }, 'suspicious_bearer_value'],
  ['PEM', { metadata: { marker: '-----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----' } }, 'suspicious_pem_private_key_value'],
  ['API key longa', { metadata: { marker: 'api_abcdefghijklmnopqrstuvwxyz1234567890' } }, 'suspicious_api_key_value'],
  ['Basic auth', { metadata: { marker: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l' } }, 'suspicious_basic_auth_value']
].forEach(([name, overrides, reason]) => {
  test(`secret material detector blocks ${name}`, () => {
    const errors = validateSecretResolutionRequest(resolutionRequest(overrides)).errors;
    assert.ok(errors.some((error) => error.includes(reason)), errors.join(','));
  });
});

test('secret reference blocks provider tenant scope and enum mismatches', () => {
  assert.ok(resolveTranscriptionSecretReference(resolutionRequest({ provider_slug: 'mock-provider-b' })).errors.includes('provider_mismatch'));
  assert.equal(resolveTranscriptionSecretReference(resolutionRequest({ tenant_id: 'tenant_other' })).result.status, 'TENANT_MISMATCH');
  assert.equal(resolveTranscriptionSecretReference(resolutionRequest({ requested_scope: 'TRANSPORT' })).result.status, 'SCOPE_MISMATCH');
  assert.ok(validateSecretReference(reference({ environment: 'LOCAL' })).errors.includes('environment_not_allowed::LOCAL'));
  assert.ok(validateSecretReference(reference({ secret_type: 'RAW_SECRET' })).errors.includes('secret_type_not_allowed::RAW_SECRET'));
});

test('secret reference blocks revoked active and unsafe flags', () => {
  assert.equal(resolveTranscriptionSecretReference(resolutionRequest({ secret_reference: reference({ revoked: true }) })).result.status, 'REVOKED_REFERENCE');
  assert.equal(resolveTranscriptionSecretReference(resolutionRequest({ secret_reference: reference({ active: true }) })).result.status, 'INACTIVE_REFERENCE');
  assert.ok(validateSecretReference(reference({ simulation: false })).errors.includes('simulation_must_be_true'));
  assert.ok(validateSecretReference(reference({ production_blocked: false })).errors.includes('production_blocked_must_be_true'));
  assert.ok(validateSecretReference(reference({ network_enabled: true })).errors.includes('network_enabled_must_be_false'));
  assert.ok(validateSecretReference(reference({ runtime_enabled: true })).errors.includes('runtime_enabled_must_be_false'));
});

test('access policy denies by default and approves only simulation', () => {
  assert.equal(evaluateSecretAccessPolicy(resolutionRequest({ access_context: accessContext({ approval_state: 'DENIED' }) }), reference()).status, 'ACCESS_DENIED');
  assert.equal(evaluateSecretAccessPolicy(resolutionRequest({ access_context: accessContext({ approval_state: 'PENDING' }) }), reference()).status, 'ACCESS_DENIED');
  assert.equal(evaluateSecretAccessPolicy(resolutionRequest(), reference()).status, 'ACCESS_SIMULATION_APPROVED');
  assert.ok(validateAccessContext(accessContext({ actor_role: 'OPERATOR' })).errors.includes('actor_role_not_allowed::OPERATOR'));
  assert.ok(validateAccessContext(accessContext({ approval_state: 'APPROVED_REAL' })).errors.includes('approval_state_not_allowed::APPROVED_REAL'));
});

test('resolved result and audit are sanitized immutable and never contain material', () => {
  const resolved = resolveTranscriptionSecretReference(resolutionRequest());
  assert.equal(resolved.result.status, 'REFERENCE_VALID_SIMULATION');
  assert.equal(validateSecretResolutionResult(resolved.result).valid, true);
  assert.equal(validateSecretResolutionAudit(resolved.audit).valid, true);
  assertSafe(resolved.result);
  assert.equal(Object.isFrozen(resolved.result), true);
  assert.equal(Object.isFrozen(resolved.audit), true);
  assert.throws(() => {
    resolved.audit.blockers.push('mutate');
  }, TypeError);
});

test('resolution fail closed for NaN Infinity bigint symbol function cycle and arrays duplicate-like payloads', () => {
  assert.ok(validateSecretResolutionRequest(resolutionRequest({ metadata: { value: Number.NaN } })).errors.some((error) => error.includes('non_finite_number')));
  assert.ok(validateSecretResolutionRequest(resolutionRequest({ metadata: { value: Number.POSITIVE_INFINITY } })).errors.some((error) => error.includes('non_finite_number')));
  assert.ok(validateSecretResolutionRequest(resolutionRequest({ metadata: { counter: BigInt(1) } })).errors.some((error) => error.includes('forbidden_bigint')));
  assert.ok(validateSecretResolutionRequest(resolutionRequest({ metadata: { marker_symbol: Symbol('x') } })).errors.some((error) => error.includes('forbidden_symbol')));
  assert.ok(validateSecretResolutionRequest(resolutionRequest({ metadata: { callback: () => null } })).errors.some((error) => error.includes('forbidden_function')));
  const cyclic = resolutionRequest();
  cyclic.metadata.self = cyclic.metadata;
  assert.ok(validateSecretResolutionRequest(cyclic).errors.some((error) => error.includes('cyclic_reference') || error.includes('forbidden_cycle')));
});

test('registry stores only synthetic references with replay version and defensive clone', () => {
  const registry = createTranscriptionSecretReferenceRegistry();
  const ref = reference();
  const first = registry.registerSecretReference(ref, { expected_version: 0 });
  assert.equal(first.ok, true);
  assertSafe(first);
  assert.equal(registry.registerSecretReference(ref).errors[0], 'secret_reference_replay_duplicate');
  const changed = reference({ secret_alias: 'changed_alias' });
  assert.equal(registry.registerSecretReference(changed).errors[0], 'secret_reference_replay_payload_mismatch');
  assert.equal(registry.registerSecretReference(reference({ secret_ref_id: 'another', secret_ref_version: 1 })).errors[0], 'secret_reference_version_downgrade');
  assert.equal(registry.registerSecretReference(reference({ secret_ref_id: 'third', secret_ref_version: 2 }), { expected_version: 9 }).errors[0], 'secret_reference_optimistic_conflict');
  const stored = registry.getSecretReference(ref.secret_ref_id);
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => {
    stored.secret_alias = 'mutated';
  }, TypeError);
  assert.equal(registry.getSecretReference(ref.secret_ref_id).secret_alias, ref.secret_alias);
});

test('registry fingerprint failure does not store record or history', () => {
  const registry = createTranscriptionSecretReferenceRegistry();
  const bad = reference();
  bad.metadata = bad;
  const result = registry.registerSecretReference(bad);
  assert.equal(result.ok, false);
  assert.equal(registry.getSecretReference(bad.secret_ref_id), null);
  assert.deepEqual(registry.getHistory('tenant_secret:mock-provider-a:TRANSCRIPTION_PROVIDER'), []);
});

function orchestratorRequest() {
  return {
    request_id: 'orchestrator_secret_request',
    request_version: 1,
    tenant_id: 'tenant_secret',
    conversation_id: 'conversation_secret',
    provider_slug: 'AUTO',
    requested_language: 'pt-BR',
    requested_format: 'synthetic_metadata_only',
    requested_features: ['summary'],
    consent_context: {
      consent: {
        consent_id: 'consent_secret_1',
        transcription_id: 'transcription_secret_1',
        tenant_id: 'tenant_secret',
        workspace_type: 'internal',
        subject_type: 'synthetic_subject',
        purpose: 'development_test',
        capture_source: 'synthetic_fixture',
        requested_at: '2026-07-21T00:00:00.000Z',
        granted_at: '2026-07-21T00:01:00.000Z',
        expires_at: '2026-07-22T00:00:00.000Z',
        consent_status: 'granted',
        consent_version: 1,
        granted_by: 'operator_a',
        revocation_status: 'not_revoked',
        revoked_at: null,
        revocation_reason: null,
        allowed_operations: ['summarize_transcription'],
        data_classification: 'synthetic',
        simulated: true
      }
    },
    simulation_context: { simulation: true, production_blocked: true, rollout_percentage: 0, network_used: false, provider_called: false, executed: false },
    transport_context: { transport_contract_id: 'transport_contract_deepgram_mock_1' },
    adapter_context: { adapter_id: 'transcription_provider_adapter_mock_deepgram_v1' },
    metadata: { transcription_id: 'transcription_secret_1', evaluated_at: '2026-07-21T00:02:00.000Z', simulation: true, production_blocked: true, rollout_percentage: 0, network_used: false, provider_called: false, executed: false },
    validator_version: TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION
  };
}

function selectionRequest() {
  return {
    selection_request_id: 'selection_secret_request',
    selection_request_version: 1,
    tenant_id: 'tenant_secret',
    conversation_id: 'conversation_secret',
    requested_language: 'pt-BR',
    requested_audio_format: 'synthetic_metadata_only',
    requested_sample_rate: 16000,
    requested_channels: 1,
    requested_duration_seconds: 120,
    requested_size_mb: 5,
    requested_features: {
      streaming: false,
      partial_results: false,
      word_timestamps: false,
      sentence_timestamps: false,
      speaker_diarization: false,
      language_detection: false,
      translation: false,
      punctuation: true,
      profanity_filter: false,
      custom_vocabulary: false,
      numeric_normalization: false,
      confidence_score: false
    },
    priority_profile: 'BALANCED',
    cost_preference: 'MEDIUM',
    latency_preference: 'MEDIUM',
    quality_preference: 'MEDIUM',
    allowed_provider_slugs: [],
    denied_provider_slugs: [],
    simulation_context: { simulation: true, network_used: false, provider_called: false, executed: false, production_blocked: true, rollout_percentage: 0 },
    metadata: { requester: 'synthetic_test', evaluated_at: '2026-07-21T00:00:00.000Z' },
    validator_version: 'transcription_provider_selection_engine_validator_v1'
  };
}

function transportContract() {
  return {
    transport_contract_id: 'transport_contract_deepgram_mock_1',
    contract_version: TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION,
    transport_version: 1,
    validator_version: TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION,
    provider_slug: 'deepgram',
    transport_type: 'http_future',
    transport_state: 'BLOCKED',
    review_phase: 'validation_review',
    transport_policy: { open_socket_blocked: true, open_connection_blocked: true, resolve_dns_blocked: true, create_client_blocked: true, create_session_blocked: true, create_channel_blocked: true, retry_real: false, transport_simulated: true, network: false, connected: false },
    transport_readiness: { readiness_decision: 'READY_FOR_PROVIDER_ADAPTER_REVIEW' },
    environment: 'local_test',
    rollout_percentage: 0,
    runtime_enabled: false,
    provider_enabled: false,
    network_enabled: false,
    secret_resolved: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true,
    provider_runtime_enabled: false,
    provider_selected_for_execution: false,
    transport_enabled: false
  };
}

test('orchestrator optional secret resolution records sanitized metadata only', () => {
  const result = runMockTranscriptionOrchestrator({
    request: orchestratorRequest(),
    selection_request: selectionRequest(),
    selection_profiles: capabilityFixture.profiles,
    secret_resolution_request: resolutionRequest({ conversation_id: 'conversation_secret' }),
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(result.status, 'SIMULATED_SUCCESS');
  assert.equal(result.secret_resolution.result.secret_material_returned, false);
  assert.equal(result.response.provider_called, false);
  assert.equal(result.response.network_used, false);
  assert.equal(JSON.stringify(result.response).includes('mock_provider_a_transcription_reference'), false);
  assert.equal(validateTranscriptionExecutionContext(result.execution_context).valid, true);
  assert.equal(result.execution_context.secret_reference_fingerprint, result.secret_reference_fingerprint);
});

test('orchestrator mock flow without secret reference remains unchanged and succeeds', () => {
  const result = runMockTranscriptionOrchestrator({
    request: orchestratorRequest(),
    selection_request: selectionRequest(),
    selection_profiles: capabilityFixture.profiles,
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(result.status, 'SIMULATED_SUCCESS');
  assert.equal(result.secret_resolution, null);
});

test('regression secret boundary modules do not use network sdk env filesystem or provider real', () => {
  const files = [
    'services/api/src/core/transcription-secret-resolution-boundary.js',
    'services/api/src/core/transcription-secret-access-policy.js',
    'services/api/src/core/transcription-secret-resolution-result.js',
    'services/api/src/core/transcription-secret-resolution-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|fs)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(/deepgram-sdk|@google-cloud\/speech|openai|assemblyai/i.test(source), false);
  }
});

test('regression secret boundary is not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-secret-resolution'), false);
  }
});
