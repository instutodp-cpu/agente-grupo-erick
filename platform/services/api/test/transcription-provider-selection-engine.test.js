'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const capabilityFixture = require('./fixtures/hermes-transcription-provider-capability-matrix.json');
const selectionFixture = require('./fixtures/hermes-transcription-provider-selection-engine.json');
const {
  TRANSCRIPTION_PROVIDER_SELECTION_ENGINE_VALIDATOR_VERSION,
  selectTranscriptionProvider,
  validateSelectionRequest
} = require('../src/core/transcription-provider-selection-engine');
const {
  SELECTION_WEIGHTS,
  scoreTranscriptionProviderCandidate
} = require('../src/core/transcription-provider-selection-scoring');
const { validateSelectionResult } = require('../src/core/transcription-provider-selection-result');
const {
  TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION,
  runMockTranscriptionOrchestrator
} = require('../src/core/transcription-orchestrator');
const { createTranscriptionProviderAdapterMock } = require('../src/adapters/transcription/transcription-provider-adapter-mock');
const { TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION, TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION } = require('../src/core/transcription-transport-contract');

const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function profiles() {
  return clone(capabilityFixture.profiles);
}

function request(overrides = {}) {
  return {
    selection_request_id: 'selection_request_1',
    selection_request_version: 1,
    tenant_id: 'tenant_selection',
    conversation_id: 'conversation_selection',
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
    simulation_context: {
      simulation: true,
      network_used: false,
      provider_called: false,
      executed: false,
      production_blocked: true,
      rollout_percentage: 0
    },
    metadata: {
      requester: 'synthetic_test',
      evaluated_at: '2026-07-20T00:00:00.000Z'
    },
    validator_version: TRANSCRIPTION_PROVIDER_SELECTION_ENGINE_VALIDATOR_VERSION,
    ...overrides
  };
}

function assertSafe(value) {
  assert.equal(value.simulation, true);
  assert.equal(value.network_used || false, false);
  assert.equal(value.provider_called || false, false);
  assert.equal(value.executed || false, false);
  assert.equal(value.production_blocked, true);
  assert.equal(value.rollout_percentage, 0);
}

function assertBlocks(errors, reason) {
  assert.ok(errors.includes(reason) || errors.some((error) => String(error).includes(reason)), `${reason} not found in ${errors.join(',')}`);
}

function run(req = request(), profs = profiles()) {
  return selectTranscriptionProvider({ request: req, profiles: profs });
}

test('provider selection engine docs and fixture exist', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'TRANSCRIPTION_PROVIDER_SELECTION_ENGINE.md')), true);
  assert.equal(selectionFixture.simulation, true);
});

test('selection request valid', () => {
  assert.equal(validateSelectionRequest(request()).valid, true);
});

test('selection request blocks missing fields extras invalid types and duplicate arrays', () => {
  const missing = request();
  delete missing.tenant_id;
  assertBlocks(validateSelectionRequest(missing).errors, 'selection_request_missing_tenant_id');
  assertBlocks(validateSelectionRequest(request({ extra: true })).errors, 'selection_request_unexpected_field::extra');
  assertBlocks(validateSelectionRequest(request({ requested_sample_rate: 0 })).errors, 'requested_sample_rate_invalid');
  assertBlocks(validateSelectionRequest(request({ allowed_provider_slugs: ['mock-provider-a', 'mock-provider-a'] })).errors, 'allowed_provider_slugs_duplicate');
});

test('selection request blocks allowlist denylist conflict and unsafe simulation context', () => {
  assertBlocks(validateSelectionRequest(request({
    allowed_provider_slugs: ['mock-provider-a'],
    denied_provider_slugs: ['mock-provider-a']
  })).errors, 'allowlist_denylist_conflict::mock-provider-a');
  assertBlocks(validateSelectionRequest(request({
    simulation_context: { ...request().simulation_context, network_used: true }
  })).errors, 'simulation_context_network_used_must_be_false');
});

test('selection request blocks non serializable payloads', () => {
  const cyclic = request();
  cyclic.metadata.self = cyclic.metadata;
  assertBlocks(validateSelectionRequest(cyclic).errors, 'cyclic_reference');
});

test('selection BALANCED chooses deterministic compatible provider', () => {
  const selected = run();
  assert.equal(selected.result.status, 'SELECTED_SIMULATION');
  assert.equal(selected.result.selected_provider_slug, 'mock-provider-a');
  assert.equal(validateSelectionResult(selected.result).valid, true);
  assertSafe(selected.result);
});

