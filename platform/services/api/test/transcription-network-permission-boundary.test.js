'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-transcription-network-permission-boundary.json');
const capabilityFixture = require('./fixtures/hermes-transcription-provider-capability-matrix.json');
const {
  TRANSCRIPTION_NETWORK_PERMISSION_BOUNDARY_VALIDATOR_VERSION,
  createTranscriptionNetworkDestinationRegistry,
  evaluateNetworkPermission,
  findNetworkOperationalMaterial,
  validateDestinationReference,
  validateNetworkPermissionRequest,
  validateSecretResolutionContext
} = require('../src/core/transcription-network-permission-boundary');
const {
  TRANSCRIPTION_NETWORK_ACCESS_POLICY_VERSION,
  evaluateNetworkAccessPolicy,
  validatePolicyContext
} = require('../src/core/transcription-network-access-policy');
const { validateNetworkPermissionAudit } = require('../src/core/transcription-network-permission-audit');
const { validateNetworkPermissionResult } = require('../src/core/transcription-network-permission-result');
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

function destination(overrides = {}) {
  return { ...clone(fixture.destinations[0]), ...overrides };
}

function policyContext(overrides = {}) {
  return {
    actor_type: 'USER',
    actor_id: 'actor_network_reviewer',
    actor_role: 'NETWORK_REVIEWER',
    tenant_id: 'tenant_network',
    approval_state: 'APPROVED_SIMULATION',
    change_ticket_id: 'change_network_review_1',
    security_review_state: 'APPROVED_SIMULATION',
    privacy_review_state: 'APPROVED_SIMULATION',
    data_processing_review_state: 'APPROVED_SIMULATION',
    policy_version: TRANSCRIPTION_NETWORK_ACCESS_POLICY_VERSION,
    ...overrides
  };
}

function secretContext(overrides = {}) {
  return {
    secret_resolution_status: 'REFERENCE_VALID_SIMULATION',
    secret_reference_fingerprint: 'synthetic_secret_reference_fingerprint',
    secret_material_present: false,
    secret_material_returned: false,
    secret_loaded: false,
    secret_resolved: false,
    simulation: true,
    production_blocked: true,
    ...overrides
  };
}

function simulationContext(overrides = {}) {
  return {
    network_allowed: false,
    dns_attempted: false,
    socket_created: false,
    connection_opened: false,
    tls_attempted: false,
    request_sent: false,
    stream_opened: false,
    response_received: false,
    network_used: false,
    provider_called: false,
    executed: false,
    simulation: true,
    production_blocked: true,
    runtime_enabled: false,
    rollout_percentage: 0,
    ...overrides
  };
}

function networkRequest(overrides = {}) {
  const base = {
    network_request_id: 'network_request_1',
    network_request_version: 1,
    tenant_id: 'tenant_network',
    conversation_id: 'conversation_network',
    provider_slug: 'mock-provider-a',
    adapter_id: 'adapter_network_boundary',
    transport_id: 'mock_transport_a',
    destination_reference: destination(),
    operation: 'TRANSCRIPTION_BATCH_REQUEST',
    protocol: 'HTTPS_REFERENCE',
    data_classification: 'INTERNAL_METADATA',
    requested_scope: 'TRANSCRIPTION_PROVIDER',
    requested_purpose: 'validate_provider_network_boundary',
    secret_resolution_context: secretContext(),
    policy_context: policyContext(),
    simulation_context: simulationContext(),
    metadata: {
      adapter_id: 'adapter_network_boundary',
      reason: 'synthetic_network_review',
      evaluated_at: '2026-07-21T00:00:00.000Z'
    },
    validator_version: TRANSCRIPTION_NETWORK_PERMISSION_BOUNDARY_VALIDATOR_VERSION
  };
  return { ...base, ...overrides };
}

function assertSafe(value) {
  assert.equal(value.network_allowed, false);
  assert.equal(value.dns_attempted, false);
  assert.equal(value.socket_created, false);
  assert.equal(value.connection_opened, false);
  assert.equal(value.tls_attempted, false);
  assert.equal(value.request_sent, false);
  assert.equal(value.stream_opened, false);
  assert.equal(value.response_received, false);
  assert.equal(value.network_used, false);
  assert.equal(value.provider_called, false);
  assert.equal(value.executed, false);
  assert.equal(value.simulation, true);
  assert.equal(value.production_blocked, true);
  assert.equal(value.runtime_enabled, false);
  assert.equal(value.rollout_percentage, 0);
}

