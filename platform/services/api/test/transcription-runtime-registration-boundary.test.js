'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const fixture = require('./fixtures/hermes-transcription-runtime-registration-boundary.json');
const capabilityFixture = require('./fixtures/hermes-transcription-provider-capability-matrix.json');
const {
  COMPONENT_TYPES,
  RUNTIME_ENVIRONMENTS,
  TRANSCRIPTION_RUNTIME_REGISTRATION_BOUNDARY_VALIDATOR_VERSION,
  computeCanonicalTopologicalOrder,
  createTranscriptionRuntimeComponentRegistry,
  evaluateRuntimeRegistration,
  validateComponentDescriptor,
  validateDependencyGraph,
  validateEntrypointReference,
  validateNetworkPermissionContext,
  validateRuntimeRegistrationRequest
} = require('../src/core/transcription-runtime-registration-boundary');
const {
  TRANSCRIPTION_RUNTIME_REGISTRATION_POLICY_VERSION,
  evaluateRuntimeRegistrationPolicy,
  validatePolicyContext
} = require('../src/core/transcription-runtime-registration-policy');
const { validateRuntimeRegistrationAudit } = require('../src/core/transcription-runtime-registration-audit');
const { validateRuntimeRegistrationResult } = require('../src/core/transcription-runtime-registration-result');
const { validateRuntimeRegistrationPlan } = require('../src/core/transcription-runtime-registration-plan');
const { buildNetworkPermissionResult } = require('../src/core/transcription-network-permission-result');
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

function descriptor(overrides = {}) {
  return { ...clone(fixture.descriptors[0]), ...overrides };
}

function singleNodeGraph(overrides = {}) {
  return { ...clone(fixture.graphs[0]), ...overrides };
}

function multiNodeGraph(overrides = {}) {
  return { ...clone(fixture.graphs[1]), ...overrides };
}

function policyContext(overrides = {}) {
  return {
    actor_type: 'USER',
    actor_id: 'actor_runtime_reviewer',
    actor_role: 'RUNTIME_REVIEWER',
    tenant_id: 'tenant_runtime',
    approval_state: 'APPROVED_SIMULATION',
    change_ticket_id: 'change_runtime_review_1',
    security_review_state: 'APPROVED_SIMULATION',
    architecture_review_state: 'APPROVED_SIMULATION',
    runtime_review_state: 'APPROVED_SIMULATION',
    policy_version: TRANSCRIPTION_RUNTIME_REGISTRATION_POLICY_VERSION,
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

function networkPermissionContext(overrides = {}) {
  return buildNetworkPermissionResult({
    network_request_id: 'network_request_runtime',
    provider_slug: 'mock-provider-a',
    adapter_id: 'adapter_network_boundary',
    transport_id: 'mock_transport_a',
    destination_ref_id: 'mock-provider-a-batch-destination',
    operation: 'TRANSCRIPTION_BATCH_REQUEST',
    protocol: 'HTTPS_REFERENCE',
    status: 'NETWORK_REVIEWED_SIMULATION',
    decision_reason: 'network_reviewed_simulation_only',
    policy_status: 'NETWORK_SIMULATION_REVIEWED',
    destination_valid: true,
    provider_binding_valid: true,
    transport_binding_valid: true,
    tenant_binding_valid: true,
    secret_context_valid: true,
    ...overrides
  });
}

function simulationContext(overrides = {}) {
  return {
    simulation: true,
    production_blocked: true,
    rollout_percentage: 0,
    runtime_mutated: false,
    components_registered: false,
    components_initialized: false,
    components_activated: false,
    network_used: false,
    provider_called: false,
    executed: false,
    ...overrides
  };
}

function registrationRequest(overrides = {}) {
  const base = {
    registration_request_id: 'registration_request_1',
    registration_request_version: 1,
    tenant_id: 'tenant_runtime',
    conversation_id: 'conversation_runtime',
    environment: 'DEVELOPMENT',
    component_descriptor: descriptor(),
    dependency_graph: singleNodeGraph(),
    secret_resolution_context: secretContext(),
    network_permission_context: networkPermissionContext(),
    policy_context: policyContext(),
    requested_purpose: 'simulate_runtime_registration_review',
    simulation_context: simulationContext(),
    metadata: { reason: 'synthetic_runtime_review', evaluated_at: '2026-07-21T00:00:00.000Z' },
    validator_version: TRANSCRIPTION_RUNTIME_REGISTRATION_BOUNDARY_VALIDATOR_VERSION
  };
  return { ...base, ...overrides };
}

function assertSafe(value) {
  assert.equal(value.registration_allowed, false);
  assert.equal(value.runtime_mutated, false);
  assert.equal(value.components_registered, false);
  assert.equal(value.components_initialized, false);
  assert.equal(value.components_activated, false);
  assert.equal(value.network_used, false);
  assert.equal(value.provider_called, false);
  assert.equal(value.secret_loaded, false);
  assert.equal(value.executed, false);
  assert.equal(value.simulation, true);
  assert.equal(value.production_blocked, true);
  assert.equal(value.runtime_enabled, false);
  assert.equal(value.rollout_percentage, 0);
}

test('runtime registration boundary docs and fixture exist and stay synthetic', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'docs', 'TRANSCRIPTION_RUNTIME_REGISTRATION_BOUNDARY.md')), true);
  assert.equal(fixture.simulation, true);
  assert.equal(fixture.registration_allowed, false);
  assert.equal(COMPONENT_TYPES.includes('PROVIDER_ADAPTER'), true);
  assert.equal(RUNTIME_ENVIRONMENTS.includes('PRODUCTION'), true);
});

