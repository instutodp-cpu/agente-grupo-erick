'use strict';

const { buildAdapterAuditEvent, sanitizeAdapterAuditEvent, validateAdapterAuditEvent } = require('../core/adapter-audit-event');
const { createConnectorRuntimeRegistry } = require('../core/connector-runtime-registry');
const { createReadOnlyAdapterRegistry } = require('../core/read-only-adapter-registry');
const { createProviderConfigurationRegistry } = require('../core/provider-configuration-registry');
const { evaluateProviderConfigurationReadiness } = require('../core/provider-configuration-readiness');
const { createProviderSecretReferenceRegistry } = require('../core/provider-secret-reference-registry');
const { createLocalTestSecretResolver } = require('../core/provider-secret-resolver');
const {
  TRANSCRIPTION_ADAPTER_ID,
  TRANSCRIPTION_CONFIGURATION_ID,
  TRANSCRIPTION_CONNECTOR_ID,
  TRANSCRIPTION_PROVIDER_ID,
  TRANSCRIPTION_READINESS_CANDIDATE_ID,
  TRANSCRIPTION_SECRET_REFERENCE_ID,
  buildSafeTranscriptionError,
  sanitizeTranscriptionData
} = require('../core/transcription-contract');
const {
  createNetworkDenyProbe,
  createFakeTranscriptionProvider,
  createTranscriptionSanitizedAdapter
} = require('../adapters/transcription/transcription-sanitized-adapter');

const TRANSCRIPTION_PILOT_LIFECYCLE_STATES = Object.freeze([
  'registered',
  'configured',
  'validated',
  'ready',
  'pilot_enabled',
  'production_blocked'
]);

const now = '2026-07-18T00:00:00.000Z';
const future = '2030-01-01T00:00:00.000Z';

function clock() {
  return now;
}

function transcriptionRequest(overrides = {}) {
  return {
    transcription_id: 'transcription_pilot_fixture_001',
    provider_id: TRANSCRIPTION_PROVIDER_ID,
    adapter_id: TRANSCRIPTION_ADAPTER_ID,
    media_type: 'audio/wav+synthetic',
    language: 'pt-BR',
    duration_ms: 1200,
    size_bytes: 1024,
    created_at: now,
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    user_id: 'user_transcription_fixture',
    source_type: 'synthetic_audio_fixture',
    simulated: true,
    executed: false,
    real_provider_called: false,
    ...overrides
  };
}

function secretReference(overrides = {}) {
  return sanitizeTranscriptionData({
    reference_id: TRANSCRIPTION_SECRET_REFERENCE_ID,
    reference_type: 'local_test_double_reference',
    provider_id: TRANSCRIPTION_PROVIDER_ID,
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    environment: 'local_test',
    synthetic: true,
    status: 'reference_registered',
    reference_version: 1,
    created_at: now,
    updated_at: now,
    last_rotated_at: now,
    rotation_due_at: future,
    expires_at: future,
    disabled: false,
    revoked: false,
    required_secret_names: ['transcription_local_test_double'],
    metadata: {
      label: 'transcription synthetic local test reference',
      purpose: 'local test only',
      classification: 'synthetic',
      synthetic_note: 'no credential value'
    },
    ...overrides
  });
}