test('network boundary docs and fixture exist without operational addresses', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'TRANSCRIPTION_NETWORK_PERMISSION_BOUNDARY.md')), true);
  assert.equal(fixture.simulation, true);
  assert.deepEqual(findNetworkOperationalMaterial(fixture), []);
});

test('destination reference and network request valid', () => {
  assert.equal(validateDestinationReference(destination()).valid, true);
  assert.equal(validateNetworkPermissionRequest(networkRequest()).valid, true);
});

test('network request blocks missing fields extras and invalid versions', () => {
  const missing = networkRequest();
  delete missing.tenant_id;
  assert.ok(validateNetworkPermissionRequest(missing).errors.includes('network_request_missing_tenant_id'));
  assert.ok(validateNetworkPermissionRequest(networkRequest({ extra: true })).errors.includes('network_request_unexpected_field::extra'));
  assert.ok(validateNetworkPermissionRequest(networkRequest({ network_request_version: 0 })).errors.includes('network_request_version_invalid'));
});

[
  ['URL em campo', { callback_url: 'blocked' }, 'forbidden_network_field'],
  ['URL em valor', { metadata: { marker: 'https://blocked.invalid' } }, 'operational_url_value'],
  ['hostname', { metadata: { hostname: 'blocked' } }, 'forbidden_network_field'],
  ['dominio', { metadata: { marker: 'example.com' } }, 'domain_value'],
  ['IPv4', { metadata: { marker: '192.168.0.1' } }, 'ipv4_value'],
  ['IPv6', { metadata: { marker: '2001:db8::2' } }, 'ipv6_value'],
  ['localhost', { metadata: { marker: 'localhost' } }, 'local_address_value'],
  ['porta', { metadata: { port: 443 } }, 'forbidden_network_field'],
  ['host:porta', { metadata: { marker: 'provider.local:443' } }, 'host_port_value'],
  ['websocket URL', { metadata: { marker: 'wss://blocked.invalid/socket' } }, 'operational_url_value'],
  ['connection string', { metadata: { marker: 'postgres://user@db.local/app' } }, 'connection_string_value']
].forEach(([name, overrides, reason]) => {
  test(`network detector blocks ${name}`, () => {
    const errors = validateNetworkPermissionRequest(networkRequest(overrides)).errors;
    assert.ok(errors.some((error) => error.includes(reason)), errors.join(','));
  });
});

test('network boundary blocks provider adapter transport tenant scope and protocol mismatch', () => {
  assert.equal(evaluateNetworkPermission(networkRequest({ provider_slug: 'mock-provider-b' })).result.status, 'PROVIDER_MISMATCH');
  assert.equal(evaluateNetworkPermission(networkRequest({ metadata: { adapter_id: 'other_adapter' } })).result.status, 'ADAPTER_MISMATCH');
  assert.equal(evaluateNetworkPermission(networkRequest({ transport_id: 'other_transport' })).result.status, 'TRANSPORT_MISMATCH');
  assert.equal(evaluateNetworkPermission(networkRequest({ policy_context: policyContext({ tenant_id: 'tenant_other' }) })).result.status, 'TENANT_MISMATCH');
  assert.equal(evaluateNetworkPermission(networkRequest({ requested_scope: 'TRANSPORT' })).result.status, 'SCOPE_MISMATCH');
  assert.equal(evaluateNetworkPermission(networkRequest({ protocol: 'HTTP_REFERENCE' })).result.status, 'PROTOCOL_MISMATCH');
});

test('destination reference blocks active approved flags and unsafe state', () => {
  assert.ok(validateDestinationReference(destination({ active: true })).errors.includes('active_must_be_false'));
  assert.ok(validateDestinationReference(destination({ approved: true })).errors.includes('approved_must_be_false'));
  assert.ok(validateDestinationReference(destination({ endpoint_present: true })).errors.includes('endpoint_present_must_be_false'));
  assert.ok(validateDestinationReference(destination({ hostname_present: true })).errors.includes('hostname_present_must_be_false'));
  assert.ok(validateDestinationReference(destination({ ip_present: true })).errors.includes('ip_present_must_be_false'));
  assert.ok(validateDestinationReference(destination({ port_present: true })).errors.includes('port_present_must_be_false'));
  assert.ok(validateDestinationReference(destination({ url_present: true })).errors.includes('url_present_must_be_false'));
  assert.ok(validateDestinationReference(destination({ network_enabled: true })).errors.includes('network_enabled_must_be_false'));
  assert.ok(validateDestinationReference(destination({ runtime_enabled: true })).errors.includes('runtime_enabled_must_be_false'));
  assert.ok(validateDestinationReference(destination({ production_blocked: false })).errors.includes('production_blocked_must_be_true'));
});

