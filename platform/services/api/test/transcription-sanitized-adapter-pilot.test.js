'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  FORBIDDEN_TRANSCRIPTION_FIELDS,
  REQUIRED_TRANSCRIPTION_REQUEST_FIELDS,
  TRANSCRIPTION_ADAPTER_ID,
  TRANSCRIPTION_CONFIGURATION_ID,
  TRANSCRIPTION_CONNECTOR_ID,
  TRANSCRIPTION_PROVIDER_ID,
  TRANSCRIPTION_SECRET_REFERENCE_ID,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData,
  validateTranscriptionRequest,
  validateTranscriptionResult
} = require('../src/core/transcription-contract');
const {
  createNetworkDenyProbe,
  createFakeTranscriptionProvider,
  createTranscriptionSanitizedAdapter,
  metadata,
  validateSyntheticProvider
} = require('../src/adapters/transcription/transcription-sanitized-adapter');
const {
  change,
  createPilotContext,
  lifecycleRecord,
  providerConfiguration,
  runTranscriptionSanitizedAdapterDryRun,
  secretReference,
  transcriptionRequest
} = require('../src/pilots/transcription-sanitized-adapter-pilot');
const { createReadOnlyAdapterRegistry } = require('../src/core/read-only-adapter-registry');
const { validateAdapterMetadata } = require('../src/core/read-only-adapter-contract');
const { validateProviderConfiguration } = require('../src/core/provider-configuration-contract');
const { evaluateProviderConfigurationReadiness } = require('../src/core/provider-configuration-readiness');

const repoRoot = path.resolve(__dirname, '../../..');
const docPath = path.join(repoRoot, 'docs', 'TRANSCRIPTION_SANITIZED_ADAPTER_PILOT.md');
const fixturePath = path.join(__dirname, 'fixtures', 'hermes-transcription-sanitized-adapter-pilot.json');
const exampleConfigPath = path.join(__dirname, '..', 'config', 'transcription-provider.example.json');

function fixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function assertNoForbidden(value) {
  const json = JSON.stringify(value);
  for (const field of FORBIDDEN_TRANSCRIPTION_FIELDS) {
    assert.equal(json.includes(`"${field}"`), false, `leaked forbidden field ${field}`);
  }
}

function invalidProvider(overrides = {}) {
  let calls = 0;
  return {
    metadata: {
      provider_kind: 'synthetic_test_double',
      network_capable: false,
      real_provider: false
    },
    async summarize() {
      calls += 1;
      return {
        segments: [{ start_ms: 0, end_ms: 100, text: 'unsafe should not run' }],
        text: 'unsafe should not run',
        confidence: 0.5,
        language_detected: 'pt-BR',
        duration_ms: 100
      };
    },
    calls() {
      return calls;
    },
    ...overrides
  };
}

test('transcription sanitized adapter pilot docs fixture and safe example config exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
  assert.equal(fs.existsSync(exampleConfigPath), true);
  const data = fixture();
  for (const state of ['registered', 'configured', 'validated', 'ready', 'pilot_enabled', 'production_blocked']) {
    assert.ok(data.lifecycle_states.includes(state), state);
  }
  for (const field of REQUIRED_TRANSCRIPTION_REQUEST_FIELDS.slice(0, 8)) {
    assert.ok(data.required_contract_fields.includes(field), field);
  }
  assert.equal(data.default_rules.real_provider_calls_allowed, false);
  assert.equal(data.default_rules.real_transcription_allowed, false);
  assert.equal(data.default_rules.external_network_allowed_in_ci, false);
  assert.equal(data.default_rules.endpoint_added, false);
  assert.equal(data.default_rules.message_integration_added, false);
  assert.equal(data.default_rules.confirm_integration_added, false);
  assert.equal(data.default_rules.secrets_added, false);
  const example = fs.readFileSync(exampleConfigPath, 'utf8');
  assert.equal(/api[_-]?key|access[_-]?token|endpoint"\s*:|"url"\s*:/i.test(example), false);
});

