'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PROVIDER_ADAPTER_METHODS,
  TRANSCRIPTION_PROVIDER_ADAPTER_CONTRACT_VERSION,
  TRANSCRIPTION_PROVIDER_ADAPTER_VALIDATOR_VERSION,
  buildProviderAdapterMethodResult,
  normalizeProviderAdapterMetadata,
  validateProviderAdapterImplementation,
  validateProviderAdapterMetadata,
  validateProviderAdapterMethodInput,
  validateProviderAdapterMethodResult
} = require('../src/core/transcription-provider-adapter-interface');
const { createProviderAdapterRegistry } = require('../src/core/transcription-provider-adapter-registry');
const { evaluateProviderAdapterReadiness } = require('../src/core/transcription-provider-adapter-readiness');
const { createTranscriptionProviderAdapterMock } = require('../src/adapters/transcription/transcription-provider-adapter-mock');

const repoRoot = path.resolve(__dirname, '../../..');
const docPath = path.join(repoRoot, 'docs', 'TRANSCRIPTION_PROVIDER_ADAPTER_CONTRACT.md');

function metadata(overrides = {}) {
  return {
    adapter_id: 'adapter_deepgram_contract_v1',
    adapter_version: 1,
    provider_slug: 'deepgram',
    provider_version: 'documentary_provider_v1',
    contract_version: TRANSCRIPTION_PROVIDER_ADAPTER_CONTRACT_VERSION,
    validator_version: TRANSCRIPTION_PROVIDER_ADAPTER_VALIDATOR_VERSION,
    supported_features: [
      'cancel_blocked',
      'capabilities',
      'cost_estimation_synthetic',
      'health',
      'latency_estimation_synthetic',
      'metadata',
      'supported_formats',
      'supported_languages',
      'transcribe_blocked',
      'validate'
    ],
    supported_languages: ['pt-BR', 'pt-PT'],
    supported_formats: ['audio_placeholder_none', 'synthetic_metadata_only'],
    cost_model: { currency: 'BRL', minor_units: 0, unit: 'synthetic_minute' },
    latency_profile: { p50_ms: 0, p95_ms: 0 },
    transport_contract_version: 'transcription_transport_contract_v1',
    provider_contract_version: 'transcription_provider_contract_boundary_v1',
    simulated: true,
    executed: false,
    runtime_enabled: false,
    provider_enabled: false,
    network_enabled: false,
    production_blocked: true,
    rollout_percentage: 0,
    ...overrides
  };
}

function input(method = 'health', overrides = {}) {
  return {
    adapter_id: 'adapter_deepgram_contract_v1',
    provider_slug: 'deepgram',
    operation: method,
    request_id: `request_${method}`,
    simulated: true,
    ...overrides
  };
}

function assertSafe(value) {
  assert.equal(value.simulated, true);
  assert.equal(value.executed, false);
  assert.equal(value.runtime_enabled, false);
  assert.equal(value.provider_enabled, false);
  assert.equal(value.network_enabled, false);
  assert.equal(value.production_blocked, true);
  assert.equal(value.rollout_percentage, 0);
}

function assertBlocks(errors, reason) {
  assert.ok(errors.includes(reason) || errors.some((error) => String(error).includes(reason)), `${reason} not found in ${errors.join(',')}`);
}

test('provider adapter contract docs exist', () => {
  assert.equal(fs.existsSync(docPath), true);
});

test('provider adapter metadata contract accepts a valid adapter', () => {
  assert.equal(validateProviderAdapterMetadata(metadata()).valid, true);
});

[
  ['missing field', (() => { const value = metadata(); delete value.adapter_id; return value; })(), 'adapter_missing_adapter_id'],
  ['extra field', metadata({ extra: 'nope' }), 'adapter_unexpected_field::extra'],
  ['invalid provider', metadata({ provider_slug: 'unknown' }), 'provider_slug_not_allowed::unknown'],
  ['invalid adapter version', metadata({ adapter_version: 0 }), 'adapter_version_invalid'],
  ['invalid contract version', metadata({ contract_version: 'old_contract' }), 'contract_version_invalid'],
  ['invalid validator version', metadata({ validator_version: 'old_validator' }), 'validator_version_invalid'],
  ['rollout nonzero', metadata({ rollout_percentage: 1 }), 'rollout_percentage_must_be_0'],
  ['runtime enabled', metadata({ runtime_enabled: true }), 'runtime_enabled_must_be_false'],
  ['provider enabled', metadata({ provider_enabled: true }), 'provider_enabled_must_be_false'],
  ['network enabled', metadata({ network_enabled: true }), 'network_enabled_must_be_false'],
  ['production not blocked', metadata({ production_blocked: false }), 'production_blocked_must_be_true'],
  ['unsupported feature', metadata({ supported_features: ['metadata', 'real_transcription'] }), 'supported_feature_not_allowed::real_transcription'],
  ['unsorted array', metadata({ supported_languages: ['pt-PT', 'pt-BR'] }), 'supported_languages_must_be_sorted'],
  ['duplicate array', metadata({ supported_formats: ['synthetic_metadata_only', 'synthetic_metadata_only'] }), 'supported_formats_duplicate'],
  ['secret blocked', metadata({ secret: 'never' }), 'adapter_unexpected_field::secret'],
  ['endpoint blocked', metadata({ endpoint: 'provider-runtime' }), 'adapter_unexpected_field::endpoint']
].forEach(([name, candidate, reason]) => {
  test(`provider adapter metadata blocks ${name}`, () => {
    assertBlocks(validateProviderAdapterMetadata(candidate).errors, reason);
  });
});

