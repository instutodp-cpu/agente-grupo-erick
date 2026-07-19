'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  FORBIDDEN_TRANSCRIPTION_FIELDS,
  TRANSCRIPTION_ADAPTER_ID,
  TRANSCRIPTION_CONFIGURATION_ID,
  TRANSCRIPTION_CONNECTOR_ID,
  TRANSCRIPTION_PROVIDER_ID,
  TRANSCRIPTION_READINESS_CANDIDATE_ID,
  TRANSCRIPTION_SECRET_REFERENCE_ID,
  findTranscriptionForbiddenFields
} = require('../src/core/transcription-contract');
const {
  createTranscriptionConsentRegistry,
  evaluateTranscriptionConsent,
  validateTranscriptionConsent
} = require('../src/core/transcription-consent-policy');
const {
  createTranscriptionRetentionPolicyRegistry,
  evaluateTranscriptionRetentionPolicy,
  validateTranscriptionRetentionPolicy
} = require('../src/core/transcription-retention-policy');
const {
  createTranscriptionBudgetPolicyRegistry,
  evaluateTranscriptionBudgetPolicy,
  validateTranscriptionBudgetPolicy
} = require('../src/core/transcription-budget-policy');
const {
  createTranscriptionOperatorApprovalRegistry,
  evaluateTranscriptionOperatorApproval,
  validateTranscriptionOperatorApproval
} = require('../src/core/transcription-operator-approval-policy');
const {
  createTranscriptionReadinessEvaluationRegistry,
  evaluateTranscriptionProviderReadiness,
  validateCandidateDescriptor
} = require('../src/core/transcription-provider-readiness');
const { createReadOnlyAdapterRegistry } = require('../src/core/read-only-adapter-registry');
const { createConnectorRuntimeRegistry } = require('../src/core/connector-runtime-registry');
const { createProviderConfigurationRegistry } = require('../src/core/provider-configuration-registry');
const { createProviderSecretReferenceRegistry } = require('../src/core/provider-secret-reference-registry');
const { createTranscriptionSanitizedAdapter } = require('../src/adapters/transcription/transcription-sanitized-adapter');
const {
  lifecycleRecord,
  providerConfiguration,
  secretReference
} = require('../src/pilots/transcription-sanitized-adapter-pilot');

const repoRoot = path.resolve(__dirname, '../../..');
const docPath = path.join(repoRoot, 'docs', 'TRANSCRIPTION_CONSENT_RETENTION_READINESS_POLICY.md');
const fixturePath = path.join(__dirname, 'fixtures', 'hermes-transcription-consent-retention-readiness-policy.json');
const now = '2026-07-19T00:00:00.000Z';
const future = '2030-01-01T00:00:00.000Z';
const past = '2020-01-01T00:00:00.000Z';

function consent(overrides = {}) {
  return {
    consent_id: 'consent_transcription_fixture_001',
    transcription_id: 'transcription_policy_fixture_001',
    tenant_id: 'grupo_erick',
    workspace_type: 'corporate',
    subject_type: 'synthetic_participant',
    purpose: 'training_summary',
    capture_source: 'synthetic_fixture',
    requested_at: now,
    granted_at: now,
    expires_at: future,
    consent_status: 'granted',
    consent_version: 1,
    granted_by: 'operator_consent_fixture',
    revocation_status: 'not_revoked',
    revoked_at: null,
    revocation_reason: null,
    allowed_operations: ['evaluate_transcription_candidate', 'simulate_transcription_readiness'],
    data_classification: 'synthetic_transcription_metadata',
    simulated: true,
    ...overrides
  };
}

function retentionPolicy(overrides = {}) {
  return {
    retention_policy_id: 'retention_transcription_fixture_001',
    tenant_id: 'grupo_erick',
    workspace_type: 'corporate',
    data_classification: 'synthetic_transcription_metadata',
    retention_mode: 'sanitized_transcript_temporary',
    metadata_retention_days: 30,
    transcript_retention_days: 7,
    raw_media_retention_days: 0,
    deletion_required: true,
    legal_hold: false,
    policy_version: 1,
    effective_at: now,
    expires_at: future,
    simulated: true,
    ...overrides
  };
}

