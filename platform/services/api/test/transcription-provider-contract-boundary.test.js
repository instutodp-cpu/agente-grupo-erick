'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { deepClone, findTranscriptionForbiddenFields } = require('../src/core/transcription-contract');
const { validateProviderContract, normalizeProviderContract } = require('../src/core/transcription-provider-contract');
const { validateProviderCapability, validateProviderCapabilitiesSet } = require('../src/core/transcription-provider-capabilities');
const { validateTranscriptionProviderSecretReference, normalizeSecretReference } = require('../src/core/transcription-provider-secret-boundary');
const { validateTranscriptionProviderConfiguration } = require('../src/core/transcription-provider-configuration-boundary');
const { validateTranscriptionProviderRequest } = require('../src/core/transcription-provider-request-contract');
const { validateTranscriptionProviderResponse } = require('../src/core/transcription-provider-response-contract');
const { classifyTranscriptionProviderError, validateProviderError } = require('../src/core/transcription-provider-error-taxonomy');
const { evaluateTranscriptionProviderContractReadiness } = require('../src/core/transcription-provider-contract-readiness');
const { createTranscriptionProviderContractRegistry } = require('../src/core/transcription-provider-contract-registry');
const { createTranscriptionProviderMockParityAdapter } = require('../src/adapters/transcription/transcription-provider-mock-parity-adapter');

const repoRoot = path.resolve(__dirname, '../../..');
const fixturePath = path.join(__dirname, 'fixtures', 'hermes-transcription-provider-contract-boundary.json');
const docPath = path.join(repoRoot, 'docs', 'TRANSCRIPTION_PROVIDER_CONTRACT_BOUNDARY.md');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const now = '2026-07-19T00:00:00.000Z';
const expired = '2026-01-01T00:00:00.000Z';

function contract(slug = 'deepgram', overrides = {}) {
  return { ...deepClone(fixture.contracts[slug]), ...overrides };
}
function secret(overrides = {}) {
  return { ...deepClone(fixture.secretReference), ...overrides };
}
function config(overrides = {}) {
  return { ...deepClone(fixture.configuration), ...overrides };
}
function request(overrides = {}) {
  return { ...deepClone(fixture.request), ...overrides };
}
function response(overrides = {}) {
  return { ...deepClone(fixture.response), ...overrides };
}
function capabilities(providerSlug = 'deepgram', overrides = {}) {
  const required = ['batch', 'timestamps', 'confidence_scores', 'deletion_api', 'retention_control', 'rate_limit_documentation', 'pt_br'];
  const optional = ['streaming', 'word_timestamps', 'diarization', 'punctuation', 'language_detection', 'custom_vocabulary', 'redaction', 'speaker_labels', 'synchronous', 'asynchronous', 'audit_logs', 'budget_limits', 'pt_pt'];
  return [...required, ...optional].map((capability_id) => ({
    capability_id,
    provider_slug: providerSlug,
    support_status: 'supported_documentally',
    evidence_status: 'documented',
    contract_required: required.includes(capability_id),
    runtime_enabled: false,
    verified_for_execution: false,
    notes: 'Synthetic documentary capability.',
    simulated: true,
    ...(overrides[capability_id] || {})
  }));
}
function assertSafe(value) {
  assert.equal(value.simulated, true);
  if (Object.prototype.hasOwnProperty.call(value, 'executed')) assert.equal(value.executed, false);
  if (Object.prototype.hasOwnProperty.call(value, 'real_provider_called')) assert.equal(value.real_provider_called, false);
  if (Object.prototype.hasOwnProperty.call(value, 'external_network_called')) assert.equal(value.external_network_called, false);
  if (Object.prototype.hasOwnProperty.call(value, 'can_trigger_real_execution')) assert.equal(value.can_trigger_real_execution, false);
  if (Object.prototype.hasOwnProperty.call(value, 'production_blocked')) assert.equal(value.production_blocked, true);
  if (Object.prototype.hasOwnProperty.call(value, 'provider_runtime_enabled')) assert.equal(value.provider_runtime_enabled, false);
  if (Object.prototype.hasOwnProperty.call(value, 'provider_selected_for_execution')) assert.equal(value.provider_selected_for_execution, false);
}
function assertBlocks(errors, reason) {
  assert.ok(errors.includes(reason) || errors.some((error) => String(error).includes(reason)), `${reason} not found in ${errors.join(',')}`);
}

test('provider contract boundary docs and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
  assertSafe(fixture);
});