test('component descriptor and registration request valid', () => {
  assert.equal(validateComponentDescriptor(descriptor()).valid, true);
  assert.equal(validateRuntimeRegistrationRequest(registrationRequest()).valid, true);
});

test('registration request blocks missing fields extras and invalid versions', () => {
  const missing = registrationRequest();
  delete missing.tenant_id;
  assert.ok(validateRuntimeRegistrationRequest(missing).errors.includes('registration_request_missing_tenant_id'));
  assert.ok(validateRuntimeRegistrationRequest(registrationRequest({ extra: true })).errors.includes('registration_request_unexpected_field::extra'));
  assert.ok(validateRuntimeRegistrationRequest(registrationRequest({ registration_request_version: 0 })).errors.includes('registration_request_version_invalid'));
});

test('component descriptor blocks active registered initialized activated flags and unsafe state', () => {
  assert.ok(validateComponentDescriptor(descriptor({ active: true })).errors.includes('active_must_be_false'));
  assert.ok(validateComponentDescriptor(descriptor({ registered: true })).errors.includes('registered_must_be_false'));
  assert.ok(validateComponentDescriptor(descriptor({ initialized: true })).errors.includes('initialized_must_be_false'));
  assert.ok(validateComponentDescriptor(descriptor({ activated: true })).errors.includes('activated_must_be_false'));
  assert.ok(validateComponentDescriptor(descriptor({ runtime_enabled: true })).errors.includes('runtime_enabled_must_be_false'));
  assert.ok(validateComponentDescriptor(descriptor({ production_blocked: false })).errors.includes('production_blocked_must_be_true'));
  assert.ok(validateComponentDescriptor(descriptor({ component_type: 'UNKNOWN_TYPE' })).errors.includes('component_type_not_allowed::UNKNOWN_TYPE'));
  assert.ok(validateComponentDescriptor(descriptor({ environment: 'UNKNOWN_ENV' })).errors.includes('environment_not_allowed::UNKNOWN_ENV'));
});

[
  ['import', 'RUNTIME_IMPORT_REF', 'entrypoint_reference_forbidden_import'],
  ['require', 'require("provider")', 'entrypoint_reference_forbidden_require'],
  ['dynamic import', 'import("provider")', 'entrypoint_reference_forbidden_import'],
  ['callback', 'RUNTIME_CALLBACK_REF', 'entrypoint_reference_forbidden_callback'],
  ['handler', 'onMessageHandler', 'entrypoint_reference_forbidden_handler'],
  ['filesystem path', './src/index.js', 'entrypoint_reference_forbidden_filesystem_path'],
  ['package name', '@scope/package-name', 'entrypoint_reference_forbidden_filesystem_path'],
  ['module name', 'RUNTIME_MODULE_REF', 'entrypoint_reference_forbidden_module_name'],
  ['url', 'https://blocked.invalid', 'entrypoint_reference_forbidden_url'],
  ['code', '() => execute()', 'entrypoint_reference_forbidden_code'],
  ['function', 'function runtime() {}', 'entrypoint_reference_forbidden_function'],
  ['bootstrap', 'bootstrapRuntime', 'entrypoint_reference_forbidden_bootstrap'],
  ['startup', 'startupSequence', 'entrypoint_reference_forbidden_startup'],
  ['lowercase symbolic', 'lowercase_symbolic_ref', 'entrypoint_reference_format_invalid']
].forEach(([name, value, reason]) => {
  test(`entrypoint reference rejects ${name}`, () => {
    const errors = validateEntrypointReference(value);
    assert.ok(errors.includes(reason), errors.join(','));
  });
});