function budgetPolicy(overrides = {}) {
  return {
    budget_policy_id: 'budget_transcription_fixture_001',
    tenant_id: 'grupo_erick',
    workspace_type: 'corporate',
    currency: 'BRL',
    monthly_budget_minor: 100000,
    daily_budget_minor: 10000,
    max_cost_per_request_minor: 1000,
    max_duration_ms: 120000,
    max_size_bytes: 1048576,
    daily_request_limit: 10,
    monthly_request_limit: 100,
    concurrent_request_limit: 1,
    rollout_percentage: 0,
    environment: 'local_test',
    simulated: true,
    ...overrides
  };
}

function approval(overrides = {}) {
  return {
    approval_id: 'approval_transcription_fixture_001',
    candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
    tenant_id: 'grupo_erick',
    environment: 'local_test',
    requested_by: 'operator_requester_fixture',
    approved_by: 'operator_approver_fixture',
    requested_at: now,
    approved_at: now,
    expires_at: future,
    approval_status: 'approved',
    allowed_operation: 'evaluate_transcription_candidate',
    single_use: true,
    consumed_at: null,
    simulated: true,
    ...overrides
  };
}

function candidate(overrides = {}) {
  return {
    readiness_evaluation_id: 'readiness_transcription_fixture_001',
    readiness_evaluation_version: 1,
    candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID,
    transcription_id: 'transcription_policy_fixture_001',
    provider_id: TRANSCRIPTION_PROVIDER_ID,
    adapter_id: TRANSCRIPTION_ADAPTER_ID,
    connector_id: TRANSCRIPTION_CONNECTOR_ID,
    configuration_id: TRANSCRIPTION_CONFIGURATION_ID,
    secret_reference_id: TRANSCRIPTION_SECRET_REFERENCE_ID,
    tenant_id: 'grupo_erick',
    workspace_type: 'corporate',
    environment: 'local_test',
    operation: 'evaluate_transcription_candidate',
    requested_at: now,
    rollout_percentage: 0,
    policy_versions: {
      consent_version: 1,
      retention_policy_version: 1,
      budget_policy_version: 1
    },
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    write_allowed: false,
    action_allowed: false,
    send_allowed: false,
    publish_allowed: false,
    delete_allowed: false,
    production_blocked: true,
    network_blocked: true,
    raw_media_allowed: false,
    storage_enabled: false,
    automatic_execution_enabled: false,
    endpoint_configured: false,
    scheduler_configured: false,
    worker_configured: false,
    queue_configured: false,
    ...overrides
  };
}

function validReadinessContext(overrides = {}) {
  const adapter = createTranscriptionSanitizedAdapter();
  const lifecycle = lifecycleRecord({ lifecycle_state: 'readiness_passed', lifecycle_version: 4 });
  const configuration = providerConfiguration({
    configuration_status: 'structurally_ready',
    configuration_version: 5,
    readiness_status: 'configuration_structurally_ready'
  });
  const reference = secretReference({ status: 'structurally_ready', reference_version: 2 });
  return {
    now,
    clock: () => now,
    adapterRegistry: createReadOnlyAdapterRegistry([adapter]),
    lifecycleRegistry: createConnectorRuntimeRegistry({ initialRecords: [lifecycleRecord()] }),
    configurationRegistry: createProviderConfigurationRegistry({ initialConfigurations: [providerConfiguration()], context: { now } }),
    secretReferenceRegistry: createProviderSecretReferenceRegistry({ initialReferences: [secretReference()], context: { now } }),
    adapterMetadata: adapter.metadata,
    lifecycleRecord: lifecycle,
    providerConfiguration: configuration,
    secretReference: reference,
    consentRecord: consent(),
    retentionPolicy: retentionPolicy(),
    budgetPolicy: budgetPolicy(),
    operatorApproval: approval(),
    tenantWorkspacePolicy: {
      allowed: true,
      tenant_id: 'grupo_erick',
      workspace_type: 'corporate',
      write_allowed: false,
      action_allowed: false,
      send_allowed: false,
      publish_allowed: false,
      delete_allowed: false
    },
    featureFlagEnabled: false,
    killSwitchAvailable: true,
    killSwitchActive: false,
    rollout_percentage: 0,
    syntheticEvidence: {
      provider_called: false,
      real_provider_called: false,
      external_network_called: false,
      network_attempts: 0,
      raw_media_present: false,
      storage_configured: false,
      can_trigger_real_execution: false
    },
    ...overrides
  };
}

