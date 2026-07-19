'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION,
  ORCHESTRATOR_STATUSES,
  PIPELINE_STEPS,
  runMockTranscriptionOrchestrator,
  validateTranscriptionOrchestratorRequest
} = require('../src/core/transcription-orchestrator');
const {
  validateTranscriptionResponse
} = require('../src/core/transcription-response-contract');
const {
  validateTranscriptionOrchestratorAudit
} = require('../src/core/transcription-orchestrator-audit');
const {
  createTranscriptionExecutionContext,
  validateTranscriptionExecutionContext
} = require('../src/core/transcription-execution-context');
const { createTranscriptionProviderAdapterMock } = require('../src/adapters/transcription/transcription-provider-adapter-mock');
const { TRANSCRIPTION_PROVIDER_CONTRACT_VERSION } = require('../src/core/transcription-provider-contract');
const {
  TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION,
  TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION
} = require('../src/core/transcription-transport-contract');

const repoRoot = path.resolve(__dirname, '../../..');

function consent(overrides = {}) {
  return {
    consent_id: 'consent_mock_orchestrator_1',
    transcription_id: 'transcription_mock_orchestrator_1',
    tenant_id: 'tenant_mock',
    workspace_type: 'internal',
    subject_type: 'synthetic_subject',
    purpose: 'development_test',
    capture_source: 'synthetic_fixture',
    requested_at: '2026-07-19T00:00:00.000Z',
    granted_at: '2026-07-19T00:01:00.000Z',
    expires_at: '2026-07-20T00:00:00.000Z',
    consent_status: 'granted',
    consent_version: 1,
    granted_by: 'operator_a',
    revocation_status: 'not_revoked',
    revoked_at: null,
    revocation_reason: null,
    allowed_operations: ['summarize_transcription'],
    data_classification: 'synthetic',
    simulated: true,
    ...overrides
  };
}

function providerContract(overrides = {}) {
  return {
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
    supported_operations: [
      'classify_provider_error',
      'normalize_provider_response',
      'simulate_provider_request',
      'validate_provider_request'
    ],
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
    secret_resolved: false,
    ...overrides
  };
}

function transportContract(overrides = {}) {
  return {
    transport_contract_id: 'transport_contract_deepgram_mock_1',
    contract_version: TRANSCRIPTION_TRANSPORT_CONTRACT_VERSION,
    transport_version: 1,
    validator_version: TRANSCRIPTION_TRANSPORT_VALIDATOR_VERSION,
    provider_slug: 'deepgram',
    transport_type: 'http_future',
    transport_state: 'BLOCKED',
    review_phase: 'validation_review',
    transport_policy: {
      open_socket_blocked: true,
      open_connection_blocked: true,
      resolve_dns_blocked: true,
      create_client_blocked: true,
      create_session_blocked: true,
      create_channel_blocked: true,
      retry_real: false,
      transport_simulated: true,
      network: false,
      connected: false
    },
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
    transport_enabled: false,
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    request_id: 'mock_orchestrator_request_1',
    request_version: 1,
    tenant_id: 'tenant_mock',
    conversation_id: 'conversation_mock_1',
    provider_slug: 'deepgram',
    requested_language: 'pt-BR',
    requested_format: 'synthetic_metadata_only',
    requested_features: ['summary'],
    consent_context: { consent: consent() },
    simulation_context: {
      simulation: true,
      production_blocked: true,
      rollout_percentage: 0,
      network_used: false,
      provider_called: false,
      executed: false
    },
    transport_context: { transport_contract_id: 'transport_contract_deepgram_mock_1' },
    adapter_context: { adapter_id: 'transcription_provider_adapter_mock_deepgram_v1' },
    metadata: {
      transcription_id: 'transcription_mock_orchestrator_1',
      evaluated_at: '2026-07-19T00:02:00.000Z',
      simulation: true,
      production_blocked: true,
      rollout_percentage: 0,
      network_used: false,
      provider_called: false,
      executed: false
    },
    validator_version: TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION,
    ...overrides
  };
}

function run(overrides = {}) {
  const req = overrides.request || request();
  return runMockTranscriptionOrchestrator({
    request: req,
    provider_contract: overrides.provider_contract || providerContract(),
    adapter: overrides.adapter || createTranscriptionProviderAdapterMock(),
    transport_contract: overrides.transport_contract || transportContract(),
    transport_lifecycle: overrides.transport_lifecycle || {
      transport_state: 'BLOCKED',
      provider_slug: 'deepgram',
      transport_contract_id: 'transport_contract_deepgram_mock_1',
      runtime_enabled: false,
      provider_enabled: false,
      network_enabled: false,
      production_blocked: true
    }
  });
}

function assertSafeResponse(response) {
  assert.equal(response.simulation, true);
  assert.equal(response.production_blocked, true);
  assert.equal(response.network_used, false);
  assert.equal(response.provider_called, false);
  assert.equal(response.executed, false);
  assert.equal(response.rollout_percentage, 0);
}

test('mock transcription orchestrator docs exist', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'TRANSCRIPTION_MOCK_ORCHESTRATOR.md')), true);
});

test('orchestrator request contract accepts exact valid request', () => {
  assert.equal(validateTranscriptionOrchestratorRequest(request()).valid, true);
});