test('policy supports data classification and denies unless all reviews are simulation approved', () => {
  assert.equal(validateNetworkPermissionRequest(networkRequest({ data_classification: 'PII' })).valid, true);
  assert.equal(evaluateNetworkAccessPolicy(networkRequest({ policy_context: policyContext({ approval_state: 'DENIED' }) }), destination()).status, 'NETWORK_DENIED');
  assert.equal(evaluateNetworkAccessPolicy(networkRequest({ policy_context: policyContext({ security_review_state: 'PENDING' }) }), destination()).status, 'NETWORK_DENIED');
  assert.equal(evaluateNetworkAccessPolicy(networkRequest(), destination()).status, 'NETWORK_SIMULATION_REVIEWED');
  assert.ok(validatePolicyContext(policyContext({ actor_role: 'OPERATOR' })).errors.includes('actor_role_not_allowed::OPERATOR'));
  assert.ok(validatePolicyContext(policyContext({ approval_state: 'APPROVED_REAL' })).errors.includes('approval_state_not_allowed::APPROVED_REAL'));
});

test('secret resolution context is accepted only when sanitized and simulated', () => {
  assert.equal(validateSecretResolutionContext(secretContext()).valid, true);
  assert.ok(validateSecretResolutionContext(secretContext({ secret_material_present: true })).errors.includes('secret_material_present_must_be_false'));
  assert.ok(validateSecretResolutionContext(secretContext({ secret_resolved: true })).errors.includes('secret_resolved_must_be_false'));
  assert.ok(validateSecretResolutionContext(secretContext({ simulation: false })).errors.includes('secret_context_simulation_must_be_true'));
  assert.equal(evaluateNetworkPermission(networkRequest({ secret_resolution_context: secretContext({ secret_loaded: true }) })).result.status, 'SECRET_CONTEXT_INVALID');
});

test('network result and audit are immutable and never allow network', () => {
  const reviewed = evaluateNetworkPermission(networkRequest());
  assert.equal(reviewed.result.status, 'NETWORK_REVIEWED_SIMULATION');
  assert.equal(validateNetworkPermissionResult(reviewed.result).valid, true);
  assert.equal(validateNetworkPermissionAudit(reviewed.audit).valid, true);
  assertSafe(reviewed.result);
  assert.equal(Object.isFrozen(reviewed.result), true);
  assert.equal(Object.isFrozen(reviewed.audit), true);
  assert.throws(() => {
    reviewed.audit.blockers.push('mutate');
  }, TypeError);
});

test('network validation fail closes non serializable payloads without mutating input', () => {
  const original = networkRequest();
  const before = JSON.stringify(original);
  evaluateNetworkPermission(original);
  assert.equal(JSON.stringify(original), before);
  assert.ok(validateNetworkPermissionRequest(networkRequest({ metadata: { value: Number.NaN } })).errors.some((error) => error.includes('non_finite_number')));
  assert.ok(validateNetworkPermissionRequest(networkRequest({ metadata: { value: Number.POSITIVE_INFINITY } })).errors.some((error) => error.includes('non_finite_number')));
  assert.ok(validateNetworkPermissionRequest(networkRequest({ metadata: { counter: BigInt(1) } })).errors.some((error) => error.includes('forbidden_bigint')));
  assert.ok(validateNetworkPermissionRequest(networkRequest({ metadata: { marker_symbol: Symbol('x') } })).errors.some((error) => error.includes('forbidden_symbol')));
  assert.ok(validateNetworkPermissionRequest(networkRequest({ metadata: { callback: () => null } })).errors.some((error) => error.includes('forbidden_function')));
  const cyclic = networkRequest();
  cyclic.metadata.self = cyclic.metadata;
  assert.ok(validateNetworkPermissionRequest(cyclic).errors.some((error) => error.includes('cyclic_reference') || error.includes('forbidden_cycle')));
});