function assertBlocks(errors, reason) {
  assert.ok(errors.includes(reason) || errors.some((error) => error.includes(reason)), `${reason} not found in ${errors.join(',')}`);
}

function assertSafeEnvelope(result) {
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.can_trigger_real_execution, false);
}

test('transcription consent retention readiness docs and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('transcription consent retention readiness fixture is synthetic and complete', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(fixture.default_rules.simulated, true);
  assert.equal(fixture.default_rules.executed, false);
  assert.equal(fixture.default_rules.real_provider_called, false);
  assert.equal(fixture.default_rules.external_network_called, false);
  assert.equal(fixture.default_rules.can_trigger_real_execution, false);
  assert.equal(fixture.default_rules.rollout_percentage, 0);
  assert.equal(fixture.default_rules.production_blocked, true);
  for (const moduleName of ['transcription-contract', 'transcription-sanitized-adapter', 'provider-configuration-registry', 'provider-secret-reference-registry', 'connector-runtime-registry', 'provider-configuration-readiness', 'read-only-adapter-registry', 'execution-policy', 'adapter-audit-event', 'public-web-canary patterns']) {
    assert.ok(fixture.reused_modules.includes(moduleName), moduleName);
  }
  for (const forbidden of ['audio', 'raw_audio', 'buffer', 'base64', 'token', 'secret', 'endpoint', 'provider_url']) {
    assert.ok(fixture.forbidden_fields.includes(forbidden), forbidden);
  }
  const json = JSON.stringify(fixture);
  assert.equal(/https?:\/\//i.test(json), false);
  assert.equal(/cpf|telefone|oauth|real provider/i.test(json), false);
});

test('consent policy accepts valid explicit synthetic consent', () => {
  const result = evaluateTranscriptionConsent(consent(), { tenant_id: 'grupo_erick', workspace_type: 'corporate', transcription_id: 'transcription_policy_fixture_001', operation: 'evaluate_transcription_candidate', now });
  assert.equal(result.allowed, true);
  assertSafeEnvelope(result);
});

test('consent policy blocks missing consent', () => {
  assertBlocks(validateTranscriptionConsent(null).errors, 'consent_missing');
});

test('consent policy blocks denied consent', () => {
  assertBlocks(validateTranscriptionConsent(consent({ consent_status: 'denied' }), { now }).errors, 'consent_denied');
});

test('consent policy blocks revoked consent and requires revoked_at', () => {
  const errors = validateTranscriptionConsent(consent({ consent_status: 'revoked', revocation_status: 'revoked', revoked_at: null }), { now }).errors;
  assertBlocks(errors, 'consent_revoked');
  assertBlocks(errors, 'revoked_at_required');
});

test('consent policy blocks expired consent', () => {
  assertBlocks(validateTranscriptionConsent(consent({ expires_at: past }), { now }).errors, 'consent_expired');
});

test('consent policy blocks tenant divergence and reuse across tenants', () => {
  assertBlocks(validateTranscriptionConsent(consent({ tenant_id: 'tenant_other' }), { tenant_id: 'grupo_erick', now }).errors, 'consent_tenant_mismatch');
});

test('consent policy blocks transcription_id divergence', () => {
  assertBlocks(validateTranscriptionConsent(consent({ transcription_id: 'transcription_other' }), { transcription_id: 'transcription_policy_fixture_001', now }).errors, 'consent_transcription_id_mismatch');
});

test('consent policy blocks invalid version purpose and write operation', () => {
  let errors = validateTranscriptionConsent(consent({ consent_version: 0 }), { now }).errors;
  assertBlocks(errors, 'consent_version_invalid');
  errors = validateTranscriptionConsent(consent({ purpose: 'generic' }), { now }).errors;
  assertBlocks(errors, 'consent_purpose_not_allowed');
  errors = validateTranscriptionConsent(consent({ allowed_operations: ['write_transcription'] }), { now }).errors;
  assertBlocks(errors, 'blocked_operation::write_transcription');
});