test('transcription contract validates required fields and blocks forbidden payloads', () => {
  const request = transcriptionRequest();
  assert.equal(validateTranscriptionRequest(request).valid, true);
  assert.ok(validateTranscriptionRequest({ ...request, provider_id: 'other' }).errors.includes('provider_id_mismatch'));
  assert.ok(validateTranscriptionRequest({ ...request, adapter_id: 'other' }).errors.includes('adapter_id_mismatch'));
  assert.ok(validateTranscriptionRequest({ ...request, media_type: 'audio/wav' }).errors.includes('media_type_not_allowed'));
  assert.ok(validateTranscriptionRequest({ ...request, duration_ms: 999999999 }).errors.includes('duration_ms_out_of_bounds'));
  assert.ok(validateTranscriptionRequest({ ...request, executed: true }).errors.includes('executed_must_be_false'));
  assert.ok(validateTranscriptionRequest({ ...request, real_provider_called: true }).errors.includes('real_provider_called_must_be_false'));

  const unsafe = {
    ...request,
    rawAudio: Buffer.from('audio'),
    nested: {
      provider_token: 'never',
      downloadUrl: 'https://example.invalid/file.wav',
      transcript_hint: 'safe'
    }
  };
  const forbidden = findTranscriptionForbiddenFields(unsafe);
  assert.ok(forbidden.includes('forbidden_field::rawAudio'));
  assert.ok(forbidden.includes('forbidden_field::provider_token'));
  assert.ok(forbidden.includes('forbidden_field::downloadUrl'));
  const sanitized = sanitizeTranscriptionData(unsafe);
  assertNoForbidden(sanitized);
  assert.equal(JSON.stringify(sanitized).includes('https://example.invalid'), false);
  assert.equal(JSON.stringify(sanitized).includes('never'), false);
});

test('sanitization blocks binary buffers invalid text large base64 and unexpected urls', () => {
  const value = {
    ok: 'texto seguro',
    binary_holder: Buffer.from('binary'),
    invalid_text: 'bad\uFFFDtext',
    encoded: 'A'.repeat(4096),
    public_link: 'https://unexpected.example/audio'
  };
  const found = findTranscriptionForbiddenFields(value);
  assert.ok(found.includes('forbidden_binary::binary_holder'));
  assert.ok(found.includes('invalid_utf8::invalid_text'));
  assert.ok(found.includes('base64_payload_too_large::encoded'));
  assert.ok(found.includes('unexpected_url::public_link'));
  const sanitized = sanitizeTranscriptionData(value);
  assert.deepEqual(sanitized, { ok: 'texto seguro' });
});

test('transcription result allows only sanitized fields', () => {
  const result = {
    segments: [{ start_ms: 0, end_ms: 1000, text: 'Segmento seguro.' }],
    text: 'Segmento seguro.',
    confidence: 0.9,
    language_detected: 'pt-BR',
    duration_ms: 1000
  };
  assert.equal(validateTranscriptionResult(result).valid, true);
  assert.ok(validateTranscriptionResult({ ...result, rawTranscript: 'never' }).errors.includes('result_field_not_allowed::rawTranscript'));
  assert.ok(validateTranscriptionResult({ ...result, provider_response_raw: 'never' }).errors.includes('result_field_not_allowed::provider_response_raw'));
  assert.ok(validateTranscriptionResult({ ...result, confidence: 2 }).errors.includes('confidence_out_of_bounds'));
});

test('adapter is isolated and dry-run uses only fake provider once', async () => {
  assert.equal(validateAdapterMetadata(metadata).valid, true);
  const registry = createReadOnlyAdapterRegistry([createTranscriptionSanitizedAdapter()]);
  assert.equal(registry.hasAdapter(TRANSCRIPTION_ADAPTER_ID), true);
  const provider = createFakeTranscriptionProvider();
  const adapter = createTranscriptionSanitizedAdapter({ provider });
  assert.equal(adapter.initialize().ok, true);
  assert.equal(adapter.validate(transcriptionRequest()).valid, true);
  const dryRun = await adapter.dryRun(transcriptionRequest());
  assert.equal(dryRun.status, 'transcription_mock_success');
  assert.equal(dryRun.executed, true);
  assert.equal(dryRun.real_provider_called, false);
  assert.equal(dryRun.external_network_called, false);
  assert.equal(dryRun.network_attempts, 0);
  assert.equal(dryRun.can_trigger_real_execution, false);
  assert.equal(provider.calls(), 1);
  assert.equal(adapter.shutdown().ok, true);
  assertNoForbidden(dryRun);
});

