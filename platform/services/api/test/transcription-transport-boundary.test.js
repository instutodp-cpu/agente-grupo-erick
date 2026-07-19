'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { deepClone, findTranscriptionForbiddenFields } = require('../src/core/transcription-contract');
const {
  TRANSPORT_REVIEW_PHASES,
  buildTranscriptionTransportMockResult,
  normalizeTranscriptionTransportContract,
  signTransportMockResult,
  validateTranscriptionTransportMockResult,
  validateTranscriptionTransportContract
} = require('../src/core/transcription-transport-contract');
const {
  TRANSPORT_BLOCKED_ACTIONS,
  evaluateTranscriptionTransportPolicyAttempt,
  validateTranscriptionTransportPolicy
} = require('../src/core/transcription-transport-policy');
const { validateTranscriptionTransportBoundary } = require('../src/core/transcription-transport-validator');
const { evaluateTranscriptionTransportReadiness } = require('../src/core/transcription-transport-readiness');
const { transitionTranscriptionTransportLifecycle } = require('../src/core/transcription-transport-lifecycle');
const { buildTranscriptionTransportMetadata } = require('../src/core/transcription-transport-metadata');
const { createTranscriptionTransportRegistry } = require('../src/core/transcription-transport-registry');
const { createTranscriptionTransportMock } = require('../src/adapters/transcription/transcription-transport-mock');

const repoRoot = path.resolve(__dirname, '../../..');
const fixturePath = path.join(__dirname, 'fixtures', 'hermes-transcription-transport-boundary.json');
const docPath = path.join(repoRoot, 'docs', 'TRANSCRIPTION_TRANSPORT_BOUNDARY.md');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function transport(overrides = {}) {
  return { ...deepClone(fixture), ...overrides };
}

function assertSafe(value) {
  assert.equal(value.simulated, true);
  assert.equal(value.executed, false);
  assert.equal(value.real_provider_called, false);
  assert.equal(value.external_network_called, false);
  assert.equal(value.can_trigger_real_execution, false);
  assert.equal(value.rollout_percentage, 0);
  assert.equal(value.production_blocked, true);
  assert.equal(value.provider_runtime_enabled, false);
  assert.equal(value.provider_selected_for_execution, false);
  assert.equal(value.transport_enabled, false);
  assert.equal(value.secret_resolved, false);
}

function assertBlocks(errors, reason) {
  assert.ok(errors.includes(reason) || errors.some((error) => String(error).includes(reason)), `${reason} not found in ${errors.join(',')}`);
}

test('transport boundary docs and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('transport fixture is synthetic blocked and has no forbidden fields', () => {
  assert.equal(findTranscriptionForbiddenFields(fixture).length, 0);
  assert.equal(fixture.transport_state, 'BLOCKED');
  assert.equal(fixture.rollout_percentage, 0);
  assert.equal(fixture.production_blocked, true);
});

test('transport contract accepts blocked future transport contract', () => {
  const validation = validateTranscriptionTransportContract(transport());
  assert.equal(validation.valid, true);
});

[
  ['missing field', (() => { const value = transport(); delete value.transport_contract_id; return value; })(), 'missing_transport_contract_id'],
  ['invalid version', transport({ transport_version: 0 }), 'transport_version_invalid'],
  ['unknown provider', transport({ provider_slug: 'unknown_provider' }), 'provider_slug_not_allowed::unknown_provider'],
  ['invalid type', transport({ transport_type: 'smtp_future' }), 'transport_type_not_allowed::smtp_future'],
  ['not blocked state', transport({ transport_state: 'mocked' }), 'transport_state_not_allowed::mocked'],
  ['invalid review phase', transport({ review_phase: 'execution_review' }), 'review_phase_not_allowed::execution_review'],
  ['production', transport({ environment: 'production' }), 'environment_not_allowed'],
  ['rollout invalid', transport({ rollout_percentage: 1 }), 'rollout_percentage_must_be_0'],
  ['provider enabled', transport({ provider_enabled: true }), 'provider_enabled_must_be_false'],
  ['runtime enabled', transport({ runtime_enabled: true }), 'runtime_enabled_must_be_false'],
  ['network enabled', transport({ network_enabled: true }), 'network_enabled_must_be_false'],
  ['secret resolved', transport({ secret_resolved: true }), 'secret_resolved_must_be_false'],
  ['provider runtime enabled', transport({ provider_runtime_enabled: true }), 'provider_runtime_enabled_must_be_false'],
  ['provider selected', transport({ provider_selected_for_execution: true }), 'provider_selected_for_execution_must_be_false'],
  ['transport enabled', transport({ transport_enabled: true }), 'transport_enabled_must_be_false'],
  ['endpoint present', transport({ endpoint: 'provider-runtime' }), 'forbidden_field::endpoint'],
  ['hostname present', transport({ hostname: 'provider.internal' }), 'forbidden_field::hostname'],
  ['url present', transport({ provider_url: 'https://example.invalid' }), 'forbidden_field::provider_url']
].forEach(([name, input, reason]) => {
  test(`transport contract blocks ${name}`, () => {
    assertBlocks(validateTranscriptionTransportContract(input).errors, reason);
  });
});