test('consent registry blocks replay payload mismatch and revoked-to-granted resurrection', () => {
  const registry = createTranscriptionConsentRegistry();
  assert.equal(registry.registerConsent(consent()).ok, true);
  assert.equal(registry.registerConsent(consent({ purpose: 'development_test' })).blocked_reason, 'consent_replay_payload_mismatch');
  assert.equal(registry.revokeConsent({ consent_id: 'consent_transcription_fixture_001', expected_version: 1, revoked_at: now, revocation_reason: 'synthetic_revocation' }).ok, true);
  assert.equal(registry.revokeConsent({ consent_id: 'consent_transcription_fixture_001', expected_version: 2, revoked_at: now }).blocked_reason, 'consent_revoked_cannot_return_to_granted');
  const stored = registry.getConsent('consent_transcription_fixture_001');
  stored.tenant_id = 'mutated';
  assert.equal(registry.getConsent('consent_transcription_fixture_001').tenant_id, 'grupo_erick');
});

test('retention policy accepts sanitized metadata and transcript retention only', () => {
  const result = evaluateTranscriptionRetentionPolicy(retentionPolicy(), { tenant_id: 'grupo_erick', workspace_type: 'corporate', now });
  assert.equal(result.allowed, true);
  assert.equal(result.raw_media_retention_days, 0);
  assertSafeEnvelope(result);
});

test('retention policy blocks raw media retention greater than zero', () => {
  assertBlocks(validateTranscriptionRetentionPolicy(retentionPolicy({ raw_media_retention_days: 1 }), { now }).errors, 'raw_media_retention_must_be_zero');
});

test('retention policy blocks indefinite retention negative and excessive values', () => {
  assertBlocks(validateTranscriptionRetentionPolicy(retentionPolicy({ retention_mode: 'indefinite', indefinite: true }), { now }).errors, 'retention_indefinite_blocked');
  assertBlocks(validateTranscriptionRetentionPolicy(retentionPolicy({ transcript_retention_days: -1 }), { now }).errors, 'transcript_retention_days_negative');
  assertBlocks(validateTranscriptionRetentionPolicy(retentionPolicy({ metadata_retention_days: 91 }), { now }).errors, 'metadata_retention_days_exceeds_limit');
});

test('retention policy blocks tenant mismatch expired legal hold and deletion disabled', () => {
  assertBlocks(validateTranscriptionRetentionPolicy(retentionPolicy({ tenant_id: 'tenant_other' }), { tenant_id: 'grupo_erick', now }).errors, 'retention_tenant_mismatch');
  assertBlocks(validateTranscriptionRetentionPolicy(retentionPolicy({ expires_at: past }), { now }).errors, 'retention_policy_expired');
  assertBlocks(validateTranscriptionRetentionPolicy(retentionPolicy({ legal_hold: true }), { now }).errors, 'legal_hold_must_be_false');
  assertBlocks(validateTranscriptionRetentionPolicy(retentionPolicy({ deletion_required: false }), { now }).errors, 'deletion_required_must_be_true');
});

test('retention registry blocks version regression and tenant mutation', () => {
  const registry = createTranscriptionRetentionPolicyRegistry();
  assert.equal(registry.registerPolicy(retentionPolicy()).ok, true);
  assert.equal(registry.registerPolicy(retentionPolicy({ policy_version: 1 })).blocked_reason, 'retention_policy_version_regression');
  assert.equal(registry.registerPolicy(retentionPolicy({ tenant_id: 'tenant_other', policy_version: 2 })).blocked_reason, 'retention_tenant_mutation_blocked');
});

test('budget policy accepts local BRL rollout zero quotas', () => {
  const result = evaluateTranscriptionBudgetPolicy(budgetPolicy(), { tenant_id: 'grupo_erick', workspace_type: 'corporate', environment: 'local_test' });
  assert.equal(result.allowed, true);
  assert.equal(result.rollout_percentage, 0);
  assertSafeEnvelope(result);
});