[
  ['NaN', { adapter_version: NaN }, 'payload_not_serializable::non_finite_number_not_serializable'],
  ['Infinity', { adapter_version: Infinity }, 'payload_not_serializable::non_finite_number_not_serializable'],
  ['function', { cost_model: { compute() {} } }, 'payload_not_serializable::function_not_serializable'],
  ['symbol', { cost_model: { value: Symbol('x') } }, 'payload_not_serializable::symbol_not_serializable'],
  ['bigint', { cost_model: { value: BigInt(1) } }, 'payload_not_serializable::bigint_not_serializable']
].forEach(([name, override, reason]) => {
  test(`provider adapter metadata rejects ${name}`, () => {
    assertBlocks(validateProviderAdapterMetadata(metadata(override)).errors, reason);
  });
});

test('provider adapter metadata rejects cyclic references', () => {
  const value = metadata();
  value.cost_model.self = value.cost_model;
  assertBlocks(validateProviderAdapterMetadata(value).errors, 'payload_not_serializable::cyclic_reference_not_serializable');
});

test('provider adapter metadata normalization returns frozen defensive clone', () => {
  const original = metadata();
  const normalized = normalizeProviderAdapterMetadata(original);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.cost_model), true);
  assert.throws(() => {
    normalized.cost_model.minor_units = 1;
  }, TypeError);
  assert.equal(original.cost_model.minor_units, 0);
});

test('provider adapter method input and output contracts validate exact shapes', () => {
  assert.equal(validateProviderAdapterMethodInput('health', input('health'), metadata()).valid, true);
  const result = buildProviderAdapterMethodResult('health', metadata(), { result: { healthy: true } });
  assert.equal(validateProviderAdapterMethodResult('health', result, metadata()).valid, true);
  assertSafe(result);
});

[
  ['input missing field', (() => { const value = input('health'); delete value.request_id; return value; })(), 'input_missing_request_id'],
  ['input extra field', input('health', { raw_audio: 'no' }), 'input_unexpected_field::raw_audio'],
  ['input provider mismatch', input('health', { provider_slug: 'google_cloud_speech' }), 'provider_slug_mismatch'],
  ['input operation mismatch', input('health', { operation: 'transcribe' }), 'operation_mismatch'],
  ['input simulated false', input('health', { simulated: false }), 'simulated_must_be_true']
].forEach(([name, candidate, reason]) => {
  test(`provider adapter method blocks ${name}`, () => {
    assertBlocks(validateProviderAdapterMethodInput('health', candidate, metadata()).errors, reason);
  });
});

test('provider adapter result blocks unsafe fields and execution flags', () => {
  const result = buildProviderAdapterMethodResult('health', metadata(), { result: { healthy: true } });
  assertBlocks(validateProviderAdapterMethodResult('health', { ...result, executed: true }, metadata()).errors, 'executed_must_be_false');
  assertBlocks(validateProviderAdapterMethodResult('health', { ...result, extra: true }, metadata()).errors, 'result_unexpected_field::extra');
});

test('provider adapter implementation requires all and only official methods', () => {
  const mock = createTranscriptionProviderAdapterMock();
  assert.equal(validateProviderAdapterImplementation(mock).valid, true);
  const invalid = { ...mock, extra() {} };
  assertBlocks(validateProviderAdapterImplementation(invalid).errors, 'unexpected_method::extra');
  const missing = { ...mock };
  delete missing.transcribe;
  assertBlocks(validateProviderAdapterImplementation(missing).errors, 'missing_method::transcribe');
});