test('fixture contains no forbidden transcription fields or urls', () => {
  assert.equal(findTranscriptionForbiddenFields(fixture).length, 0);
  assert.equal(/https?:\/\//i.test(JSON.stringify(fixture)), false);
});

test('deepgram primary provider contract is valid', () => {
  const validation = validateProviderContract(contract('deepgram'));
  assert.equal(validation.valid, true);
});

test('google cloud speech fallback provider contract is valid', () => {
  const validation = validateProviderContract(contract('google_cloud_speech'));
  assert.equal(validation.valid, true);
});

[
  ['deepgram role mismatch', contract('deepgram', { provider_role: 'fallback_contract_candidate' }), 'deepgram_role_mismatch'],
  ['google role mismatch', contract('google_cloud_speech', { provider_role: 'primary_contract_candidate' }), 'google_cloud_speech_role_mismatch'],
  ['version invalid', contract('deepgram', { contract_version: 0 }), 'contract_version_invalid'],
  ['operation forbidden', contract('deepgram', { supported_operations: ['transcribe_real_audio'] }), 'supported_operation_not_allowed'],
  ['rollout invalid', contract('deepgram', { rollout_percentage: 1 }), 'rollout_percentage_must_be_zero'],
  ['production invalid', contract('deepgram', { environment: 'production' }), 'environment_not_allowed'],
  ['runtime enabled', contract('deepgram', { provider_runtime_enabled: true }), 'provider_runtime_enabled_must_be_false'],
  ['transport enabled', contract('deepgram', { transport_enabled: true }), 'transport_enabled_must_be_false'],
  ['secret resolved', contract('deepgram', { secret_resolved: true }), 'secret_resolved_must_be_false'],
  ['endpoint present', contract('deepgram', { endpoint: 'provider-runtime' }), 'forbidden_field::endpoint'],
  ['url present', contract('deepgram', { model_url: 'https://example.invalid/model' }), 'unexpected_url']
].forEach(([name, input, reason]) => {
  test(`provider contract blocks ${name}`, () => {
    assertBlocks(validateProviderContract(input).errors, reason);
  });
});

test('provider contract normalization returns immutable sanitized copy', () => {
  const normalized = normalizeProviderContract(contract('deepgram'));
  assert.equal(Object.isFrozen(normalized), true);
  assert.throws(() => {
    normalized.provider_slug = 'mutated';
  }, TypeError);
  assert.equal(normalized.provider_slug, 'deepgram');
});

test('capabilities required set is valid', () => {
  assert.equal(validateProviderCapabilitiesSet(capabilities()).valid, true);
});

[
  ['unknown capability blocks readiness', { pt_br: { support_status: 'unknown' } }, 'required_capability_not_supported::pt_br'],
  ['missing required capability blocks', null, 'required_capability_missing::pt_br'],
  ['runtime enabled blocks', { batch: { runtime_enabled: true } }, 'runtime_enabled_must_be_false'],
  ['verified execution blocks', { batch: { verified_for_execution: true } }, 'verified_for_execution_must_be_false'],
  ['incomplete evidence blocks', { batch: { evidence_status: 'incomplete' } }, 'required_capability_evidence_not_documented::batch']
].forEach(([name, override, reason]) => {
  test(`capabilities ${name}`, () => {
    const list = override === null ? capabilities().filter((item) => item.capability_id !== 'pt_br') : capabilities('deepgram', override);
    assertBlocks(validateProviderCapabilitiesSet(list, { provider_slug: 'deepgram' }).errors, reason);
  });
});

test('single capability validates structure', () => {
  assert.equal(validateProviderCapability(capabilities()[0]).valid, true);
});

[
  ['secret reference valid', secret(), null],
  ['secret_value blocked', secret({ secret_value: 'never' }), 'forbidden_field::secret_value'],
  ['api_key blocked', secret({ api_key: 'never' }), 'forbidden_field::api_key'],
  ['token blocked', secret({ token: 'never' }), 'forbidden_field::token'],
  ['private_key blocked', secret({ private_key: 'never' }), 'forbidden_field::private_key'],
  ['credentials blocked', secret({ credentials: {} }), 'forbidden_field::credentials'],
  ['authorization header blocked', secret({ authorization: 'Bearer never' }), 'forbidden_field::authorization'],
  ['expired blocked', secret({ expires_at: expired }), 'secret_reference_expired'],
  ['rotation absent blocked', secret({ rotation_required: false }), 'rotation_required_must_be_true'],
  ['production blocked', secret({ environment: 'production' }), 'environment_not_allowed']
].forEach(([name, input, reason]) => {
  test(`secret boundary ${name}`, () => {
    const validation = validateTranscriptionProviderSecretReference(input, { now });
    if (reason) assertBlocks(validation.errors, reason);
    else assert.equal(validation.valid, true);
  });
});

test('secret reference defensive clone is sanitized and immutable', () => {
  const normalized = normalizeSecretReference(secret());
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(normalized.secret_resolved, false);
});

[
  ['configuration valid', config(), null],
  ['provider mismatch', config({ provider_slug: 'google_cloud_speech' }), 'provider_slug_mismatch'],
  ['contract mismatch', config({ provider_contract_id: 'other_contract' }), 'provider_contract_id_mismatch'],
  ['timeout exceeded', config({ timeout_ms: 999999 }), 'timeout_ms_out_of_bounds'],
  ['retries above two', config({ max_retries: 3 }), 'max_retries_out_of_bounds'],
  ['concurrency above one', config({ concurrency_limit: 2 }), 'concurrency_limit_must_be_one'],
  ['url blocked', config({ model_reference: 'https://example.invalid/model' }), 'unexpected_url'],
  ['endpoint blocked', config({ endpoint: 'provider-runtime' }), 'forbidden_field::endpoint'],
  ['hostname blocked', config({ hostname: 'provider.internal' }), 'forbidden_field::hostname'],
  ['transport enabled', config({ transport_enabled: true }), 'transport_enabled_must_be_false'],
  ['allowlist premature', config({ network_policy_status: 'allowlist_not_configured' }), 'network_must_remain_blocked'],
  ['secret resolved', config({ secret_resolved: true }), 'secret_resolved_must_be_false'],
  ['rollout invalid', config({ rollout_percentage: 1 }), 'rollout_percentage_must_be_zero']
].forEach(([name, input, reason]) => {
  test(`configuration boundary ${name}`, () => {
    const validation = validateTranscriptionProviderConfiguration(input, { contract: contract('deepgram') });
    if (reason) assertBlocks(validation.errors, reason);
    else assert.equal(validation.valid, true);
  });
});

[
  ['request valid', request(), null],
  ['audio blocked', request({ audio: 'raw' }), 'forbidden_field::audio'],
  ['buffer blocked', request({ buffer: Buffer.from('x') }), 'forbidden_field::buffer'],
  ['bytes blocked', request({ bytes: 'raw' }), 'forbidden_field::bytes'],
  ['blob blocked', request({ blob: 'raw' }), 'forbidden_field::blob'],
  ['base64 blocked', request({ base64: 'A'.repeat(3000) }), 'forbidden_field::base64'],
  ['filepath blocked', request({ filepath: 'local.wav' }), 'forbidden_field::filepath'],
  ['stream blocked', request({ stream: 'raw' }), 'forbidden_field::stream'],
  ['upload blocked', request({ upload: true }), 'forbidden_field::upload'],
  ['url blocked', request({ source: 'https://example.invalid/audio' }), 'unexpected_url'],
  ['endpoint blocked', request({ endpoint: 'provider-runtime' }), 'forbidden_field::endpoint'],
  ['token blocked', request({ token: 'never' }), 'forbidden_field::token'],
  ['secret blocked', request({ secret: 'never' }), 'forbidden_field::secret'],
  ['raw transcript blocked', request({ raw_transcript: 'real text' }), 'forbidden_field::raw_transcript'],
  ['duration exceeded', request({ duration_ms: 9999999 }), 'duration_ms_out_of_bounds'],
  ['size exceeded', request({ size_bytes: 99999999 }), 'size_bytes_out_of_bounds'],
  ['tenant mismatch', request({ tenant_id: 'other_tenant' }), 'tenant_id_mismatch'],
  ['provider mismatch', request({ provider_slug: 'google_cloud_speech' }), 'provider_slug_mismatch'],
  ['idempotency missing', request({ idempotency_key: '' }), 'invalid_idempotency_key']
].forEach(([name, input, reason]) => {
  test(`provider request ${name}`, () => {
    const validation = validateTranscriptionProviderRequest(input, { contract: contract('deepgram'), configuration: config(), tenant_id: fixture.configuration.tenant_id, workspace_type: fixture.configuration.workspace_type });
    if (reason) assertBlocks(validation.errors, reason);
    else assert.equal(validation.valid, true);
  });
});

[
  ['response success synthetic', response(), null],
  ['timeout synthetic', response({ response_status: 'synthetic_timeout', normalized_status: 'timed_out' }), null],
  ['rate limit synthetic', response({ response_status: 'synthetic_rate_limited', normalized_status: 'rate_limited' }), null],
  ['rejection synthetic', response({ response_status: 'synthetic_rejected', normalized_status: 'rejected' }), null],
  ['raw provider response blocked', response({ raw_provider_response: {} }), 'forbidden_field::raw_provider_response'],
  ['headers blocked', response({ headers: {} }), 'forbidden_field::headers'],
  ['url blocked', response({ provider_url: 'https://example.invalid' }), 'forbidden_field::provider_url'],
  ['raw transcript blocked', response({ raw_transcript: 'real text' }), 'forbidden_field::raw_transcript'],
  ['secret blocked', response({ secret: 'never' }), 'forbidden_field::secret'],
  ['large text blocked', response({ synthetic_transcript_summary: 'x'.repeat(600) }), 'synthetic_transcript_summary_too_large'],
  ['mismatch blocked', response({ request_id: 'other_request' }), 'request_id_mismatch']
].forEach(([name, input, reason]) => {
  test(`provider response ${name}`, () => {
    const validation = validateTranscriptionProviderResponse(input, { request: request() });
    if (reason) assertBlocks(validation.errors, reason);
    else assert.equal(validation.valid, true);
  });
});

[
  'INVALID_REQUEST',
  'CONTRACT_MISMATCH',
  'CAPABILITY_UNAVAILABLE',
  'CONFIGURATION_INVALID',
  'SECRET_REFERENCE_UNAVAILABLE',
  'TRANSPORT_DISABLED',
  'NETWORK_BLOCKED',
  'TIMEOUT_SYNTHETIC',
  'RATE_LIMIT_SYNTHETIC',
  'PROVIDER_REJECTED_SYNTHETIC',
  'BUDGET_BLOCKED',
  'RETENTION_BLOCKED',
  'CONSENT_BLOCKED',
  'INTERNAL_SYNTHETIC_ERROR'
].forEach((category) => {
  test(`error taxonomy classifies ${category}`, () => {
    const classified = classifyTranscriptionProviderError({ category, provider_slug: 'deepgram', request_id: 'request_test' });
    assert.equal(classified.category, category);
    assert.equal(classified.real_provider_called, false);
  });
});

test('error taxonomy blocks unknown category and unsafe details', () => {
  assert.equal(classifyTranscriptionProviderError({ category: 'UNKNOWN', provider_slug: 'deepgram' }).category, 'INTERNAL_SYNTHETIC_ERROR');
  assertBlocks(validateProviderError({ ...classifyTranscriptionProviderError({ provider_slug: 'deepgram' }), stack: 'unsafe' }).errors, 'unsafe_error_detail_present');
  assertBlocks(validateProviderError({ ...classifyTranscriptionProviderError({ provider_slug: 'deepgram' }), secret: 'never' }).errors, 'forbidden_field::secret');
});

test('mock parity adapter metadata is safe', () => {
  assertSafe(createTranscriptionProviderMockParityAdapter({ contract: contract('deepgram'), configuration: config() }).metadata());
});

['success', 'timeout', 'rate_limit', 'rejection', 'capability_unavailable', 'budget_blocked'].forEach((scenario) => {
  test(`mock parity adapter deterministic ${scenario}`, () => {
    const adapter = createTranscriptionProviderMockParityAdapter({ contract: contract('deepgram'), configuration: config() });
    const before = JSON.stringify(request());
    const result = adapter.simulateRequest(request(), { scenario });
    assert.equal(result.status, 'mock_parity_simulation_completed');
    assert.equal(result.real_provider_called, false);
    assert.equal(result.external_network_called, false);
    assert.equal(JSON.stringify(request()), before);
    assert.equal(Object.isFrozen(result), true);
  });
});

test('mock parity adapter blocks invalid provider and invalid request', () => {
  const adapter = createTranscriptionProviderMockParityAdapter({ contract: contract('google_cloud_speech'), configuration: config() });
  assertBlocks(adapter.validateContract(contract('google_cloud_speech')).errors, 'mock_parity_provider_must_be_deepgram');
  assert.equal(adapter.simulateRequest(request({ audio: 'raw' })).status, 'mock_parity_simulation_blocked');
});

test('contract readiness reaches maximum transport contract review only synthetically', () => {
  const readiness = evaluateTranscriptionProviderContractReadiness({
    contract: contract('deepgram'),
    capabilities: capabilities(),
    secretReference: secret(),
    configuration: config(),
    mockParityTestsPassing: true,
    transport_enabled: false,
    network_blocked: true,
    runtime_enabled: false,
    rollout_percentage: 0,
    production_blocked: true
  }, { now });
  assert.equal(readiness.readiness_decision, 'READY_FOR_TRANSPORT_CONTRACT_REVIEW');
  assert.equal(readiness.ready_for_network, false);
  assert.equal(readiness.ready_for_execution, false);
});

['NOT_READY', 'INCOMPLETE', 'READY_FOR_MOCK_PARITY_REVIEW', 'READY_FOR_SECRET_REFERENCE_REVIEW', 'READY_FOR_TRANSPORT_CONTRACT_REVIEW'].forEach((decision) => {
  test(`readiness allowed decision listed ${decision}`, () => {
    assert.notEqual(['READY_FOR_NETWORK', 'READY_FOR_EXECUTION', 'READY_FOR_PRODUCTION'].includes(decision), true);
  });
});

test('contract readiness blocks missing requirements and never real execution', () => {
  const readiness = evaluateTranscriptionProviderContractReadiness({ contract: contract('deepgram'), capabilities: [], secretReference: secret({ secret_resolved: true }), configuration: config({ transport_enabled: true }) }, { now });
  assert.notEqual(readiness.readiness_decision, 'READY_FOR_TRANSPORT_CONTRACT_REVIEW');
  assert.equal(readiness.ready_for_real_provider, false);
  assertBlocks(readiness.blocking_requirements, 'capabilities_required');
});

test('registry registers and returns defensive clones', () => {
  const registry = createTranscriptionProviderContractRegistry();
  assert.equal(registry.registerContract(contract('deepgram')).ok, true);
  const stored = registry.getContract(contract('deepgram').provider_contract_id);
  stored.provider_slug = 'mutated';
  assert.equal(registry.getContract(contract('deepgram').provider_contract_id).provider_slug, 'deepgram');
});

test('registry blocks duplicate payload mismatch and version downgrade', () => {
  const registry = createTranscriptionProviderContractRegistry();
  const first = contract('deepgram');
  assert.equal(registry.registerContract(first).ok, true);
  assertBlocks(registry.registerContract(first).errors, 'contract_replay_duplicate');
  assertBlocks(registry.registerContract({ ...first, deployment_model: 'changed' }).errors, 'contract_replay_payload_mismatch');
  assertBlocks(registry.registerContract({ ...contract('deepgram'), provider_contract_id: 'contract_new', contract_version: 1 }).errors, 'contract_version_downgrade');
});

test('registry stores capabilities configuration secret and readiness records', () => {
  const registry = createTranscriptionProviderContractRegistry();
  assert.equal(registry.registerCapabilities('deepgram', capabilities()).ok, true);
  assert.equal(registry.getCapabilities('deepgram').length > 0, true);
  assert.equal(registry.registerConfiguration(config()).ok, true);
  assert.equal(registry.registerSecretReference(secret()).ok, true);
  assert.equal(registry.registerReadinessEvaluation({ readiness_evaluation_id: 'readiness_contract_v1', readiness_evaluation_version: 1, provider_slug: 'deepgram', simulated: true }).ok, true);
});

test('regression keeps provider contract modules out of runtime message confirm endpoint scheduler worker surfaces', () => {
  const runtimeFiles = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js'),
    path.join(repoRoot, 'services', 'worker', 'src', 'index.js')
  ];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-provider-contract'), false);
    assert.equal(source.includes('transcription-provider-mock-parity'), false);
  }
});

test('regression new modules do not use provider SDKs network env filesystem or runtime registration', () => {
  const files = [
    'transcription-provider-contract.js',
    'transcription-provider-capabilities.js',
    'transcription-provider-secret-boundary.js',
    'transcription-provider-configuration-boundary.js',
    'transcription-provider-request-contract.js',
    'transcription-provider-response-contract.js',
    'transcription-provider-error-taxonomy.js',
    'transcription-provider-contract-readiness.js',
    'transcription-provider-contract-registry.js'
  ].map((file) => path.join(repoRoot, 'services', 'api', 'src', 'core', file));
  files.push(path.join(repoRoot, 'services', 'api', 'src', 'adapters', 'transcription', 'transcription-provider-mock-parity-adapter.js'));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|fs)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(/deepgram-sdk|@google-cloud\/speech/i.test(source), false);
  }
});