test('entrypoint reference accepts purely symbolic logical reference', () => {
  assert.deepEqual(validateEntrypointReference('RUNTIME_LOGICAL_REF_PROVIDER_ADAPTER_MOCK_A'), []);
});

test('dependency graph validates nodes edges bindings versions and topological order', () => {
  assert.equal(validateDependencyGraph(singleNodeGraph()).valid, true);
  assert.equal(validateDependencyGraph(multiNodeGraph()).valid, true);
  assert.deepEqual(
    computeCanonicalTopologicalOrder(multiNodeGraph().nodes, multiNodeGraph().edges),
    ['runtime-registration-provider-adapter-mock-a', 'runtime-registration-selection-engine-mock']
  );
});

test('dependency graph rejects cycles self reference orphan dependency and duplicates', () => {
  const cyclic = multiNodeGraph({
    edges: [
      { from: 'runtime-registration-selection-engine-mock', to: 'runtime-registration-provider-adapter-mock-a' },
      { from: 'runtime-registration-provider-adapter-mock-a', to: 'runtime-registration-selection-engine-mock' }
    ]
  });
  assert.ok(validateDependencyGraph(cyclic).errors.includes('dependency_graph_cycle_detected'));

  const selfRef = singleNodeGraph({ edges: [{ from: 'runtime-registration-provider-adapter-mock-a', to: 'runtime-registration-provider-adapter-mock-a' }] });
  assert.ok(validateDependencyGraph(selfRef).errors.includes('dependency_graph_self_reference::runtime-registration-provider-adapter-mock-a'));

  const orphan = singleNodeGraph({ edges: [{ from: 'runtime-registration-provider-adapter-mock-a', to: 'missing_node' }] });
  assert.ok(validateDependencyGraph(orphan).errors.some((error) => error.includes('dependency_graph_orphan_dependency')));

  const duplicateNodes = singleNodeGraph({
    nodes: [
      { node_id: 'runtime-registration-provider-adapter-mock-a', component_type: 'PROVIDER_ADAPTER', version: 1 },
      { node_id: 'runtime-registration-provider-adapter-mock-a', component_type: 'PROVIDER_ADAPTER', version: 1 }
    ]
  });
  assert.ok(validateDependencyGraph(duplicateNodes).errors.some((error) => error.includes('dependency_graph_duplicate_node')));
});

test('dependency graph bindings reject version incompatibility and invalid binding type', () => {
  const wrongVersion = multiNodeGraph({
    bindings: [{ node_id: 'runtime-registration-selection-engine-mock', binds_to: 'runtime-registration-provider-adapter-mock-a', binding_type: 'PROVIDER_ADAPTER', required_version: 2 }]
  });
  assert.ok(validateDependencyGraph(wrongVersion).errors.some((error) => error.includes('dependency_graph_version_incompatibility')));

  const wrongType = multiNodeGraph({
    bindings: [{ node_id: 'runtime-registration-selection-engine-mock', binds_to: 'runtime-registration-provider-adapter-mock-a', binding_type: 'NOT_A_TYPE', required_version: 1 }]
  });
  assert.ok(validateDependencyGraph(wrongType).errors.some((error) => error.includes('dependency_graph_binding_type_not_allowed')));
});

test('registration boundary blocks tenant and environment mismatch', () => {
  assert.equal(evaluateRuntimeRegistration(registrationRequest({ tenant_id: 'tenant_other' })).result.status, 'REGISTRATION_POLICY_BLOCKED');
  assert.equal(evaluateRuntimeRegistration(registrationRequest({ environment: 'STAGING' })).result.status, 'REGISTRATION_POLICY_BLOCKED');
});