test('transport contract normalization is immutable and does not mutate input', () => {
  const input = transport();
  const before = deepClone(input);
  const normalized = normalizeTranscriptionTransportContract(input);
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.transport_policy), true);
  assert.throws(() => {
    normalized.transport_policy.network = true;
  }, TypeError);
});

test('transport policy validates all blocked actions', () => {
  assert.equal(validateTranscriptionTransportPolicy(fixture.transport_policy).valid, true);
});

TRANSPORT_BLOCKED_ACTIONS.forEach((action) => {
  test(`transport policy blocks ${action}`, () => {
    const result = evaluateTranscriptionTransportPolicyAttempt(action, fixture.transport_policy);
    assert.equal(result.allowed, false);
    assertBlocks(result.blockers, `transport_action_blocked::${action}`);
    assertSafe(result);
  });
});

[
  ['missing socket block', { open_socket_blocked: false }, 'open_socket_blocked_must_be_true'],
  ['retry real', { retry_real: true }, 'retry_real_must_be_absent_or_false'],
  ['network true', { network: true }, 'network_must_be_false'],
  ['connected true', { connected: true }, 'connected_must_be_false']
].forEach(([name, override, reason]) => {
  test(`transport policy blocks ${name}`, () => {
    assertBlocks(validateTranscriptionTransportPolicy({ ...fixture.transport_policy, ...override }).errors, reason);
  });
});