test('adapter blocks injected providers without strict synthetic metadata before summarize', async () => {
  const cases = [
    invalidProvider({ metadata: undefined }),
    invalidProvider({ metadata: { provider_kind: 'named_fake', network_capable: false, real_provider: false } }),
    invalidProvider({ metadata: { provider_kind: 'synthetic_test_double', network_capable: true, real_provider: false } }),
    invalidProvider({ metadata: { provider_kind: 'synthetic_test_double', network_capable: false, real_provider: true } }),
    invalidProvider({ endpoint: 'https://provider.example/transcribe' }),
    invalidProvider({ url: 'https://provider.example/transcribe' }),
    invalidProvider({ token: 'never' }),
    invalidProvider({ headers: { authorization: 'never' } })
  ];

  for (const provider of cases) {
    const adapter = createTranscriptionSanitizedAdapter({ provider });
    adapter.initialize();
    const result = await adapter.dryRun(transcriptionRequest());
    assert.equal(result.status, 'transcription_request_blocked');
    assert.equal(result.error.blocked_reason, 'transcription_provider_not_synthetic');
    assert.equal(result.executed, false);
    assert.equal(result.fake_provider_called, false);
    assert.equal(result.provider_call_count, 0);
    assert.equal(result.real_provider_called, false);
    assert.equal(result.external_network_called, false);
    assert.equal(provider.calls(), 0);
  }
  assert.equal(validateSyntheticProvider(createFakeTranscriptionProvider()).valid, true);
});

test('request forbidden fields are blocked before sanitization and fake provider is not called', async () => {
  const invalidRequests = [
    { rawAudio: Buffer.from('audio') },
    { binary: Buffer.from('audio') },
    { audioUrl: 'https://example.invalid/audio.wav' },
    { transcript_hint: 'A'.repeat(4096) },
    { nested: { token: 'never' } }
  ];
  for (const override of invalidRequests) {
    const provider = createFakeTranscriptionProvider();
    const adapter = createTranscriptionSanitizedAdapter({ provider });
    adapter.initialize();
    const result = await adapter.dryRun(transcriptionRequest(override));
    assert.equal(result.status, 'transcription_request_blocked');
    assert.equal(result.executed, false);
    assert.equal(result.fake_provider_called, false);
    assert.equal(result.fake_provider_calls, 0);
    assert.equal(result.provider_call_count, 0);
    assert.equal(provider.calls(), 0);
  }
});

test('raw result is validated before sanitization and unsafe output is blocked', async () => {
  const cases = [
    { secret: 'never', segments: [{ start_ms: 0, end_ms: 100, text: 'ok' }], text: 'ok', confidence: 0.9, language_detected: 'pt-BR', duration_ms: 100 },
    { segments: [{ start_ms: 0, end_ms: 100, text: 'ok' }], text: 'https://example.invalid/result', confidence: 0.9, language_detected: 'pt-BR', duration_ms: 100 },
    { segments: [{ start_ms: 0, end_ms: 100, text: 'ok' }], text: 'x'.repeat(5000), confidence: 0.9, language_detected: 'pt-BR', duration_ms: 100 }
  ];
  for (const rawResult of cases) {
    const provider = createFakeTranscriptionProvider(rawResult);
    const adapter = createTranscriptionSanitizedAdapter({ provider });
    adapter.initialize();
    const result = await adapter.dryRun(transcriptionRequest());
    assert.equal(result.status, 'transcription_result_blocked');
    assert.equal(result.executed, true);
    assert.equal(result.fake_provider_called, true);
    assert.equal(result.fake_provider_calls, 1);
    assert.equal(result.real_provider_called, false);
    assert.equal(result.external_network_called, false);
    assert.equal(provider.calls(), 1);
  }
});

test('segments reject unknown fields bad duration ordering overlap and confidence', () => {
  const base = {
    segments: [{ start_ms: 0, end_ms: 100, text: 'ok', confidence: 0.9, speaker_label: 'speaker_1' }],
    text: 'ok',
    confidence: 0.9,
    language_detected: 'pt-BR',
    duration_ms: 100
  };
  assert.equal(validateTranscriptionResult(base).valid, true);
  assert.ok(validateTranscriptionResult({ ...base, segments: [{ ...base.segments[0], rawTranscript: 'never' }] }).errors.includes('segment_field_not_allowed::rawTranscript'));
  assert.ok(validateTranscriptionResult({ ...base, segments: [{ start_ms: 0, end_ms: 101, text: 'ok' }] }).errors.includes('segment_outside_duration::0'));
  assert.ok(validateTranscriptionResult({ ...base, segments: [{ start_ms: 50, end_ms: 100, text: 'first' }, { start_ms: 10, end_ms: 60, text: 'second' }] }).errors.includes('segment_overlap_or_out_of_order::1'));
  assert.ok(validateTranscriptionResult({ ...base, segments: [{ start_ms: 0, end_ms: 50, text: 'first' }, { start_ms: 25, end_ms: 75, text: 'second' }] }).errors.includes('segment_overlap_or_out_of_order::1'));
  assert.ok(validateTranscriptionResult({ ...base, segments: [{ ...base.segments[0], confidence: 2 }] }).errors.includes('segment_confidence_out_of_bounds::0'));
});

