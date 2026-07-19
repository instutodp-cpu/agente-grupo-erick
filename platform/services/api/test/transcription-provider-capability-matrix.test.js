'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  TRANSCRIPTION_PROVIDER_CAPABILITY_VALIDATOR_VERSION,
  createTranscriptionProviderCapabilityRegistry,
  fingerprintCapabilityProfile,
  normalizeCapabilityProfile,
  validateCapabilityProfile
} = require('../src/core/transcription-provider-capability-matrix');
const { createTranscriptionProviderCapabilityCatalog } = require('../src/core/transcription-provider-capability-catalog');
const { compareTranscriptionProviderCapabilities } = require('../src/core/transcription-provider-capability-comparator');

const repoRoot = path.resolve(__dirname, '../../..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hermes-transcription-provider-capability-matrix.json'), 'utf8'));

function profile(overrides = {}) {
  return {
    ...fixture.profiles[0],
    estimated_latency_profile: { ...fixture.profiles[0].estimated_latency_profile },
    estimated_cost_profile: { ...fixture.profiles[0].estimated_cost_profile },
    supported_languages: [...fixture.profiles[0].supported_languages],
    supported_audio_formats: [...fixture.profiles[0].supported_audio_formats],
    supported_sample_rates: [...fixture.profiles[0].supported_sample_rates],
    supported_channels: [...fixture.profiles[0].supported_channels],
    ...overrides
  };
}

function assertSafe(value) {
  assert.equal(value.simulation, true);
  assert.equal(value.network_enabled, false);
  assert.equal(value.provider_enabled, false);
  assert.equal(value.runtime_enabled, false);
  assert.equal(value.production_blocked, true);
  assert.equal(value.rollout_percentage, 0);
}

function assertBlocks(errors, reason) {
  assert.ok(errors.includes(reason) || errors.some((error) => String(error).includes(reason)), `${reason} not found in ${errors.join(',')}`);
}

test('provider capability matrix docs and fixture exist', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'TRANSCRIPTION_PROVIDER_CAPABILITY_MATRIX.md')), true);
  assert.equal(fixture.simulated, true);
  assert.equal(fixture.network_enabled, false);
});

test('capability profile valid', () => {
  const validation = validateCapabilityProfile(profile());
  assert.equal(validation.valid, true);
});

[
  ['campos ausentes', (() => { const value = profile(); delete value.provider_slug; return value; })(), 'profile_missing_provider_slug'],
  ['campos extras', profile({ extra: true }), 'profile_unexpected_field::extra'],
  ['provider invalido', profile({ provider_slug: 'deepgram' }), 'provider_slug_not_allowed::deepgram'],
  ['versionamento invalido', profile({ capability_profile_version: 0 }), 'capability_profile_version_invalid'],
  ['validator invalido', profile({ validator_version: 'old' }), 'validator_version_invalid'],
  ['array vazio', profile({ supported_languages: [] }), 'supported_languages_required'],
  ['duplicidade', profile({ supported_audio_formats: ['synthetic_metadata_only', 'synthetic_metadata_only'] }), 'supported_audio_formats_duplicate'],
  ['array fora de ordem', profile({ supported_languages: ['pt-BR', 'en-US'] }), 'supported_languages_must_be_sorted'],
  ['rollout invalido', profile({ rollout_percentage: 1 }), 'rollout_percentage_must_be_0'],
  ['network enabled', profile({ network_enabled: true }), 'network_enabled_must_be_false'],
  ['provider enabled', profile({ provider_enabled: true }), 'provider_enabled_must_be_false'],
  ['runtime enabled', profile({ runtime_enabled: true }), 'runtime_enabled_must_be_false'],
  ['production disabled', profile({ production_blocked: false }), 'production_blocked_must_be_true'],
  ['execution mode invalido', profile({ execution_mode: 'EXECUTE' }), 'execution_mode_must_be_REVIEW_ONLY'],
  ['secret proibido', profile({ secret: 'never' }), 'profile_unexpected_field::secret']
].forEach(([name, candidate, reason]) => {
  test(`capability profile rejects ${name}`, () => {
    assertBlocks(validateCapabilityProfile(candidate).errors, reason);
  });
});

[
  ['NaN', { max_audio_size_mb: NaN }, 'payload_not_serializable::non_finite_number_not_serializable'],
  ['Infinity', { max_audio_duration_seconds: Infinity }, 'payload_not_serializable::non_finite_number_not_serializable'],
  ['function', { estimated_cost_profile: { compute() {} } }, 'payload_not_serializable::function_not_serializable'],
  ['symbol', { estimated_latency_profile: { marker: Symbol('x') } }, 'payload_not_serializable::symbol_not_serializable'],
  ['bigint', { estimated_cost_profile: { value: BigInt(1) } }, 'payload_not_serializable::bigint_not_serializable']
].forEach(([name, override, reason]) => {
  test(`capability profile rejects ${name}`, () => {
    assertBlocks(validateCapabilityProfile(profile(override)).errors, reason);
  });
});

test('capability profile rejects cyclic references', () => {
  const value = profile();
  value.estimated_cost_profile.self = value.estimated_cost_profile;
  assertBlocks(validateCapabilityProfile(value).errors, 'payload_not_serializable::cyclic_reference_not_serializable');
});

test('normalize capability profile returns immutable defensive clone', () => {
  const original = profile();
  const normalized = normalizeCapabilityProfile(original);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.estimated_cost_profile), true);
  assert.throws(() => {
    normalized.estimated_cost_profile.minor_units_per_minute = 1;
  }, TypeError);
  assert.equal(original.estimated_cost_profile.minor_units_per_minute, 0);
});