test('destination registry enforces replay payload mismatch version and defensive clone', () => {
  const registry = createTranscriptionNetworkDestinationRegistry();
  const dest = destination();
  const first = registry.registerDestinationReference(dest, { expected_version: 0 });
  assert.equal(first.ok, true);
  assertSafe(first);
  assert.equal(registry.registerDestinationReference(dest).errors[0], 'destination_reference_replay_duplicate');
  assert.equal(registry.registerDestinationReference(destination({ destination_alias: 'changed' })).errors[0], 'destination_reference_replay_payload_mismatch');
  assert.equal(registry.registerDestinationReference(destination({ destination_ref_id: 'another', destination_ref_version: 1 })).errors[0], 'destination_reference_version_downgrade');
  assert.equal(registry.registerDestinationReference(destination({ destination_ref_id: 'third', destination_ref_version: 2 }), { expected_version: 9 }).errors[0], 'destination_reference_optimistic_conflict');
  const stored = registry.getDestinationReference(dest.destination_ref_id);
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => {
    stored.destination_alias = 'mutated';
  }, TypeError);
  assert.equal(registry.getDestinationReference(dest.destination_ref_id).destination_alias, dest.destination_alias);
});

test('registry fingerprint failure does not store destination', () => {
  const registry = createTranscriptionNetworkDestinationRegistry();
  const bad = destination();
  bad.metadata = bad;
  const result = registry.registerDestinationReference(bad);
  assert.equal(result.ok, false);
  assert.equal(registry.getDestinationReference(bad.destination_ref_id), null);
  assert.deepEqual(registry.getHistory('mock-provider-a:mock_transport_a:TRANSCRIPTION_PROVIDER'), []);
});

function orchestratorRequest(providerSlug = 'AUTO') {
  return {
    request_id: 'orchestrator_network_request',
    request_version: 1,
    tenant_id: 'tenant_network',
    conversation_id: 'conversation_network',
    provider_slug: providerSlug,
    requested_language: 'pt-BR',
    requested_format: 'synthetic_metadata_only',
    requested_features: ['summary'],
    consent_context: {
      consent: {
        consent_id: 'consent_network_1',
        transcription_id: 'transcription_network_1',
        tenant_id: 'tenant_network',
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
    metadata: { transcription_id: 'transcription_network_1', evaluated_at: '2026-07-21T00:02:00.000Z', simulation: true, production_blocked: true, rollout_percentage: 0, network_used: false, provider_called: false, executed: false },
    validator_version: TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION
  };
}

function selectionRequest() {
  return {
    selection_request_id: 'selection_network_request',
    selection_request_version: 1,
    tenant_id: 'tenant_network',
    conversation_id: 'conversation_network',
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

test('orchestrator optional network permission records sanitized metadata only', () => {
  const result = runMockTranscriptionOrchestrator({
    request: orchestratorRequest(),
    selection_request: selectionRequest(),
    selection_profiles: capabilityFixture.profiles,
    network_permission_request: networkRequest({ conversation_id: 'conversation_network' }),
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(result.status, 'SIMULATED_SUCCESS');
  assert.equal(result.network_permission.result.network_allowed, false);
  assert.equal(result.response.network_used, false);
  assert.equal(result.response.provider_called, false);
  assert.equal(JSON.stringify(result.response).includes('mock_provider_a_batch_destination'), false);
  assert.equal(validateTranscriptionExecutionContext(result.execution_context).valid, true);
  assert.equal(result.execution_context.destination_reference_fingerprint, result.destination_reference_fingerprint);
});

test('orchestrator flow without network request and explicit provider remain preserved', () => {
  const auto = runMockTranscriptionOrchestrator({
    request: orchestratorRequest(),
    selection_request: selectionRequest(),
    selection_profiles: capabilityFixture.profiles,
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(auto.status, 'SIMULATED_SUCCESS');
  assert.equal(auto.network_permission, null);
  const explicit = runMockTranscriptionOrchestrator({
    request: orchestratorRequest('deepgram'),
    provider_contract: null,
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(explicit.status, 'PROVIDER_BLOCKED');
});

test('regression network boundary modules do not use network sdk env filesystem or provider real', () => {
  const files = [
    'services/api/src/core/transcription-network-permission-boundary.js',
    'services/api/src/core/transcription-network-access-policy.js',
    'services/api/src/core/transcription-network-permission-result.js',
    'services/api/src/core/transcription-network-permission-audit.js'
  ].map((file) => path.join(repoRoot, file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(/require\(['"]node:(http|https|net|tls|dns|dgram|fs)['"]\)/.test(source), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(/deepgram-sdk|@google-cloud\/speech|openai|assemblyai|new WebSocket|EventSource|require\(['"]grpc['"]\)/i.test(source), false);
  }
});

test('regression network boundary is not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-network-permission'), false);
  }
});