test('budget policy blocks rollout production unlimited quotas and concurrency greater than one', () => {
  assertBlocks(validateTranscriptionBudgetPolicy(budgetPolicy({ rollout_percentage: 1 })).errors, 'rollout_percentage_must_be_zero');
  assertBlocks(validateTranscriptionBudgetPolicy(budgetPolicy({ environment: 'production' })).errors, 'production_blocked');
  assertBlocks(validateTranscriptionBudgetPolicy(budgetPolicy({ monthly_budget_minor: 'unlimited' })).errors, 'monthly_budget_minor_unlimited_blocked');
  assertBlocks(validateTranscriptionBudgetPolicy(budgetPolicy({ daily_request_limit: null })).errors, 'daily_request_limit_unlimited_blocked');
  assertBlocks(validateTranscriptionBudgetPolicy(budgetPolicy({ concurrent_request_limit: 2 })).errors, 'concurrent_request_limit_must_be_one');
});

test('budget policy blocks negative excessive and tenant divergent values', () => {
  assertBlocks(validateTranscriptionBudgetPolicy(budgetPolicy({ daily_budget_minor: -1 })).errors, 'daily_budget_minor_negative');
  assertBlocks(validateTranscriptionBudgetPolicy(budgetPolicy({ monthly_request_limit: 1001 })).errors, 'monthly_request_limit_exceeds_limit');
  assertBlocks(validateTranscriptionBudgetPolicy(budgetPolicy({ tenant_id: 'tenant_other' }), { tenant_id: 'grupo_erick' }).errors, 'budget_tenant_mismatch');
});

test('budget registry preserves private state and blocks tenant mutation', () => {
  const registry = createTranscriptionBudgetPolicyRegistry();
  assert.equal(registry.registerPolicy(budgetPolicy()).ok, true);
  assert.equal(registry.registerPolicy(budgetPolicy({ tenant_id: 'tenant_other' })).blocked_reason, 'budget_tenant_mutation_blocked');
  const stored = registry.getPolicy('budget_transcription_fixture_001');
  stored.tenant_id = 'mutated';
  assert.equal(registry.getPolicy('budget_transcription_fixture_001').tenant_id, 'grupo_erick');
});

test('operator approval accepts explicit ephemeral single use approval', () => {
  const result = evaluateTranscriptionOperatorApproval(approval(), { candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', operation: 'evaluate_transcription_candidate', now });
  assert.equal(result.allowed, true);
  assert.equal(result.single_use, true);
  assertSafeEnvelope(result);
});

test('operator approval blocks self approval expired consumed candidate tenant operation and production', () => {
  assertBlocks(validateTranscriptionOperatorApproval(approval({ approved_by: 'operator_requester_fixture' }), { now }).errors, 'operator_self_approval_blocked');
  assertBlocks(validateTranscriptionOperatorApproval(approval({ expires_at: past }), { now }).errors, 'operator_approval_expired');
  assertBlocks(validateTranscriptionOperatorApproval(approval({ consumed_at: now }), { now }).errors, 'operator_approval_consumed');
  assertBlocks(validateTranscriptionOperatorApproval(approval({ candidate_id: 'candidate_other' }), { candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, now }).errors, 'approval_candidate_mismatch');
  assertBlocks(validateTranscriptionOperatorApproval(approval({ tenant_id: 'tenant_other' }), { tenant_id: 'grupo_erick', now }).errors, 'approval_tenant_mismatch');
  assertBlocks(validateTranscriptionOperatorApproval(approval({ allowed_operation: 'execute_external_provider' }), { now }).errors, 'approval_operation_not_allowed::execute_external_provider');
  assertBlocks(validateTranscriptionOperatorApproval(approval({ environment: 'production' }), { now }).errors, 'production_blocked');
});

test('operator approval registry blocks replay and reuse after consumption', () => {
  const registry = createTranscriptionOperatorApprovalRegistry();
  assert.equal(registry.registerApproval(approval(), { now }).ok, true);
  assert.equal(registry.registerApproval(approval(), { now }).blocked_reason, 'operator_approval_replay_duplicate');
  assert.equal(registry.consumeApproval({ approval_id: 'approval_transcription_fixture_001', candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', consumed_at: now }).ok, true);
  assert.equal(registry.consumeApproval({ approval_id: 'approval_transcription_fixture_001', candidate_id: TRANSCRIPTION_READINESS_CANDIDATE_ID, tenant_id: 'grupo_erick', consumed_at: now }).blocked_reason, 'operator_approval_reuse_blocked');
});

test('readiness passes only for controlled canary review with all synthetic requirements satisfied', () => {
  const result = evaluateTranscriptionProviderReadiness(candidate(), validReadinessContext());
  assert.equal(result.ready_for_next_review, true);
  assert.equal(result.ready_for_real_execution, false);
  assert.equal(result.verdict, 'READY_FOR_CONTROLLED_CANARY_REVIEW');
  assert.notEqual(result.verdict, 'READY_FOR_REAL_EXECUTION');
  assert.notEqual(result.verdict, 'READY_FOR_PRODUCTION');
  assert.equal(result.rollout_percentage, 0);
  assert.equal(result.production_blocked, true);
  assertSafeEnvelope(result);
});

test('readiness blocks absence of each mandatory policy', () => {
  const missing = [
    ['consentRecord', 'consent_valid::consent_missing'],
    ['retentionPolicy', 'retention_policy_valid::retention_policy_missing'],
    ['budgetPolicy', 'budget_policy_valid::budget_policy_missing'],
    ['operatorApproval', 'operator_approval_valid::operator_approval_missing'],
    ['tenantWorkspacePolicy', 'tenant_workspace_policy_valid::tenant_workspace_policy_missing']
  ];
  for (const [field, reason] of missing) {
    const context = validReadinessContext({ [field]: null });
    assertBlocks(evaluateTranscriptionProviderReadiness(candidate(), context).blocking_requirements, reason);
  }
});

test('readiness blocks identity binding divergence', () => {
  const result = evaluateTranscriptionProviderReadiness(candidate({ tenant_id: 'tenant_other' }), validReadinessContext());
  assert.equal(result.ready_for_next_review, false);
  assertBlocks(result.blocking_requirements, 'tenant_id_mismatch');
});

test('readiness blocks feature flag enabled kill switch missing and rollout greater than zero', () => {
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate(), validReadinessContext({ featureFlagEnabled: true })).blocking_requirements, 'feature_flag_enabled_or_missing');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate(), validReadinessContext({ killSwitchAvailable: false })).blocking_requirements, 'kill_switch_unavailable_or_active');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate({ rollout_percentage: 1 }), validReadinessContext({ rollout_percentage: 1 })).blocking_requirements, 'rollout_percentage_must_be_zero');
});