function providerConfiguration(overrides = {}) {
  return sanitizeTranscriptionData({
    configuration_id: TRANSCRIPTION_CONFIGURATION_ID,
    connector_id: TRANSCRIPTION_CONNECTOR_ID,
    provider_id: TRANSCRIPTION_PROVIDER_ID,
    provider_type: 'transcription',
    adapter_id: TRANSCRIPTION_ADAPTER_ID,
    readiness_candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    tenant_policy: 'corporate_grupo_erick',
    user_id: 'user_transcription_fixture',
    organization_id: 'grupo_erick',
    client_id: 'not_applicable',
    environment: 'local_test',
    configuration_status: 'descriptor_registered',
    configuration_version: 1,
    readiness_status: 'not_ready',
    secret_reference_descriptors: [{ reference_id: TRANSCRIPTION_SECRET_REFERENCE_ID, reference_type: 'local_test_double_reference' }],
    secret_reference_type: 'local_test_double_reference',
    required_secret_names: ['transcription_local_test_double'],
    required_scopes: ['read_transcription_sanitized_metadata'],
    allowed_operations: ['summarize_transcription', 'analyze_transcription'],
    rotation_policy: { next_rotation_due_at: future },
    expiration_policy: { expires_at: future },
    revocation_policy: { revocable: true },
    risk_level: 'low',
    cost_risk: 'low',
    rate_limit_risk: 'low',
    data_classification: 'synthetic_transcription_metadata',
    contract_refs: ['TRANSCRIPTION_SANITIZED_ADAPTER_PILOT.md', 'TRANSCRIPTION_INTAKE_SANDBOX.md'],
    feature_flag_key: 'transcription.sanitized_adapter.enabled',
    feature_flag_default: false,
    kill_switch_key: 'kill.transcription.sanitized_adapter',
    kill_switch_required: true,
    owner_id: 'owner_transcription_fixture',
    created_at: now,
    updated_at: now,
    deprecated: false,
    disabled: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    metadata: { label: 'transcription sanitized adapter pilot' },
    ...overrides
  });
}

function lifecycleRecord(overrides = {}) {
  return sanitizeTranscriptionData({
    connector_id: TRANSCRIPTION_CONNECTOR_ID,
    connector_type: 'transcription',
    provider_id: TRANSCRIPTION_PROVIDER_ID,
    provider_type: 'transcription',
    adapter_id: TRANSCRIPTION_ADAPTER_ID,
    adapter_kind: 'real_read_only_candidate',
    readiness_candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
    lifecycle_state: 'registered',
    lifecycle_version: 1,
    workspace_types: ['corporate'],
    tenant_strategy: 'corporate_grupo_erick',
    domains: ['treinamento', 'atendimento', 'desenvolvimento'],
    capabilities: ['sanitized_transcription_summary'],
    operations: ['summarize_transcription', 'analyze_transcription'],
    owner_id: 'owner_transcription_fixture',
    reviewer_ids: ['security_reviewer'],
    feature_flag_key: 'transcription.sanitized_adapter.enabled',
    feature_flag_default: false,
    kill_switch_key: 'kill.transcription.sanitized_adapter',
    runtime_enabled: false,
    real_provider_enabled: false,
    execution_mode: 'contract_only',
    rollout_stage: 'contract',
    risk_level: 'low',
    cost_risk: 'low',
    rate_limit_risk: 'low',
    data_classification: 'synthetic_transcription_metadata',
    created_at: now,
    updated_at: now,
    deprecated: false,
    retired: false,
    metadata: { mock_parity_declared: true, production_blocked: true },
    contract_refs: ['TRANSCRIPTION_SANITIZED_ADAPTER_PILOT.md'],
    ...overrides
  });
}

function createPilotContext(overrides = {}) {
  const networkProbe = overrides.networkProbe || createNetworkDenyProbe();
  const adapter = overrides.adapter || createTranscriptionSanitizedAdapter({
    provider: overrides.provider || createFakeTranscriptionProvider(overrides.fakeResult),
    networkProbe,
    provider_call_probe: overrides.provider_call_probe
  });
  const adapterRegistry = overrides.adapterRegistry || createReadOnlyAdapterRegistry([adapter]);
  const reference = overrides.reference || secretReference();
  const secretReferenceRegistry = overrides.secretReferenceRegistry || createProviderSecretReferenceRegistry({
    initialReferences: [reference],
    context: { now }
  });
  const configuration = overrides.configuration || providerConfiguration();
  const configurationRegistry = overrides.configurationRegistry || createProviderConfigurationRegistry({
    initialConfigurations: [configuration],
    context: { now }
  });
  const lifecycle = overrides.lifecycle || lifecycleRecord();
  const lifecycleRegistry = overrides.lifecycleRegistry || createConnectorRuntimeRegistry({ initialRecords: [lifecycle] });
  return Object.freeze({
    adapter,
    adapterRegistry,
    configuration,
    configurationRegistry,
    lifecycle,
    lifecycleRegistry,
    networkProbe,
    secretReferenceRegistry,
    secretResolver: overrides.secretResolver || createLocalTestSecretResolver({ now }),
    clock,
    provider_call_probe: overrides.provider_call_probe || null
  });
}