test('network probe derives external network fields and blocks dry-run if attempted', async () => {
  const networkProbe = createNetworkDenyProbe();
  const provider = createFakeTranscriptionProvider();
  const adapter = createTranscriptionSanitizedAdapter({ provider, networkProbe });
  adapter.initialize();
  const success = await adapter.dryRun(transcriptionRequest());
  assert.equal(success.network_attempts, 0);
  assert.equal(success.external_network_called, false);

  const blockedProbe = createNetworkDenyProbe();
  const networkAwareProvider = createFakeTranscriptionProvider();
  const wrapped = {
    ...networkAwareProvider,
    async summarize(request) {
      blockedProbe.recordAttempt();
      return networkAwareProvider.summarize(request);
    }
  };
  const blockedAdapter = createTranscriptionSanitizedAdapter({ provider: wrapped, networkProbe: blockedProbe });
  blockedAdapter.initialize();
  const blocked = await blockedAdapter.dryRun(transcriptionRequest({ transcription_id: 'transcription_network_probe' }));
  assert.equal(blocked.status, 'transcription_result_blocked');
  assert.equal(blocked.network_attempts, 1);
  assert.equal(blocked.external_network_called, true);
  assert.equal(blocked.real_provider_called, false);
});

test('shutdown blocks dryRun and simulate without reinitializing adapter', async () => {
  const provider = createFakeTranscriptionProvider();
  const adapter = createTranscriptionSanitizedAdapter({ provider });
  assert.equal(adapter.initialize().ok, true);
  assert.equal(adapter.shutdown().ok, true);
  assert.equal(adapter.initialize().ok, false);
  const dryRun = await adapter.dryRun(transcriptionRequest());
  const simulate = await adapter.simulate(transcriptionRequest({ transcription_id: 'transcription_after_shutdown' }));
  assert.equal(dryRun.status, 'transcription_request_blocked');
  assert.equal(dryRun.error.blocked_reason, 'transcription_adapter_shutdown');
  assert.equal(simulate.status, 'transcription_request_blocked');
  assert.equal(provider.calls(), 0);
});

test('adapter blocks concurrent dryRun while running', async () => {
  let release;
  let calls = 0;
  const provider = {
    metadata: { provider_kind: 'synthetic_test_double', network_capable: false, real_provider: false },
    async summarize(request) {
      calls += 1;
      await new Promise((resolve) => { release = resolve; });
      return {
        segments: [{ start_ms: 0, end_ms: request.duration_ms, text: 'ok' }],
        text: 'ok',
        confidence: 0.9,
        language_detected: 'pt-BR',
        duration_ms: request.duration_ms
      };
    },
    calls() {
      return calls;
    }
  };
  const adapter = createTranscriptionSanitizedAdapter({ provider });
  adapter.initialize();
  const first = adapter.dryRun(transcriptionRequest({ transcription_id: 'transcription_running_first' }));
  const second = await adapter.dryRun(transcriptionRequest({ transcription_id: 'transcription_running_second' }));
  assert.equal(second.status, 'transcription_request_blocked');
  assert.equal(second.error.blocked_reason, 'transcription_adapter_already_running');
  assert.equal(second.executed, false);
  release();
  const completed = await first;
  assert.equal(completed.status, 'transcription_mock_success');
  assert.equal(provider.calls(), 1);
});

test('pilot reuses configuration secret lifecycle readiness and audit components', async () => {
  const context = createPilotContext();
  assert.equal(context.configurationRegistry.getConfiguration(TRANSCRIPTION_CONFIGURATION_ID).configuration_status, 'descriptor_registered');
  assert.equal(context.secretReferenceRegistry.getSecretReference(TRANSCRIPTION_SECRET_REFERENCE_ID).status, 'reference_registered');
  assert.equal(context.lifecycleRegistry.getConnector(TRANSCRIPTION_CONNECTOR_ID).lifecycle_state, 'registered');
  assert.equal(validateProviderConfiguration(providerConfiguration(), { now: '2026-07-18T00:00:00.000Z' }).valid, true);

  const dryRun = await runTranscriptionSanitizedAdapterDryRun();
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.lifecycle_registry_state.lifecycle_state, 'readiness_passed');
  assert.equal(dryRun.lifecycle_probe.lifecycle_record.lifecycle_state, dryRun.lifecycle_registry_state.lifecycle_state);
  assert.equal(dryRun.readiness.ready, true);
  assert.equal(dryRun.readiness.executed, false);
  assert.equal(dryRun.readiness.real_provider_called, false);
  assert.deepEqual(dryRun.configuration_transitions, ['reference_pending', 'reference_registered', 'validation_pending', 'structurally_ready']);
  assert.equal(dryRun.dry_run.provider_call_count, 1);
  assert.equal(dryRun.fake_provider_calls, 1);
  assert.equal(dryRun.network_attempts, 0);
  assert.equal(dryRun.external_network_called, false);
  assert.equal(dryRun.real_transcription_performed, false);
  assert.equal(dryRun.real_provider_called, false);
  assert.equal(dryRun.canary_compatible, true);
  assert.equal(dryRun.audit_valid, true);
  assertNoForbidden(dryRun);
});