test('policy denies unless all reviews are simulation approved', () => {
  assert.equal(evaluateRuntimeRegistrationPolicy(registrationRequest({ policy_context: policyContext({ approval_state: 'DENIED' }) }), descriptor()).status, 'REGISTRATION_DENIED');
  assert.equal(evaluateRuntimeRegistrationPolicy(registrationRequest({ policy_context: policyContext({ runtime_review_state: 'PENDING' }) }), descriptor()).status, 'REGISTRATION_DENIED');
  assert.equal(evaluateRuntimeRegistrationPolicy(registrationRequest(), descriptor()).status, 'REGISTRATION_SIMULATION_REVIEWED');
  assert.ok(validatePolicyContext(policyContext({ actor_role: 'OPERATOR' })).errors.includes('actor_role_not_allowed::OPERATOR'));
  assert.ok(validatePolicyContext(policyContext({ approval_state: 'APPROVED_REAL' })).errors.includes('approval_state_not_allowed::APPROVED_REAL'));
});

test('secret and network permission contexts are accepted only when sanitized and simulated', () => {
  assert.ok(validateRuntimeRegistrationRequest(registrationRequest({ secret_resolution_context: secretContext({ secret_material_present: true }) })).errors.some((error) => error.includes('secret_material_present_must_be_false')));
  assert.equal(validateNetworkPermissionContext(networkPermissionContext()).valid, true);
  assert.equal(validateNetworkPermissionContext({ not_a_result: true }).valid, false);
  assert.ok(validateRuntimeRegistrationRequest(registrationRequest({ network_permission_context: { not_a_result: true } })).errors.some((error) => error.includes('network_permission_context_')));
});

test('registration result plan and audit are immutable and never allow registration', () => {
  const reviewed = evaluateRuntimeRegistration(registrationRequest());
  assert.equal(reviewed.result.status, 'REGISTRATION_SIMULATION_REVIEWED');
  assert.equal(validateRuntimeRegistrationResult(reviewed.result).valid, true);
  assert.equal(validateRuntimeRegistrationAudit(reviewed.audit).valid, true);
  assert.equal(validateRuntimeRegistrationPlan(reviewed.plan).valid, true);
  assertSafe(reviewed.result);
  assertSafe(reviewed.plan);
  assert.equal(Object.isFrozen(reviewed.result), true);
  assert.equal(Object.isFrozen(reviewed.audit), true);
  assert.equal(Object.isFrozen(reviewed.plan), true);
  assert.throws(() => {
    reviewed.audit.blockers.push('mutate');
  }, TypeError);
  assert.throws(() => {
    reviewed.plan.dependency_order.push('mutate');
  }, TypeError);
});

test('registration validation fail closes non serializable payloads without mutating input', () => {
  const original = registrationRequest();
  const before = JSON.stringify(original);
  evaluateRuntimeRegistration(original);
  assert.equal(JSON.stringify(original), before);
  assert.ok(validateRuntimeRegistrationRequest(registrationRequest({ metadata: { value: Number.NaN } })).errors.some((error) => error.includes('non_finite_number')));
  assert.ok(validateRuntimeRegistrationRequest(registrationRequest({ metadata: { counter: BigInt(1) } })).errors.some((error) => error.includes('forbidden_bigint')));
  assert.ok(validateRuntimeRegistrationRequest(registrationRequest({ metadata: { callback: () => null } })).errors.some((error) => error.includes('forbidden_function')));
  const cyclic = registrationRequest();
  cyclic.metadata.self = cyclic.metadata;
  assert.ok(validateRuntimeRegistrationRequest(cyclic).errors.some((error) => error.includes('cyclic_reference') || error.includes('forbidden_cycle')));
});

test('component registry enforces replay payload mismatch version and defensive clone', () => {
  const registry = createTranscriptionRuntimeComponentRegistry();
  const comp = descriptor();
  const first = registry.registerComponentDescriptor(comp, { expected_version: 0 });
  assert.equal(first.ok, true);
  assertSafe(first);
  assert.equal(registry.registerComponentDescriptor(comp).errors[0], 'component_descriptor_replay_duplicate');
  assert.equal(registry.registerComponentDescriptor(descriptor({ component_alias: 'changed' })).errors[0], 'component_descriptor_replay_payload_mismatch');
  assert.equal(registry.registerComponentDescriptor(descriptor({ component_ref_id: 'another', component_ref_version: 1 })).errors[0], 'component_descriptor_version_downgrade');
  assert.equal(registry.registerComponentDescriptor(descriptor({ component_ref_id: 'third', component_ref_version: 2 }), { expected_version: 9 }).errors[0], 'component_descriptor_optimistic_conflict');
  const stored = registry.getComponentDescriptor(comp.component_ref_id);
  assert.equal(Object.isFrozen(stored), true);
  assert.throws(() => {
    stored.component_alias = 'mutated';
  }, TypeError);
  assert.equal(registry.getComponentDescriptor(comp.component_ref_id).component_alias, comp.component_alias);
});