function change(configurationId, operation, expectedVersion, suffix) {
  return {
    trace_id: `trace_transcription_${suffix}`,
    change_id: `change_transcription_${suffix}`,
    configuration_id: configurationId,
    operation,
    expected_version: expectedVersion,
    actor_id: 'operator_transcription_fixture',
    actor_role: 'platform_operator',
    reason: 'synthetic transcription pilot state transition',
    requested_at: now,
    simulated: true,
    executed: false,
    real_provider_called: false
  };
}

function readinessForLifecycle(record) {
  return {
    candidate_id: record.readiness_candidate_id,
    provider_id: record.provider_id,
    adapter_id: record.adapter_id,
    status: 'ready_for_real_read_only_pr',
    verdict: 'allow_future_read_only_pr',
    ready: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocking_requirements: [],
    blocking_reasons: []
  };
}

function lifecycleTransition(event, expectedVersion, suffix) {
  return {
    trace_id: `trace_transcription_lifecycle_${suffix}`,
    transition_id: `transition_transcription_${suffix}`,
    connector_id: TRANSCRIPTION_CONNECTOR_ID,
    transition_event: event,
    expected_version: expectedVersion,
    actor_id: 'operator_transcription_fixture',
    actor_role: 'platform_operator',
    reason: 'transcription sanitized adapter readiness',
    requested_at: now,
    evidence: {},
    simulated: true,
    executed: false,
    real_provider_called: false
  };
}