test('selection LOW_COST chooses cheaper provider', () => {
  const profs = profiles();
  profs[0].estimated_cost_profile.minor_units_per_minute = 20;
  profs[1].estimated_cost_profile.minor_units_per_minute = 1;
  const selected = run(request({ priority_profile: 'LOW_COST', requested_features: { ...request().requested_features, streaming: true, partial_results: true, custom_vocabulary: true, profanity_filter: true } }), profs);
  assert.equal(selected.result.selected_provider_slug, 'mock-provider-b');
});

test('selection LOW_LATENCY chooses faster provider', () => {
  const profs = profiles();
  profs[0].estimated_latency_profile.p95_ms = 900;
  profs[1].estimated_latency_profile.p95_ms = 50;
  const selected = run(request({ priority_profile: 'LOW_LATENCY', requested_features: { ...request().requested_features, streaming: true } }), profs);
  assert.equal(selected.result.selected_provider_slug, 'mock-provider-b');
});

test('selection HIGH_QUALITY chooses richer capability profile', () => {
  const selected = run(request({
    priority_profile: 'HIGH_QUALITY',
    requested_features: { ...request().requested_features, word_timestamps: true, sentence_timestamps: true, speaker_diarization: true, language_detection: true, numeric_normalization: true, confidence_score: true }
  }));
  assert.equal(selected.result.selected_provider_slug, 'mock-provider-a');
});

test('selection MAX_COMPATIBILITY favors maximum matched capabilities', () => {
  const selected = run(request({
    priority_profile: 'MAX_COMPATIBILITY',
    requested_features: { ...request().requested_features, streaming: true, partial_results: true, custom_vocabulary: true, profanity_filter: true }
  }));
  assert.equal(selected.result.selected_provider_slug, 'mock-provider-b');
});

test('selection deterministic tiebreaker is independent of registry order', () => {
  const profs = profiles();
  const selectedA = run(request({ requested_features: { ...request().requested_features, confidence_score: false } }), profs);
  const selectedB = run(request({ requested_features: { ...request().requested_features, confidence_score: false } }), [...profs].reverse());
  assert.equal(selectedA.result.selected_provider_slug, selectedB.result.selected_provider_slug);
});

[
  ['idioma incompatível', request({ requested_language: 'fr-FR' }), 'LANGUAGE_UNSUPPORTED'],
  ['formato incompatível', request({ requested_audio_format: 'wav' }), 'FORMAT_UNSUPPORTED'],
  ['sample rate incompatível', request({ requested_sample_rate: 44100 }), 'SAMPLE_RATE_UNSUPPORTED'],
  ['canais incompatíveis', request({ requested_channels: 8 }), 'CHANNELS_UNSUPPORTED'],
  ['duração excedida', request({ requested_duration_seconds: 999999 }), 'DURATION_EXCEEDED'],
  ['tamanho excedido', request({ requested_size_mb: 999999 }), 'SIZE_EXCEEDED'],
  ['feature obrigatória ausente', request({ requested_features: { ...request().requested_features, translation: true } }), 'REQUIRED_FEATURE_UNSUPPORTED'],
  ['allowlist', request({ allowed_provider_slugs: ['mock-provider-c'] }), 'ALLOWLIST_BLOCKED'],
  ['denylist', request({ denied_provider_slugs: ['mock-provider-a', 'mock-provider-b', 'mock-provider-c'] }), 'DENYLIST_BLOCKED']
].forEach(([name, req, reason]) => {
  test(`selection rejects by ${name}`, () => {
    const selected = run(req);
    assert.ok(selected.result.rejections.some((rejection) => rejection.reason_code === reason));
    assertSafe(selected.result);
  });
});

test('selection returns no eligible provider fail closed', () => {
  const selected = run(request({ denied_provider_slugs: ['mock-provider-a', 'mock-provider-b', 'mock-provider-c'] }));
  assert.equal(selected.result.status, 'NO_ELIGIBLE_PROVIDER');
  assert.equal(selected.result.selected_provider_slug, 'none');
  assertSafe(selected.result);
});

test('selection rejects unsafe and invalid profiles', () => {
  const profs = profiles();
  profs[0].network_enabled = true;
  profs[1].provider_slug = 'invalid';
  const selected = run(request(), profs);
  assert.ok(selected.result.rejections.some((rejection) => rejection.reason_code === 'UNSAFE_PROFILE'));
  assert.ok(selected.result.rejections.some((rejection) => rejection.reason_code === 'INVALID_PROFILE'));
});

test('selection result audit and ranked candidates are immutable', () => {
  const selected = run();
  assert.equal(Object.isFrozen(selected.result), true);
  assert.equal(Object.isFrozen(selected.audit), true);
  assert.equal(Object.isFrozen(selected.result.ranked_candidates[0]), true);
  assert.throws(() => {
    selected.result.ranked_candidates.push({});
  }, TypeError);
});