test('fingerprint is deterministic for key order and changes for nested differences', () => {
  const left = profile();
  const right = {};
  for (const key of Object.keys(left).reverse()) right[key] = left[key];
  assert.equal(fingerprintCapabilityProfile(left), fingerprintCapabilityProfile(right));
  assert.notEqual(fingerprintCapabilityProfile(left), fingerprintCapabilityProfile(profile({ estimated_latency_profile: { p50_ms: 101, p95_ms: 250 } })));
});

test('registry registers profile and returns defensive clone', () => {
  const registry = createTranscriptionProviderCapabilityRegistry();
  const registered = registry.registerCapabilityProfile(profile());
  assert.equal(registered.ok, true);
  assertSafe(registered);
  const stored = registry.getCapabilityProfile(profile().capability_profile_id);
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => {
    stored.supported_languages.push('es-ES');
  }, TypeError);
  assert.deepEqual(registry.getCapabilityProfileByProvider('mock-provider-a').supported_languages, ['en-US', 'pt-BR']);
});

test('registry blocks replay payload mismatch downgrade and optimistic conflict', () => {
  const registry = createTranscriptionProviderCapabilityRegistry();
  assert.equal(registry.registerCapabilityProfile(profile()).ok, true);
  assertBlocks(registry.registerCapabilityProfile(profile()).errors, 'capability_profile_replay_duplicate');
  assertBlocks(registry.registerCapabilityProfile(profile({ max_audio_size_mb: 60 })).errors, 'capability_profile_replay_payload_mismatch');
  assertBlocks(registry.registerCapabilityProfile(profile({ capability_profile_id: 'capability_profile_mock_provider_a_v0', capability_profile_version: 1 })).errors, 'capability_profile_version_downgrade');
  assertBlocks(createTranscriptionProviderCapabilityRegistry().registerCapabilityProfile(profile(), { expected_version: 2 }).errors, 'capability_profile_optimistic_version_conflict');
});

test('registry fingerprint failure does not store profile or history', () => {
  const registry = createTranscriptionProviderCapabilityRegistry();
  const invalid = profile({ capability_profile_id: 'cyclic_profile' });
  invalid.estimated_cost_profile.self = invalid.estimated_cost_profile;
  assertBlocks(registry.registerCapabilityProfile(invalid).errors, 'cyclic_reference');
  assert.equal(registry.getCapabilityProfile('cyclic_profile'), null);
  assert.deepEqual(registry.getHistory('mock-provider-a'), []);
});

test('catalog lists providers languages formats and capabilities from profiles only', () => {
  const catalog = createTranscriptionProviderCapabilityCatalog(fixture.profiles);
  assert.deepEqual(catalog.listProviders(), ['mock-provider-a', 'mock-provider-b', 'mock-provider-c']);
  assert.deepEqual(catalog.listLanguages(), ['en-US', 'es-ES', 'pt-BR']);
  assert.deepEqual(catalog.listFormats(), ['audio_placeholder_none', 'synthetic_metadata_only']);
  const capabilities = catalog.getCapabilities('mock-provider-a');
  assert.equal(capabilities.capabilities.supports_batch, true);
  assertSafe(capabilities);
  assert.equal(catalog.getProvider('missing'), null);
});

test('catalog rejects invalid profiles fail closed', () => {
  assert.throws(() => createTranscriptionProviderCapabilityCatalog([profile({ network_enabled: true })]), /invalid_capability_profile/);
});

test('comparator compares providers deterministically and immutably', () => {
  const comparison = compareTranscriptionProviderCapabilities(fixture.profiles[0], fixture.profiles[1]);
  assert.equal(comparison.comparable, true);
  assert.deepEqual(comparison.shared_languages, ['en-US', 'pt-BR']);
  assert.deepEqual(comparison.right_only_languages, ['es-ES']);
  assert.equal(comparison.feature_comparison.supports_streaming.left, false);
  assert.equal(comparison.feature_comparison.supports_streaming.right, true);
  assert.equal(Object.isFrozen(comparison), true);
  assert.equal(Object.isFrozen(comparison.feature_comparison), true);
  assertSafe(comparison);
});

test('comparator blocks invalid profile and does not mutate input', () => {
  const left = profile();
  const before = JSON.stringify(left);
  const comparison = compareTranscriptionProviderCapabilities(left, profile({ provider_slug: 'invalid' }));
  assert.equal(comparison.comparable, false);
  assertBlocks(comparison.errors, 'right::provider_slug_not_allowed::invalid');
  assert.equal(JSON.stringify(left), before);
});

test('fixture profiles are all valid and synthetic', () => {
  for (const item of fixture.profiles) {
    assert.equal(validateCapabilityProfile(item).valid, true);
    assertSafe(item);
  }
});

test('regression keeps capability matrix out of runtime message confirm surfaces', () => {
  const files = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js'),
    path.join(repoRoot, 'services', 'worker', 'src', 'index.js')
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-provider-capability-matrix'), false);
  }
});

test('regression capability matrix modules do not use network sdk env or filesystem', () => {
  const files = [
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-capability-matrix.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-capability-catalog.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-capability-comparator.js')
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|fs)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(/deepgram-sdk|@google-cloud\/speech|openai|assemblyai/i.test(source), false);
  }
  const fixtureSource = JSON.stringify(fixture);
  assert.equal(/https?:\/\//i.test(fixtureSource), false);
  assert.equal(/token|secret|api_key|endpoint|hostname/i.test(fixtureSource), false);
});