test('registry fingerprint failure does not store component descriptor', () => {
  const registry = createTranscriptionRuntimeComponentRegistry();
  const bad = descriptor();
  bad.metadata_self_reference = bad;
  bad.entrypoint_reference = bad;
  const result = registry.registerComponentDescriptor(bad);
  assert.equal(result.ok, false);
  assert.equal(registry.getComponentDescriptor(bad.component_ref_id), null);
});

function orchestratorRequest(providerSlug = 'AUTO') {
  return {
    request_id: 'orchestrator_runtime_request',
    request_version: 1,
    tenant_id: 'tenant_runtime',
    conversation_id: 'conversation_runtime',
    provider_slug: providerSlug,
    requested_language: 'pt-BR',
    requested_format: 'synthetic_metadata_only',
    requested_features: ['summary'],
    consent_context: {
      consent: {
        consent_id: 'consent_runtime_1',
        transcription_id: 'transcription_runtime_1',
        tenant_id: 'tenant_runtime',
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
    metadata: { transcription_id: 'transcription_runtime_1', evaluated_at: '2026-07-21T00:02:00.000Z', simulation: true, production_blocked: true, rollout_percentage: 0, network_used: false, provider_called: false, executed: false },
    validator_version: TRANSCRIPTION_ORCHESTRATOR_VALIDATOR_VERSION
  };
}

function selectionRequest() {
  return {
    selection_request_id: 'selection_runtime_request',
    selection_request_version: 1,
    tenant_id: 'tenant_runtime',
    conversation_id: 'conversation_runtime',
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

test('orchestrator optional runtime registration records sanitized metadata only', () => {
  const result = runMockTranscriptionOrchestrator({
    request: orchestratorRequest(),
    selection_request: selectionRequest(),
    selection_profiles: capabilityFixture.profiles,
    runtime_registration_request: registrationRequest({ conversation_id: 'conversation_runtime' }),
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(result.status, 'SIMULATED_SUCCESS');
  assert.equal(result.runtime_registration.result.registration_allowed, false);
  assert.equal(result.response.network_used, false);
  assert.equal(result.response.provider_called, false);
  assert.equal(JSON.stringify(result.response).includes('RUNTIME_LOGICAL_REF_PROVIDER_ADAPTER_MOCK_A'), false);
  assert.equal(validateTranscriptionExecutionContext(result.execution_context).valid, true);
  assert.equal(result.execution_context.runtime_registration_plan_fingerprint, result.runtime_registration.plan_fingerprint);
});

test('orchestrator flow without runtime registration request and explicit provider remain preserved', () => {
  const auto = runMockTranscriptionOrchestrator({
    request: orchestratorRequest(),
    selection_request: selectionRequest(),
    selection_profiles: capabilityFixture.profiles,
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(auto.status, 'SIMULATED_SUCCESS');
  assert.equal(auto.runtime_registration, null);
  const explicit = runMockTranscriptionOrchestrator({
    request: orchestratorRequest('deepgram'),
    provider_contract: null,
    adapter: createTranscriptionProviderAdapterMock(),
    transport_contract: transportContract(),
    transport_lifecycle: { transport_state: 'BLOCKED', provider_slug: 'deepgram', transport_contract_id: 'transport_contract_deepgram_mock_1', runtime_enabled: false, provider_enabled: false, network_enabled: false, production_blocked: true }
  });
  assert.equal(explicit.status, 'PROVIDER_BLOCKED');
});

test('regression runtime registration modules do not use network sdk env filesystem or provider real', () => {
  const files = [
    'services/api/src/core/transcription-runtime-registration-boundary.js',
    'services/api/src/core/transcription-runtime-registration-policy.js',
    'services/api/src/core/transcription-runtime-registration-plan.js',
    'services/api/src/core/transcription-runtime-registration-result.js',
    'services/api/src/core/transcription-runtime-registration-audit.js'
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

test('regression runtime registration boundary is not imported by runtime endpoints', () => {
  const runtimeFiles = ['src/index.js', 'src/routes/message.js', 'src/routes/confirm.js']
    .map((file) => path.join(repoRoot, file))
    .filter((file) => fs.existsSync(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-runtime-registration'), false);
  }
});