test('readiness blocks provider real enabled runtime enabled and production', () => {
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate(), validReadinessContext({ lifecycleRecord: lifecycleRecord({ lifecycle_state: 'readiness_passed', runtime_enabled: true, lifecycle_version: 4 }) })).blocking_requirements, 'runtime_enabled');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate(), validReadinessContext({ lifecycleRecord: lifecycleRecord({ lifecycle_state: 'readiness_passed', real_provider_enabled: true, lifecycle_version: 4 }) })).blocking_requirements, 'real_provider_enabled');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate({ environment: 'production' }), validReadinessContext()).blocking_requirements, 'production_blocked');
});

test('readiness blocks secret value raw audio and detected network evidence', () => {
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate(), validReadinessContext({ secretReference: { ...secretReference({ status: 'structurally_ready', reference_version: 2 }), secret_value: 'never' } })).blocking_requirements, 'secret_value_present');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate({ rawAudio: 'synthetic' }), validReadinessContext()).blocking_requirements, 'forbidden_field::rawAudio');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate(), validReadinessContext({ syntheticEvidence: { provider_called: false, real_provider_called: false, external_network_called: true, network_attempts: 1, raw_media_present: false, storage_configured: false, can_trigger_real_execution: false } })).blocking_requirements, 'external_network_called_must_be_false');
});

test('readiness blocks write operations endpoint scheduler worker storage and queue', () => {
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate({ write_allowed: true }), validReadinessContext()).blocking_requirements, 'write_allowed_must_be_false');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate({ endpoint_configured: true }), validReadinessContext()).blocking_requirements, 'endpoint_configured');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate({ scheduler_configured: true }), validReadinessContext()).blocking_requirements, 'scheduler_configured');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate({ worker_configured: true }), validReadinessContext()).blocking_requirements, 'worker_configured');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate({ storage_enabled: true }), validReadinessContext()).blocking_requirements, 'storage_enabled');
  assertBlocks(evaluateTranscriptionProviderReadiness(candidate({ queue_configured: true }), validReadinessContext()).blocking_requirements, 'queue_configured');
});