async function runTranscriptionSanitizedAdapterDryRun(input = {}, overrides = {}) {
  const context = createPilotContext(overrides);
  const registeredConfig = context.configurationRegistry.getConfiguration(TRANSCRIPTION_CONFIGURATION_ID);
  const registeredReference = context.secretReferenceRegistry.getSecretReference(TRANSCRIPTION_SECRET_REFERENCE_ID);
  const nominated = context.lifecycleRegistry.transitionConnector(lifecycleTransition('nominate_candidate', 1, 'nominate'), { adapterRegistry: context.adapterRegistry, clock });
  const requestedReadiness = context.lifecycleRegistry.transitionConnector(lifecycleTransition('request_readiness_review', 2, 'request_readiness'), { adapterRegistry: context.adapterRegistry, clock });
  const readinessEvidenceRecord = context.lifecycleRegistry.getConnector(TRANSCRIPTION_CONNECTOR_ID);
  const lifecycleProbe = context.lifecycleRegistry.transitionConnector({
    ...lifecycleTransition('pass_readiness', 3, 'pass_readiness'),
    evidence: { readiness_result: readinessForLifecycle(readinessEvidenceRecord) }
  }, { adapterRegistry: context.adapterRegistry, clock });
  const lifecycleReady = context.lifecycleRegistry.getConnector(TRANSCRIPTION_CONNECTOR_ID);

  const referencePending = context.configurationRegistry.applyConfigurationChange(change(TRANSCRIPTION_CONFIGURATION_ID, 'register_synthetic_reference', 1, 'reference_pending'), {}, { now, clock });
  const referenceRegistered = context.configurationRegistry.applyConfigurationChange(change(TRANSCRIPTION_CONFIGURATION_ID, 'register_synthetic_reference', 2, 'reference_registered'), {}, { now, clock });
  const validationPending = context.configurationRegistry.applyConfigurationChange(change(TRANSCRIPTION_CONFIGURATION_ID, 'validate_structure', 3, 'validation_pending'), {}, { now, clock });
  const readiness = evaluateProviderConfigurationReadiness(providerConfiguration({
    configuration_status: 'validation_pending',
    configuration_version: 4,
    readiness_status: 'not_ready'
  }), {
    now,
    lifecycleRegistry: context.lifecycleRegistry,
    adapterRegistry: context.adapterRegistry,
    secretReferenceRegistry: context.secretReferenceRegistry,
    secretResolver: context.secretResolver,
    trace_id: 'trace_transcription_readiness',
    change_id: 'change_transcription_readiness',
    clock
  });
  const readyApplied = context.configurationRegistry.applyConfigurationChange(change(TRANSCRIPTION_CONFIGURATION_ID, 'evaluate_readiness', 4, 'evaluate_readiness'), {}, {
    now,
    clock,
    lifecycleRegistry: context.lifecycleRegistry,
    adapterRegistry: context.adapterRegistry,
    secretReferenceRegistry: context.secretReferenceRegistry,
    secretResolver: context.secretResolver,
    readinessEvaluator: evaluateProviderConfigurationReadiness
  });

  const request = transcriptionRequest(input);
  context.adapter.initialize();
  const dryRun = await context.adapter.dryRun(request);
  const shutdown = context.adapter.shutdown();
  const audit = buildAdapterAuditEvent({
    event_type: dryRun.status === 'transcription_mock_success' ? 'adapter_simulation_completed' : 'adapter_execution_blocked',
    trace_id: 'trace_transcription_adapter_audit',
    confirmation_id: 'confirm_transcription_not_integrated',
    domain: 'treinamento',
    intent: 'summarize_transcription',
    adapter_id: TRANSCRIPTION_ADAPTER_ID,
    status: dryRun.status === 'transcription_mock_success' ? 'simulated' : 'failed',
    timestamp: now
  });
  const sanitizedAudit = sanitizeAdapterAuditEvent(audit).event;
  const auditValidation = validateAdapterAuditEvent(sanitizedAudit);
  const passed = Boolean(
    registeredConfig &&
    registeredReference &&
    nominated.applied === true &&
    requestedReadiness.applied === true &&
    lifecycleProbe.applied === true &&
    lifecycleReady &&
    lifecycleReady.lifecycle_state === 'readiness_passed' &&
    referencePending.applied === true &&
    referenceRegistered.applied === true &&
    validationPending.applied === true &&
    readiness.ready === true &&
    readyApplied.applied === true &&
    dryRun.status === 'transcription_mock_success' &&
    dryRun.executed === true &&
    dryRun.real_provider_called === false &&
    dryRun.provider_call_count === 1 &&
    dryRun.network_attempts === 0 &&
    shutdown.ok === true &&
    auditValidation.valid === true
  );

  return sanitizeTranscriptionData({
    ok: passed,
    status: passed ? 'transcription_pilot_dry_run_passed' : 'transcription_pilot_dry_run_blocked',
    lifecycle_states: TRANSCRIPTION_PILOT_LIFECYCLE_STATES,
    lifecycle_probe: lifecycleProbe,
    lifecycle_registry_state: lifecycleReady,
    configuration_transitions: [
      referencePending.current_status,
      referenceRegistered.current_status,
      validationPending.current_status,
      readyApplied.current_status
    ],
    readiness,
    dry_run: dryRun,
    audit_event_candidate: sanitizedAudit,
    audit_valid: auditValidation.valid,
    canary_compatible: true,
    simulated: true,
    executed: dryRun.executed === true,
    real_provider_called: false,
    fake_provider_calls: dryRun.fake_provider_calls,
    network_attempts: dryRun.network_attempts,
    can_trigger_real_execution: false,
    external_network_called: dryRun.network_attempts > 0,
    real_transcription_performed: false,
    production_enabled: false,
    error: passed ? null : buildSafeTranscriptionError('INTERNAL_ADAPTER_ERROR', 'transcription_pilot_dry_run_blocked')
  });
}

module.exports = {
  TRANSCRIPTION_PILOT_LIFECYCLE_STATES,
  change,
  createPilotContext,
  lifecycleRecord,
  providerConfiguration,
  runTranscriptionSanitizedAdapterDryRun,
  secretReference,
  transcriptionRequest
};