test('readiness blocks revoked secret and production-enabled lifecycle', () => {
  const revokedContext = createPilotContext();
  revokedContext.secretReferenceRegistry.markReferenceRevoked({
    trace_id: 'trace_transcription_ref_revoked',
    change_id: 'change_transcription_ref_revoked',
    reference_id: TRANSCRIPTION_SECRET_REFERENCE_ID,
    operation: 'mark_revoked',
    expected_version: 1,
    actor_id: 'operator_transcription_fixture',
    actor_role: 'platform_operator',
    reason: 'synthetic revoked reference readiness test',
    requested_at: '2026-07-18T00:00:00.000Z',
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  const revokedReadiness = evaluateProviderConfigurationReadiness(providerConfiguration({
    configuration_status: 'validation_pending',
    configuration_version: 4
  }), {
    now: '2026-07-18T00:00:00.000Z',
    lifecycleRegistry: revokedContext.lifecycleRegistry,
    adapterRegistry: revokedContext.adapterRegistry,
    secretReferenceRegistry: revokedContext.secretReferenceRegistry,
    secretResolver: revokedContext.secretResolver,
    clock: () => '2026-07-18T00:00:00.000Z'
  });
  assert.equal(revokedReadiness.ready, false);
  assert.ok(revokedReadiness.blocking_reasons.includes('secret_reference_revoked'));

  const productionContext = createPilotContext({
    lifecycleRegistry: {
      getConnector() {
        return lifecycleRecord({ lifecycle_state: 'readiness_passed', lifecycle_version: 4, real_provider_enabled: true });
      }
    }
  });
  const productionReadiness = evaluateProviderConfigurationReadiness(providerConfiguration({
    configuration_status: 'validation_pending',
    configuration_version: 4
  }), {
    now: '2026-07-18T00:00:00.000Z',
    lifecycleRegistry: productionContext.lifecycleRegistry,
    adapterRegistry: productionContext.adapterRegistry,
    secretReferenceRegistry: productionContext.secretReferenceRegistry,
    secretResolver: productionContext.secretResolver,
    clock: () => '2026-07-18T00:00:00.000Z'
  });
  assert.equal(productionReadiness.ready, false);
  assert.ok(productionReadiness.blocking_reasons.includes('lifecycle_real_provider_enabled_must_be_false'));
});

test('configuration registry replay protection is preserved', () => {
  const context = createPilotContext();
  const first = context.configurationRegistry.applyConfigurationChange(
    change(TRANSCRIPTION_CONFIGURATION_ID, 'register_synthetic_reference', 1, 'replay_check'),
    {},
    { now: '2026-07-18T00:00:00.000Z', clock: () => '2026-07-18T00:00:00.000Z' }
  );
  assert.equal(first.applied, true);
  const replay = context.configurationRegistry.applyConfigurationChange(
    change(TRANSCRIPTION_CONFIGURATION_ID, 'register_synthetic_reference', 1, 'replay_check'),
    {},
    { now: '2026-07-18T00:00:00.000Z', clock: () => '2026-07-18T00:00:00.000Z' }
  );
  assert.equal(replay.applied, false);
  assert.equal(replay.error.error_code, 'REPLAYED_CONFIGURATION_REQUEST');
});

test('governance isolation keeps transcription pilot out of runtime endpoints and network APIs', () => {
  const runtimeFiles = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js')
  ];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-sanitized-adapter-pilot'), false);
    assert.equal(source.includes('transcription-sanitized-adapter'), false);
    assert.equal(source.includes('/transcription'), false);
  }

  const pilotFiles = [
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-contract.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'adapters', 'transcription', 'transcription-sanitized-adapter.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'pilots', 'transcription-sanitized-adapter-pilot.js')
  ];
  for (const file of pilotFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes("require('node:https')"), false);
    assert.equal(source.includes("require('node:http')"), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('setInterval('), false);
    assert.equal(source.includes('setTimeout('), false);
  }
});