test('selection does not mutate input profiles or request', () => {
  const req = request();
  const profs = profiles();
  const beforeReq = JSON.stringify(req);
  const beforeProfiles = JSON.stringify(profs);
  run(req, profs);
  assert.equal(JSON.stringify(req), beforeReq);
  assert.equal(JSON.stringify(profs), beforeProfiles);
});

test('selection scoring components are bounded and weights documented', () => {
  const score = scoreTranscriptionProviderCandidate(profiles()[0], request());
  for (const value of Object.values(score.scores)) {
    assert.equal(Number.isInteger(value), true);
    assert.ok(value >= 0 && value <= 100);
  }
  assert.equal(Object.values(SELECTION_WEIGHTS.BALANCED).reduce((sum, value) => sum + value, 0), 100);
});

function orchestratorRequest(providerSlug = 'AUTO') {
  return {
    request_id: 'orchestrator_auto_request',
    request_version: 1,
    tenant_id: 'tenant_selection',
    conversation_id: 'conversation_selection',
    provider_slug: providerSlug,
    requested_language: 'pt-BR',
    requested_format: 'synthetic_metadata_only',
    requested_features: ['summary'],
    consent_context: {
      consent: {
        consent_id: 'consent_auto_1',
        transcription_id: 'transcription_auto_1',
        tenant_id: 'tenant_selection',
        workspace_type: 'internal',
        subject_type: 'synthetic_subject',
        purpose: 'development_test',
        capture_source: 'synthetic_fixture',
        requested_at: '2026-07-20T00:00:00.000Z',
        granted_at: '2026-07-20T00:01:00.000Z',
        expires_at: '2026-07-21T00:00:00.000Z',
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
    metadata: { transcription_id: 'transcription_auto_1', evaluated_at: '2026-07-20T00:02:00.000Z', simulation: true, production_blocked: true, rollout_percentage: 0, network_used: false, provider_called: false, executed: false },
    validator_version: TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION
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

test('orchestrator provider_slug AUTO records synthetic selection', () => {
  const result = runMockTranscriptionOrchestrator({
    request: orchestratorRequest('AUTO'),
    selection_request: request(),
    selection_profiles: profiles(),
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(result.status, 'SIMULATED_SUCCESS');
  assert.equal(result.selection.result.selected_provider_slug, 'mock-provider-a');
  assert.equal(result.execution_context.selection.result.selected_provider_slug, 'mock-provider-a');
  assert.equal(result.response.provider_slug, 'mock-provider-a');
  assert.equal(result.mock.executed, false);
});

test('orchestrator explicit provider is preserved and AUTO selection is not used', () => {
  const result = runMockTranscriptionOrchestrator({
    request: orchestratorRequest('deepgram'),
    provider_contract: {
      provider_contract_id: 'provider_contract_deepgram_mock_1',
      provider_slug: 'deepgram',
      contract_version: 1,
      schema_version: 'schema_v1',
      capabilities_version: 'capabilities_v1',
      selection_report_id: 'selection_report_1',
      selection_dataset_version: 'selection_dataset_v1',
      selection_criteria_version: 'selection_criteria_v1',
      provider_role: 'primary_contract_candidate',
      contract_status: 'ready_for_mock_parity_review',
      deployment_model: 'managed_api_documentary',
      supported_operations: ['classify_provider_error', 'normalize_provider_response', 'simulate_provider_request', 'validate_provider_request'],
      supported_languages: ['pt-BR', 'pt-PT'],
      supported_audio_formats: ['audio_placeholder_none', 'synthetic_metadata_only'],
      max_duration_ms: 60000,
      max_size_bytes: 1024,
      timeout_limit_ms: 1000,
      concurrency_limit: 1,
      rate_limit_policy_required: true,
      budget_policy_required: true,
      consent_required: true,
      retention_policy_required: true,
      deletion_required: true,
      raw_media_retention_days: 0,
      network_allowlist_required: true,
      secret_reference_required: true,
      transport_required: true,
      runtime_registration_allowed: false,
      environment: 'local_test',
      rollout_percentage: 0,
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      production_blocked: true,
      provider_runtime_enabled: false,
      provider_selected_for_execution: false,
      transport_enabled: false,
      secret_resolved: false
    },
    selection_request: request(),
    selection_profiles: profiles(),
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(result.status, 'SIMULATED_SUCCESS');
  assert.equal(result.selection, null);
  assert.equal(result.response.provider_slug, 'deepgram');
});

test('regression selection engine modules do not use network sdk env or filesystem', () => {
  const files = [
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-selection-engine.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-selection-scoring.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-selection-result.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-selection-audit.js')
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|fs)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(/deepgram-sdk|@google-cloud\/speech|openai|assemblyai/i.test(source), false);
  }
});

test('regression selection engine is not imported by runtime endpoints', () => {
  const files = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js')
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-provider-selection-engine'), false);
  }
});