test('provider adapter mock implements every method safely', () => {
  const mock = createTranscriptionProviderAdapterMock();
  assert.deepEqual(Object.keys(mock).sort(), [...PROVIDER_ADAPTER_METHODS].sort());
  const meta = mock.metadata();
  assert.equal(validateProviderAdapterMetadata(meta).valid, true);
  for (const method of PROVIDER_ADAPTER_METHODS.filter((name) => name !== 'metadata')) {
    const result = mock[method](input(method, { adapter_id: meta.adapter_id }));
    assert.equal(validateProviderAdapterMethodResult(method, result, meta).valid, true);
    assertSafe(result);
    assert.equal(Object.isFrozen(result), true);
  }
  assert.equal(mock.transcribe(input('transcribe', { adapter_id: meta.adapter_id })).result.transcribed, false);
});

test('provider adapter mock blocks invalid metadata without provider execution', () => {
  const mock = createTranscriptionProviderAdapterMock({ network_enabled: true });
  const result = mock.health(input('health', { adapter_id: mock.metadata().adapter_id }));
  assertBlocks(result.errors, 'network_enabled_must_be_false');
  assertSafe(result);
});

test('provider adapter readiness reaches provider review only with valid mock and boundaries', () => {
  const mock = createTranscriptionProviderAdapterMock();
  const meta = mock.metadata();
  const readiness = evaluateProviderAdapterReadiness({
    adapter: mock,
    metadata: meta,
    healthResult: mock.health(input('health', { adapter_id: meta.adapter_id }))
  }, {
    transport_ready: true,
    provider_contract_ready: true,
    now: '2026-07-19T00:00:00.000Z'
  });
  assert.equal(readiness.readiness_decision, 'READY_FOR_PROVIDER_REVIEW');
  assert.equal(readiness.ready_for_production, false);
  assert.equal(readiness.ready_for_network, false);
  assert.equal(readiness.ready_for_runtime, false);
  assertSafe(readiness);
});

test('provider adapter readiness blocks missing contracts and never production', () => {
  const mock = createTranscriptionProviderAdapterMock();
  const readiness = evaluateProviderAdapterReadiness({ adapter: mock, metadata: mock.metadata() });
  assert.equal(readiness.readiness_decision, 'NOT_READY');
  assertBlocks(readiness.blocking_requirements, 'health_result_required');
  assertBlocks(readiness.blocking_requirements, 'transport_review_required');
  assert.equal(readiness.ready_for_production, false);
});

test('provider adapter registry registers and returns defensive clones', () => {
  const registry = createProviderAdapterRegistry();
  assert.equal(registry.registerAdapter(metadata()).ok, true);
  const stored = registry.getAdapter(metadata().adapter_id);
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => {
    stored.cost_model.minor_units = 1;
  }, TypeError);
  assert.equal(registry.getAdapter(metadata().adapter_id).cost_model.minor_units, 0);
});

test('provider adapter registry blocks replay payload mismatch downgrade and optimistic conflict', () => {
  const registry = createProviderAdapterRegistry();
  assert.equal(registry.registerAdapter(metadata()).ok, true);
  assertBlocks(registry.registerAdapter(metadata()).errors, 'adapter_replay_duplicate');
  assertBlocks(registry.registerAdapter(metadata({ provider_version: 'changed' })).errors, 'adapter_replay_payload_mismatch');
  assertBlocks(registry.registerAdapter(metadata({ adapter_id: 'adapter_v0', adapter_version: 1 })).errors, 'adapter_version_downgrade');
  assertBlocks(createProviderAdapterRegistry().registerAdapter(metadata(), { expected_version: 2 }).errors, 'adapter_optimistic_version_conflict');
});

test('provider adapter registry fingerprint failure does not store history', () => {
  const registry = createProviderAdapterRegistry();
  const invalid = metadata({ adapter_id: 'cyclic_adapter' });
  invalid.cost_model.self = invalid.cost_model;
  assertBlocks(registry.registerAdapter(invalid).errors, 'payload_not_serializable::cyclic_reference_not_serializable');
  assert.equal(registry.getAdapter('cyclic_adapter'), null);
  assert.deepEqual(registry.getHistory('deepgram'), []);
});

test('provider adapter registry invariant stays safe', () => {
  const registry = createProviderAdapterRegistry();
  assert.equal(registry.registerAdapter(metadata()).ok, true);
  const invariant = registry.validateRegistryInvariant();
  assert.equal(invariant.ok, true);
  assertSafe(invariant);
});

test('regression keeps provider adapter contract out of runtime message confirm surfaces', () => {
  const runtimeFiles = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js'),
    path.join(repoRoot, 'services', 'worker', 'src', 'index.js')
  ];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-provider-adapter'), false);
  }
});

test('regression provider adapter modules do not use network sdk env or filesystem', () => {
  const files = [
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-adapter-interface.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-adapter-readiness.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-adapter-registry.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'adapters', 'transcription', 'transcription-provider-adapter-mock.js')
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