test('orchestrator request blocks missing fields extras and unsafe flags', () => {
  const missing = request();
  delete missing.tenant_id;
  assert.ok(validateTranscriptionOrchestratorRequest(missing).errors.includes('request_missing_tenant_id'));
  assert.ok(validateTranscriptionOrchestratorRequest(request({ extra: true })).errors.includes('request_unexpected_field::extra'));
  assert.ok(validateTranscriptionOrchestratorRequest(request({ metadata: { ...request().metadata, network_used: true } })).errors.includes('metadata_network_used_must_be_false'));
});

test('orchestrator request blocks non serializable payloads before execution', () => {
  const cyclic = request();
  cyclic.metadata.self = cyclic.metadata;
  assert.ok(validateTranscriptionOrchestratorRequest(cyclic).errors.some((error) => error.includes('cyclic_reference')));
});

test('mock transcription orchestrator completes deterministic pipeline', () => {
  const result = run();
  assert.equal(result.status, 'SIMULATED_SUCCESS');
  assert.deepEqual(result.steps, PIPELINE_STEPS);
  assert.equal(validateTranscriptionResponse(result.response).valid, true);
  assert.equal(validateTranscriptionOrchestratorAudit(result.audit).valid, true);
  assert.equal(validateTranscriptionExecutionContext(result.execution_context).valid, true);
  assertSafeResponse(result.response);
  assert.equal(result.response.transcript, 'synthetic transcript placeholder');
});

test('orchestrator output is immutable and deeply freezes public response', () => {
  const result = run();
  assert.equal(Object.isFrozen(result.response), true);
  assert.equal(Object.isFrozen(result.audit), true);
  assert.equal(Object.isFrozen(result.execution_context), true);
  assert.throws(() => {
    result.response.warnings.push('mutate');
  }, TypeError);
});

test('orchestrator pipeline does not mutate caller input', () => {
  const req = request();
  const before = JSON.stringify(req);
  run({ request: req });
  assert.equal(JSON.stringify(req), before);
  assert.equal(Object.isFrozen(req), false);
});

[
  ['consent negado', { request: request({ consent_context: { consent: consent({ consent_status: 'denied' }) } }) }, 'CONSENT_DENIED'],
  ['provider invalido', { provider_contract: providerContract({ provider_slug: 'google_cloud_speech' }) }, 'PROVIDER_BLOCKED'],
  ['adapter invalido', { adapter: createTranscriptionProviderAdapterMock({ network_enabled: true }) }, 'PROVIDER_BLOCKED'],
  ['transport invalido', { transport_contract: transportContract({ network_enabled: true }) }, 'TRANSPORT_BLOCKED'],
  ['lifecycle invalido', { transport_lifecycle: { transport_state: 'CONNECTED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true } }, 'TRANSPORT_BLOCKED'],
  ['mock invalido', { adapter: createTranscriptionProviderAdapterMock({ adapter_id: 'wrong_adapter' }) }, 'PROVIDER_BLOCKED']
].forEach(([name, overrides, status]) => {
  test(`orchestrator blocks ${name}`, () => {
    const result = run(overrides);
    assert.equal(result.status, status);
    assert.ok(result.blockers.length > 0);
    assertSafeResponse(result.response);
  });
});

test('orchestrator uses only official mock adapter and never calls provider network or runtime', () => {
  const result = run();
  assert.equal(result.mock.executed, false);
  assert.equal(result.mock.provider_enabled, false);
  assert.equal(result.mock.network_enabled, false);
  assert.equal(result.audit.network, false);
  assert.equal(result.audit.provider_execution, false);
});

test('response contract blocks forbidden real statuses and execution flags', () => {
  const result = run().response;
  assert.ok(validateTranscriptionResponse({ ...result, status: 'SUCCESS_REAL' }).errors.includes('response_status_not_allowed::SUCCESS_REAL'));
  assert.ok(validateTranscriptionResponse({ ...result, executed: true }).errors.includes('executed_must_be_false'));
});

test('execution context factory returns exact immutable shape', () => {
  const context = createTranscriptionExecutionContext({ state: 'SIMULATED_SUCCESS', provider: { provider_slug: 'deepgram' } });
  assert.equal(validateTranscriptionExecutionContext(context).valid, true);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.provider), true);
});

test('all orchestrator statuses stay non-real', () => {
  assert.equal(ORCHESTRATOR_STATUSES.includes('SUCCESS_REAL'), false);
  assert.equal(ORCHESTRATOR_STATUSES.includes('EXECUTED'), false);
  assert.equal(ORCHESTRATOR_STATUSES.includes('CONNECTED'), false);
});

test('regression keeps mock orchestrator out of runtime message confirm surfaces', () => {
  const files = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js'),
    path.join(repoRoot, 'services', 'worker', 'src', 'index.js')
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-orchestrator'), false);
  }
});

test('regression new orchestrator modules do not use network sdk env timers or filesystem', () => {
  const files = [
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-orchestrator.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-execution-context.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-response-contract.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-orchestrator-audit.js')
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|fs|timers)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(/deepgram-sdk|@google-cloud\/speech|openai|assemblyai/i.test(source), false);
  }
});