test('transport validator accepts only review-only safe boundary', () => {
  const validation = validateTranscriptionTransportBoundary(transport(), {
    rollout_percentage: 0,
    runtime_enabled: false,
    provider_enabled: false,
    transport_blocked: true,
    secret_resolved: false,
    production_blocked: true,
    network_enabled: false
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.allowed, false);
  assert.equal(validation.decision, 'TRANSPORT_REVIEW_ONLY');
});

[
  ['context rollout invalid', { rollout_percentage: 1 }, 'context_rollout_percentage_must_be_zero'],
  ['context runtime enabled', { runtime_enabled: true }, 'context_runtime_enabled_must_be_false'],
  ['context provider enabled', { provider_enabled: true }, 'context_provider_enabled_must_be_false'],
  ['context network enabled', { network_enabled: true }, 'context_network_enabled_must_be_false'],
  ['context secret resolved', { secret_resolved: true }, 'context_secret_resolved_must_be_false'],
  ['context production not blocked', { production_blocked: false }, 'context_production_blocked_must_be_true'],
  ['context transport not blocked', { transport_blocked: false }, 'context_transport_blocked_must_be_true']
].forEach(([name, context, reason]) => {
  test(`transport validator blocks ${name}`, () => {
    assertBlocks(validateTranscriptionTransportBoundary(transport(), context).errors, reason);
  });
});

test('transport metadata is review-only and safe', () => {
  const metadata = buildTranscriptionTransportMetadata();
  assert.equal(metadata.transport_simulated, true);
  assert.equal(metadata.network, false);
  assert.equal(metadata.connected, false);
  assertSafe(metadata);
});

test('transport mock metadata validate connect disconnect and health never connect', () => {
  const mock = createTranscriptionTransportMock({ contract: transport() });
  assert.equal(mock.metadata().network, false);
  assert.equal(mock.validate().valid, true);
  const connected = mock.simulateConnect();
  assert.equal(connected.transport_simulated, true);
  assert.equal(connected.network, false);
  assert.equal(connected.connected, false);
  assert.equal(connected.status, 'transport_mock_connect_simulated');
  assert.equal(validateTranscriptionTransportMockResult(connected.mock_result, transport()).valid, true);
  assert.equal(mock.simulateDisconnect().connected, false);
  assert.equal(mock.health().status, 'transport_mock_healthy');
  assertSafe(connected);
});

test('transport mock blocks invalid contract and preserves no connection', () => {
  const mock = createTranscriptionTransportMock({ contract: transport({ runtime_enabled: true }) });
  const result = mock.simulateConnect();
  assert.equal(result.status, 'transport_mock_connect_blocked');
  assert.equal(result.connected, false);
  assertBlocks(result.blockers, 'runtime_enabled_must_be_false');
  assertSafe(result);
});

test('transport mock does not mutate input and returns immutable output', () => {
  const input = transport();
  const before = deepClone(input);
  const mock = createTranscriptionTransportMock({ contract: input });
  const result = mock.simulateConnect();
  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
});

test('transport readiness never releases network provider or production', () => {
  const mock = createTranscriptionTransportMock({ contract: transport() });
  const connect = mock.simulateConnect();
  const readiness = evaluateTranscriptionTransportReadiness({
    contract: transport(),
    mock: connect.mock_result,
    lifecycle_state: 'BLOCKED'
  }, { now: '2026-07-19T00:00:00.000Z' });
  assert.equal(readiness.readiness_decision, 'READY_FOR_PROVIDER_ADAPTER_REVIEW');
  assert.equal(readiness.ready_for_network, false);
  assert.equal(readiness.ready_for_provider, false);
  assert.equal(readiness.ready_for_production, false);
  assertSafe(readiness);
});

test('transport readiness blocks missing mock and unblocked lifecycle', () => {
  const readiness = evaluateTranscriptionTransportReadiness({ contract: transport(), lifecycle_state: 'mocked' });
  assert.equal(readiness.readiness_decision, 'READY_FOR_TRANSPORT_REVIEW');
  assertBlocks(readiness.blocking_requirements, 'transport_mock::transport_mock_result_must_be_object');
  assertBlocks(readiness.blocking_requirements, 'transport_lifecycle_must_be_blocked');
});

test('transport readiness rejects forged incomplete and tampered mock results', () => {
  const official = buildTranscriptionTransportMockResult(transport());
  assert.equal(validateTranscriptionTransportMockResult(official, transport()).valid, true);
  assertBlocks(validateTranscriptionTransportMockResult({ transport_simulated: true, network: false, connected: false }, transport()).errors, 'missing_transport_contract_id');
  assertBlocks(validateTranscriptionTransportMockResult({ ...official, extra: 'field' }, transport()).errors, 'unexpected_mock_result_field::extra');
  assertBlocks(validateTranscriptionTransportMockResult({ ...official, transport_signature: 'bad_signature' }, transport()).errors, 'transport_signature_invalid');
  assertBlocks(validateTranscriptionTransportMockResult({ ...official, validator_version: 'old_validator' }, transport()).errors, 'validator_version_invalid');
  assertBlocks(validateTranscriptionTransportMockResult({ ...official, contract_version: 'old_contract' }, transport()).errors, 'contract_version_invalid');
  assertBlocks(validateTranscriptionTransportMockResult({ ...official, provider_slug: 'google_cloud_speech' }, transport()).errors, 'provider_slug_mismatch');
  assertBlocks(validateTranscriptionTransportMockResult({ ...official, transport_state: 'mocked' }, transport()).errors, 'transport_state_must_be_BLOCKED');
  assertBlocks(validateTranscriptionTransportMockResult({ ...official, provider_state: 'provider_enabled' }, transport()).errors, 'provider_state_not_allowed::provider_enabled');
  const missing = { ...official };
  delete missing.generated_by;
  assertBlocks(validateTranscriptionTransportMockResult(missing, transport()).errors, 'missing_generated_by');
});

test('transport readiness rejects forged mock before review approval', () => {
  const forged = {
    transport_contract_id: fixture.transport_contract_id,
    provider_slug: 'deepgram',
    contract_version: fixture.contract_version,
    transport_version: 1,
    mock_version: 'transcription_transport_mock_v1',
    validator_version: fixture.validator_version,
    transport_state: 'BLOCKED',
    provider_state: 'provider_disabled',
    readiness_context: {},
    safety_flags: { simulated: true },
    transport_signature: 'bad',
    generated_by: 'manual_object',
    generated_at: '2026-07-19T00:00:00.000Z',
    validation_status: 'VALID',
    simulated: true,
    executed: false,
    external_network_called: false,
    production_blocked: true
  };
  const readiness = evaluateTranscriptionTransportReadiness({ contract: transport(), mock: forged, lifecycle_state: 'BLOCKED' });
  assert.notEqual(readiness.readiness_decision, 'READY_FOR_PROVIDER_ADAPTER_REVIEW');
  assertBlocks(readiness.blocking_requirements, 'transport_mock::transport_signature_invalid');
});

test('transport lifecycle keeps transport state BLOCKED through review phases', () => {
  const first = transitionTranscriptionTransportLifecycle(transport(), { transition_id: 'tr1', provider_slug: 'deepgram', transport_contract_id: fixture.transport_contract_id, contract_version: fixture.contract_version, validator_version: fixture.validator_version, expected_version: 1, current_version: 1, from_state: 'BLOCKED', to_state: 'BLOCKED', review_phase: 'mock_review', safety_flags: transport() });
  assert.equal(first.ok, true);
  assert.equal(first.from_state, 'BLOCKED');
  assert.equal(first.to_state, 'BLOCKED');
  assert.equal(first.transport_state, 'BLOCKED');
  const blocked = transitionTranscriptionTransportLifecycle(transport({ review_phase: 'validation_review' }), { transition_id: 'tr2', provider_slug: 'deepgram', transport_contract_id: fixture.transport_contract_id, contract_version: fixture.contract_version, validator_version: fixture.validator_version, expected_version: 1, current_version: 1, from_state: 'BLOCKED', to_state: 'mocked', review_phase: 'mock_review', safety_flags: transport() });
  assert.equal(blocked.ok, false);
  assertBlocks(blocked.errors, 'to_state_must_be_BLOCKED');
});

test('transport lifecycle blocks optimistic version conflict and missing transition id', () => {
  assertBlocks(transitionTranscriptionTransportLifecycle(transport(), { transition_id: 'tr1', provider_slug: 'deepgram', transport_contract_id: fixture.transport_contract_id, contract_version: fixture.contract_version, validator_version: fixture.validator_version, expected_version: 2, current_version: 1, from_state: 'BLOCKED', to_state: 'BLOCKED', review_phase: 'mock_review', safety_flags: transport() }).errors, 'transport_version_conflict');
  assertBlocks(transitionTranscriptionTransportLifecycle(transport(), { provider_slug: 'deepgram', transport_contract_id: fixture.transport_contract_id, contract_version: fixture.contract_version, validator_version: fixture.validator_version, expected_version: 1, current_version: 1, from_state: 'BLOCKED', to_state: 'BLOCKED', review_phase: 'mock_review', safety_flags: transport() }).errors, 'transition_id_required');
});

test('transport lifecycle validates every allowed review phase without changing transport state', () => {
  assert.deepEqual(TRANSPORT_REVIEW_PHASES, ['draft_review', 'mock_review', 'contract_review', 'validation_review']);
  const mockReview = transitionTranscriptionTransportLifecycle(transport({ review_phase: 'draft_review' }), { transition_id: 'phase_1', provider_slug: 'deepgram', transport_contract_id: fixture.transport_contract_id, contract_version: fixture.contract_version, validator_version: fixture.validator_version, expected_version: 1, current_version: 1, from_state: 'BLOCKED', to_state: 'BLOCKED', review_phase: 'mock_review', safety_flags: transport() });
  const contractReview = transitionTranscriptionTransportLifecycle(transport({ review_phase: 'mock_review' }), { transition_id: 'phase_2', provider_slug: 'deepgram', transport_contract_id: fixture.transport_contract_id, contract_version: fixture.contract_version, validator_version: fixture.validator_version, expected_version: 1, current_version: 1, from_state: 'BLOCKED', to_state: 'BLOCKED', review_phase: 'contract_review', safety_flags: transport() });
  const validationReview = transitionTranscriptionTransportLifecycle(transport({ review_phase: 'contract_review' }), { transition_id: 'phase_3', provider_slug: 'deepgram', transport_contract_id: fixture.transport_contract_id, contract_version: fixture.contract_version, validator_version: fixture.validator_version, expected_version: 1, current_version: 1, from_state: 'BLOCKED', to_state: 'BLOCKED', review_phase: 'validation_review', safety_flags: transport() });
  for (const result of [mockReview, contractReview, validationReview]) {
    assert.equal(result.ok, true);
    assert.equal(result.transport_state, 'BLOCKED');
  }
});

test('transport registry stores immutable defensive clones', () => {
  const registry = createTranscriptionTransportRegistry();
  assert.equal(registry.registerTransportContract(transport()).ok, true);
  const stored = registry.getTransportContract(fixture.transport_contract_id);
  assert.equal(Object.isFrozen(stored), true);
  assert.equal(Object.isFrozen(stored.transport_policy), true);
  assert.throws(() => {
    stored.transport_policy.network = true;
  }, TypeError);
  assert.equal(registry.getTransportContract(fixture.transport_contract_id).transport_policy.network, false);
});

test('transport registry blocks replay duplicate payload mismatch and version downgrade', () => {
  const registry = createTranscriptionTransportRegistry();
  assert.equal(registry.registerTransportContract(transport()).ok, true);
  assertBlocks(registry.registerTransportContract(transport()).errors, 'transport_replay_duplicate');
  assertBlocks(registry.registerTransportContract(transport({ provider_slug: 'google_cloud_speech' })).errors, 'transport_replay_payload_mismatch');
  assertBlocks(registry.registerTransportContract(transport({ transport_contract_id: 'transport_new', transport_version: 1 })).errors, 'transport_version_downgrade');
});

test('transport registry blocks invalid fingerprint without storing or history', () => {
  const registry = createTranscriptionTransportRegistry();
  const cyclic = transport({ transport_contract_id: 'cyclic_transport' });
  cyclic.transport_policy.self = cyclic.transport_policy;
  assertBlocks(registry.registerTransportContract(cyclic).errors, 'forbidden_field::cyclic_reference');
  assert.equal(registry.getTransportContract('cyclic_transport'), null);
  assert.deepEqual(registry.getTransportHistory('deepgram'), []);
});

test('transport registry records transition replay protection', () => {
  const registry = createTranscriptionTransportRegistry();
  assert.equal(registry.registerTransportContract(transport()).ok, true);
  const transition = { transition_id: 'transition_1', provider_slug: 'deepgram', transport_contract_id: fixture.transport_contract_id, contract_version: fixture.contract_version, validator_version: fixture.validator_version, expected_version: 1, current_version: 1, from_state: 'BLOCKED', to_state: 'BLOCKED', review_phase: 'mock_review', safety_flags: transport() };
  assert.equal(registry.recordTransition(transition).ok, true);
  assertBlocks(registry.recordTransition(transition).errors, 'transport_transition_replay');
  assert.equal(registry.getTransitionHistory('deepgram').length, 1);
});

[
  ['provider different', { provider_slug: 'google_cloud_speech' }, 'provider_slug_mismatch'],
  ['contract different', { transport_contract_id: 'other_contract' }, 'transport_contract_not_found'],
  ['lifecycle invalid', { review_phase: 'validation_review' }, 'review_phase_transition_not_allowed::draft_review->validation_review'],
  ['expected version incorrect', { expected_version: 2 }, 'transport_version_conflict'],
  ['current version incorrect', { current_version: 2 }, 'current_version_mismatch'],
  ['validator version incorrect', { validator_version: 'old_validator' }, 'validator_version_invalid'],
  ['safety flags invalid', { safety_flags: transport({ transport_enabled: true }) }, 'transition_transport_enabled_must_be_false']
].forEach(([name, override, reason]) => {
  test(`transport registry rejects invalid transition ${name} without writing`, () => {
    const registry = createTranscriptionTransportRegistry();
    assert.equal(registry.registerTransportContract(transport()).ok, true);
    const transition = { transition_id: `transition_${name.replaceAll(' ', '_')}`, provider_slug: 'deepgram', transport_contract_id: fixture.transport_contract_id, contract_version: fixture.contract_version, validator_version: fixture.validator_version, expected_version: 1, current_version: 1, from_state: 'BLOCKED', to_state: 'BLOCKED', review_phase: 'mock_review', safety_flags: transport(), ...override };
    assertBlocks(registry.recordTransition(transition).errors, reason);
    assert.equal(registry.getTransitionHistory('deepgram').length, 0);
  });
});

test('regression keeps transport boundary out of runtime message confirm endpoint scheduler worker surfaces', () => {
  const runtimeFiles = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js'),
    path.join(repoRoot, 'services', 'worker', 'src', 'index.js')
  ];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-transport'), false);
  }
});

test('regression transport modules do not use network sdk env filesystem or runtime registration', () => {
  const files = [
    'transcription-transport-contract.js',
    'transcription-transport-policy.js',
    'transcription-transport-validator.js',
    'transcription-transport-readiness.js',
    'transcription-transport-lifecycle.js',
    'transcription-transport-metadata.js',
    'transcription-transport-registry.js'
  ].map((file) => path.join(repoRoot, 'services', 'api', 'src', 'core', file));
  files.push(path.join(repoRoot, 'services', 'api', 'src', 'adapters', 'transcription', 'transcription-transport-mock.js'));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|fs)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(/deepgram-sdk|@google-cloud\/speech/i.test(source), false);
  }
});