test('readiness candidate descriptor validates safety flags and forbidden fields before sanitization', () => {
  assert.equal(validateCandidateDescriptor(candidate()).length, 0);
  assertBlocks(validateCandidateDescriptor(candidate({ real_provider_called: true })), 'real_provider_called_must_be_false');
  assertBlocks(validateCandidateDescriptor(candidate({ provider_url: 'synthetic.invalid' })), 'forbidden_field::provider_url');
});

test('readiness evaluation registry blocks replay and version regression', () => {
  const registry = createTranscriptionReadinessEvaluationRegistry();
  const evaluation = evaluateTranscriptionProviderReadiness(candidate(), validReadinessContext());
  assert.equal(registry.recordEvaluation(evaluation).ok, true);
  assert.equal(registry.recordEvaluation(evaluation).blocked_reason, 'readiness_evaluation_version_regression');
  const next = { ...evaluation, readiness_evaluation_id: 'readiness_transcription_fixture_002', readiness_evaluation_version: 1 };
  assert.equal(registry.recordEvaluation(next).blocked_reason, 'readiness_evaluation_version_regression');
  const stored = registry.getEvaluation('readiness_transcription_fixture_001');
  stored.candidate_id = 'mutated';
  assert.equal(registry.getEvaluation('readiness_transcription_fixture_001').candidate_id, TRANSCRIPTION_READINESS_CANDIDATE_ID);
});

test('forbidden transcription policy fields include expanded raw media credentials urls and network sensitive names', () => {
  for (const field of ['audio', 'raw_audio', 'audio_bytes', 'buffer', 'binary', 'blob', 'base64', 'waveform', 'raw_media', 'raw_transcript', 'raw_provider_response', 'provider_response', 'token', 'api_key', 'authorization', 'headers', 'cookie', 'password', 'secret', 'secret_value', 'credential', 'endpoint', 'provider_url', 'upload_url', 'storage_url', 'signed_url', 'presigned_url']) {
    assert.ok(FORBIDDEN_TRANSCRIPTION_FIELDS.includes(field), field);
    assertBlocks(findTranscriptionForbiddenFields({ [field]: 'synthetic' }), `forbidden_field::${field}`);
  }
});

test('policy audit events are sanitized and do not include raw payloads or secrets', () => {
  const results = [
    evaluateTranscriptionConsent(consent({ token: 'never' }), { now }),
    evaluateTranscriptionRetentionPolicy(retentionPolicy({ raw_audio: 'never' }), { now }),
    evaluateTranscriptionBudgetPolicy(budgetPolicy({ endpoint: 'never' })),
    evaluateTranscriptionOperatorApproval(approval({ headers: { authorization: 'never' } }), { now }),
    evaluateTranscriptionProviderReadiness(candidate({ raw_audio: 'never' }), validReadinessContext())
  ];
  for (const result of results) {
    const auditJson = JSON.stringify(result.audit_event_candidate);
    assert.equal(/never|raw_audio|authorization|headers|token|endpoint/i.test(auditJson), false);
    assertSafeEnvelope(result);
  }
});

test('regression keeps transcription readiness out of runtime message confirm endpoint scheduler and worker surfaces', () => {
  const runtimeFiles = [
    path.join(repoRoot, 'services', 'api', 'src', 'index.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-gate.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'confirmation-response.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'intent-router.js'),
    path.join(repoRoot, 'services', 'worker', 'src', 'index.js')
  ];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('transcription-consent-policy'), false);
    assert.equal(source.includes('transcription-retention-policy'), false);
    assert.equal(source.includes('transcription-budget-policy'), false);
    assert.equal(source.includes('transcription-operator-approval-policy'), false);
    assert.equal(source.includes('transcription-provider-readiness'), false);
    assert.equal(source.includes('/transcription'), false);
  }
});

test('regression new policy modules do not call network env filesystem timers or provider APIs', () => {
  const files = [
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-consent-policy.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-retention-policy.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-budget-policy.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-operator-approval-policy.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'transcription-provider-readiness.js')
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes("require('node:http')"), false);
    assert.equal(source.includes("require('node:https')"), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('setInterval('), false);
    assert.equal(source.includes('setTimeout('), false);
    assert.equal(source.includes('.summarize('), false);
  }
});
