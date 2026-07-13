'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONFIGURATION_STATUSES,
  CONFIGURATION_READINESS_STATUSES,
  SECRET_REFERENCE_TYPES,
  RESOLVABLE_SECRET_REFERENCE_TYPES,
  REQUIRED_PROVIDER_CONFIGURATION_FIELDS,
  REQUIRED_SECRET_REFERENCE_FIELDS,
  REQUIRED_AUDIT_FIELDS,
  FORBIDDEN_FIELDS,
  validateProviderConfiguration,
  validateInitialConfigurationState,
  validateSecretReference,
  findConfigurationForbiddenFields,
  sanitizeConfigurationData
} = require('../src/core/provider-configuration-contract');
const {
  createProviderConfigurationRegistry
} = require('../src/core/provider-configuration-registry');
const {
  createProviderSecretReferenceRegistry
} = require('../src/core/provider-secret-reference-registry');
const {
  createLocalTestSecretResolver
} = require('../src/core/provider-secret-resolver');
const {
  evaluateProviderConfigurationReadiness
} = require('../src/core/provider-configuration-readiness');
const {
  createReadOnlyAdapterRegistry
} = require('../src/core/read-only-adapter-registry');
const {
  mockLifecycleAdapter
} = require('./helpers/connector-lifecycle-test-data');

const repoRoot = path.resolve(__dirname, '../../..');
const docPath = path.join(repoRoot, 'docs', 'REAL_PROVIDER_CONFIGURATION_BOUNDARY.md');
const fixturePath = path.join(__dirname, 'fixtures', 'hermes-provider-configuration-boundary.json');
const now = '2026-07-13T12:00:00.000Z';
const future = '2030-01-01T00:00:00.000Z';
const past = '2020-01-01T00:00:00.000Z';

function fixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function validReference(overrides = {}) {
  return {
    reference_id: 'secretref_public_web_local_test',
    reference_type: 'local_test_double_reference',
    provider_id: 'manual_fixture_provider',
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
    required_secret_names: ['public_web_fixture_api_key'],
    metadata: {
      label: 'synthetic reference',
      purpose: 'local test only',
      classification: 'synthetic',
      synthetic_note: 'no credential value'
    },
    ...overrides
  };
}

function validConfig(overrides = {}) {
  return {
    configuration_id: 'config_public_web_local_test',
    connector_id: 'connector_public_web_fixture',
    provider_id: 'manual_fixture_provider',
    provider_type: 'public_web',
    adapter_id: 'mock_lifecycle_adapter',
    readiness_candidate_id: 'candidate_lifecycle_public_web',
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    organization_id: 'grupo_erick',
    client_id: 'not_applicable',
    environment: 'local_test',
    configuration_status: 'descriptor_registered',
    configuration_version: 1,
    readiness_status: 'not_ready',
    secret_reference_descriptors: [
      {
        reference_id: 'secretref_public_web_local_test',
        reference_type: 'local_test_double_reference'
      }
    ],
    secret_reference_type: 'local_test_double_reference',
    required_secret_names: ['public_web_fixture_api_key'],
    required_scopes: ['read_public_metadata'],
    allowed_operations: ['read_summary', 'list_summary'],
    rotation_policy: {
      next_rotation_due_at: future
    },
    expiration_policy: {
      expires_at: future
    },
    revocation_policy: {
      revocable: true
    },
    risk_level: 'low',
    cost_risk: 'low',
    rate_limit_risk: 'low',
    data_classification: 'synthetic',
    contract_refs: ['REAL_PROVIDER_CONFIGURATION_BOUNDARY.md'],
    feature_flag_key: 'provider.config.public_web.local_test',
    feature_flag_default: false,
    kill_switch_key: 'kill.provider.config.public_web.local_test',
    kill_switch_required: true,
    owner_id: 'owner_synthetic',
    created_at: now,
    updated_at: now,
    deprecated: false,
    disabled: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    metadata: {
      label: 'synthetic descriptor'
    },
    ...overrides
  };
}

function validChange(overrides = {}) {
  return {
    trace_id: 'trace_configuration_change',
    change_id: 'change_001',
    configuration_id: 'config_public_web_local_test',
    operation: 'register_synthetic_reference',
    expected_version: 1,
    actor_id: 'operator_fixture',
    actor_role: 'platform_operator',
    reason: 'synthetic configuration state transition',
    requested_at: now,
    simulated: true,
    executed: false,
    real_provider_called: false,
    ...overrides
  };
}

function readyLifecycleRegistry(overrides = {}) {
  return {
    getConnector() {
      return {
        connector_id: 'connector_public_web_fixture',
        provider_id: 'manual_fixture_provider',
        adapter_id: 'mock_lifecycle_adapter',
        readiness_candidate_id: 'candidate_lifecycle_public_web',
        workspace_types: ['corporate'],
        tenant_strategy: 'corporate_grupo_erick',
        lifecycle_state: 'readiness_passed',
        real_provider_enabled: false,
        feature_flag_default: false,
        kill_switch_key: 'kill.connector.lifecycle.public_web',
        ...overrides
      };
    }
  };
}

function assertNoForbiddenKeys(value) {
  const found = [];
  function visit(entry) {
    if (Array.isArray(entry)) return entry.forEach(visit);
    if (!entry || typeof entry !== 'object') return;
    for (const [key, nested] of Object.entries(entry)) {
      if (FORBIDDEN_FIELDS.includes(key)) found.push(key);
      visit(nested);
    }
  }
  visit(value);
  assert.deepEqual([...new Set(found)].sort(), []);
}

test('provider configuration boundary document, fixture and modules exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
  for (const file of [
    'provider-configuration-contract.js',
    'provider-configuration-registry.js',
    'provider-secret-reference-registry.js',
    'provider-secret-resolver.js',
    'provider-configuration-readiness.js'
  ]) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'core', file)), true);
  }
});

test('fixture exposes official states, types, fields and defaults', () => {
  const data = fixture();
  for (const status of CONFIGURATION_STATUSES) assert.ok(data.configuration_statuses.includes(status));
  for (const status of CONFIGURATION_READINESS_STATUSES) assert.ok(data.configuration_readiness_statuses.includes(status));
  for (const type of SECRET_REFERENCE_TYPES) assert.ok([
    ...data.resolvable_secret_reference_types_this_phase,
    ...data.future_secret_reference_types_blocked_this_phase
  ].includes(type));
  for (const type of RESOLVABLE_SECRET_REFERENCE_TYPES) assert.ok(data.resolvable_secret_reference_types_this_phase.includes(type));
  for (const field of REQUIRED_PROVIDER_CONFIGURATION_FIELDS) assert.ok(data.required_provider_configuration_fields.includes(field));
  for (const field of REQUIRED_SECRET_REFERENCE_FIELDS) assert.ok(data.required_secret_reference_fields.includes(field));
  for (const field of REQUIRED_AUDIT_FIELDS) assert.ok(data.required_audit_fields.includes(field));
  assert.equal(data.default_rules.only_local_test_double_reference_resolvable, true);
  assert.equal(data.default_rules.production_resolution_allowed, false);
  assert.equal(data.default_rules.identity_mutation_allowed, false);
  assert.equal(data.default_rules.provider_calls_allowed, false);
  assert.equal(data.default_rules.executed, false);
  assert.equal(data.required_contract_references.includes('REAL_PROVIDER_CONFIGURATION_BOUNDARY.md'), true);
});

test('configuration and secret reference validation enforce safe descriptors only', () => {
  assert.equal(validateProviderConfiguration(validConfig(), { now }).valid, true);
  assert.equal(validateInitialConfigurationState(validConfig()).length, 0);
  assert.equal(validateSecretReference(validReference(), { now }).valid, true);
  assert.ok(validateProviderConfiguration(validConfig({ configuration_status: 'structurally_ready', readiness_status: 'configuration_structurally_ready' }), { now }).valid);
  assert.ok(validateInitialConfigurationState(validConfig({ configuration_status: 'structurally_ready', readiness_status: 'configuration_structurally_ready' })).includes('initial_configuration_status_must_be_descriptor_registered'));
  assert.ok(validateInitialConfigurationState(validConfig({ configuration_status: 'expired' })).includes('initial_configuration_status_must_be_descriptor_registered'));
  assert.ok(validateInitialConfigurationState(validConfig({ configuration_status: 'deprecated', deprecated: true })).includes('initial_configuration_status_must_be_descriptor_registered'));
});

test('unsupported secret types, production, unknown fields, unsafe scopes and operations are blocked', () => {
  assert.ok(validateSecretReference(validReference({ reference_type: 'aws_secrets_manager_reference' }), { now }).errors.includes('unsupported_in_current_phase'));
  assert.ok(validateSecretReference(validReference({ environment: 'production' }), { now }).errors.includes('secret_reference_environment_must_be_local_test'));
  assert.ok(validateSecretReference({ ...validReference(), vaultPath: 'secret/path' }, { now }).errors.includes('secret_reference_unknown_field::vaultPath'));
  assert.ok(validateSecretReference({ ...validReference(), metadata: { label: 'ok', secretArn: 'arn-value' } }, { now }).errors.includes('secret_reference_metadata_unknown_field::secretArn'));
  assert.ok(validateProviderConfiguration(validConfig({ required_scopes: ['admin'] }), { now }).errors.includes('blocked_scope::admin'));
  assert.ok(validateProviderConfiguration(validConfig({ allowed_operations: ['create_record'] }), { now }).errors.includes('unsafe_operation::create_record'));
});

test('forbidden fields are detected and sanitized recursively', () => {
  const unsafe = {
    nested: {
      accessToken: 'never',
      secret_value: 'never',
      safe: 'yes'
    }
  };
  assert.deepEqual(findConfigurationForbiddenFields(unsafe), ['forbidden_field::accessToken', 'forbidden_field::secret_value']);
  const sanitized = sanitizeConfigurationData(unsafe);
  assert.equal(JSON.stringify(sanitized).includes('never'), false);
  assert.deepEqual(sanitized, { nested: { safe: 'yes' } });
});

test('secret reference registry is private, frozen, versioned and blocks advanced initial states', () => {
  const registry = createProviderSecretReferenceRegistry();
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(registry._references, undefined);
  assert.equal(registry.registerSecretReference(validReference(), { now }).ok, true);
  assert.equal(registry.registerSecretReference(validReference(), { now }).ok, false);
  const snapshot = registry.getSecretReference('secretref_public_web_local_test');
  snapshot.metadata.label = 'mutated';
  assert.equal(registry.getSecretReference('secretref_public_web_local_test').metadata.label, 'synthetic reference');
  assert.throws(() => createProviderSecretReferenceRegistry({
    initialReferences: [validReference({ status: 'structurally_ready' })],
    context: { now }
  }), /INVALID_INITIAL_SECRET_REFERENCE/);
});

test('secret reference registry supports revocation, disabling, rotation and replay protection', () => {
  const registry = createProviderSecretReferenceRegistry({ initialReferences: [validReference()], context: { now } });
  const req = {
    trace_id: 'trace_ref',
    change_id: 'ref_change_1',
    reference_id: 'secretref_public_web_local_test',
    expected_version: 1,
    actor_id: 'operator',
    actor_role: 'operator',
    reason: 'synthetic revocation',
    requested_at: now,
    simulated: true,
    executed: false,
    real_provider_called: false
  };
  const revoked = registry.markReferenceRevoked(req);
  assert.equal(revoked.applied, true);
  assert.equal(registry.getSecretReference('secretref_public_web_local_test').status, 'revoked');
  const replay = registry.markReferenceRevoked(req);
  assert.equal(replay.applied, false);
  assert.equal(registry.getReferenceHistory('secretref_public_web_local_test').length, 1);
});

test('local test resolver resolves only synthetic local test references and never exposes values publicly', () => {
  const resolver = createLocalTestSecretResolver();
  const reference = validReference();
  assert.equal(resolver.canResolve(reference), true);
  const resolved = resolver.resolveReference(reference, { environment: 'local_test' });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.secret_handle, 'opaque_test_handle::secretref_public_web_local_test');
  assert.equal(resolved.exportable, false);
  assert.equal(resolver.resolveReference(reference, { environment: 'production' }).resolved, false);
  assert.equal(resolver.resolveReference(validReference({ reference_type: 'aws_secrets_manager_reference' })).ready, false);
});

test('configuration registry blocks direct advanced state registration and operational delete', () => {
  const registry = createProviderConfigurationRegistry();
  assert.equal(registry.registerConfiguration(validConfig(), { now }).ok, true);
  assert.equal(registry.registerConfiguration(validConfig({ configuration_id: 'config_ready', configuration_status: 'structurally_ready', readiness_status: 'configuration_structurally_ready' }), { now }).error_code, 'INITIAL_CONFIGURATION_STATE_NOT_ALLOWED');
  assert.throws(() => createProviderConfigurationRegistry({ initialConfigurations: [validConfig({ configuration_status: 'structurally_ready', readiness_status: 'configuration_structurally_ready' })], context: { now } }), /INVALID_INITIAL_PROVIDER_CONFIGURATION/);
  assert.equal(registry.unregisterConfiguration('config_public_web_local_test').removed, true);

  const operational = createProviderConfigurationRegistry();
  operational.registerConfiguration(validConfig(), { now });
  operational.applyConfigurationChange(validChange(), {}, { now, clock: () => now });
  assert.equal(operational.unregisterConfiguration('config_public_web_local_test').removed, false);
});

test('configuration registry state machine, replay and identity immutability are enforced', () => {
  const registry = createProviderConfigurationRegistry({ initialConfigurations: [validConfig()], context: { now } });
  const applied = registry.applyConfigurationChange(validChange(), {}, { now, clock: () => now });
  assert.equal(applied.applied, true);
  assert.equal(applied.current_status, 'reference_pending');
  assert.equal(applied.executed, false);
  assert.equal(applied.real_provider_called, false);
  const replay = registry.applyConfigurationChange(validChange(), {}, { now, clock: () => now });
  assert.equal(replay.applied, false);
  assert.equal(replay.error.error_code, 'REPLAYED_CONFIGURATION_REQUEST');
  assert.equal(registry.getConfigurationHistory('config_public_web_local_test').length, 1);

  const identity = registry.applyConfigurationChange(validChange({
    change_id: 'change_identity',
    operation: 'register_synthetic_reference',
    expected_version: 2
  }), { provider_id: 'other_provider' }, { now, clock: () => now });
  assert.equal(identity.applied, false);
  assert.equal(identity.error.error_code, 'CONFIGURATION_IDENTITY_MUTATION_BLOCKED');
});

test('configuration registry marks failed request IDs as processed', () => {
  const registry = createProviderConfigurationRegistry({ initialConfigurations: [validConfig()], context: { now } });
  const conflict = registry.applyConfigurationChange(validChange({ change_id: 'conflict', expected_version: 99 }), {}, { now, clock: () => now });
  assert.equal(conflict.error.error_code, 'VERSION_CONFLICT');
  const replay = registry.applyConfigurationChange(validChange({ change_id: 'conflict', expected_version: 99 }), {}, { now, clock: () => now });
  assert.equal(replay.error.error_code, 'REPLAYED_CONFIGURATION_REQUEST');
});

test('configuration readiness validates lifecycle, adapter and secret bindings', () => {
  const secretReferenceRegistry = createProviderSecretReferenceRegistry({ initialReferences: [validReference()], context: { now } });
  const secretResolver = createLocalTestSecretResolver();
  const adapterRegistry = createReadOnlyAdapterRegistry([mockLifecycleAdapter()]);
  const result = evaluateProviderConfigurationReadiness(validConfig({
    configuration_status: 'validation_pending',
    configuration_version: 3
  }), {
    now,
    lifecycleRegistry: readyLifecycleRegistry(),
    adapterRegistry,
    secretReferenceRegistry,
    secretResolver,
    trace_id: 'trace_readiness',
    clock: () => now
  });
  assert.equal(result.ready, true);
  assert.equal(result.status, 'configuration_structurally_ready');
  assert.equal(result.secret_resolution_performed, false);
  assert.equal(result.secret_value_exposed, false);
  assert.equal(JSON.stringify(result).includes('opaque_test_handle'), false);
  assertNoForbiddenKeys(result);
});

test('configuration readiness blocks invalid bindings and unsafe references', () => {
  const secretReferenceRegistry = createProviderSecretReferenceRegistry({ initialReferences: [validReference()], context: { now } });
  secretReferenceRegistry.markRotationRequired({
    trace_id: 'trace_ref_rotation',
    change_id: 'ref_rotation_change',
    reference_id: 'secretref_public_web_local_test',
    expected_version: 1,
    actor_id: 'operator',
    actor_role: 'operator',
    reason: 'synthetic rotation required',
    requested_at: now,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
  const result = evaluateProviderConfigurationReadiness(validConfig(), {
    now,
    lifecycleRegistry: readyLifecycleRegistry({ lifecycle_state: 'candidate' }),
    adapterRegistry: createReadOnlyAdapterRegistry([mockLifecycleAdapter({ metadata: { provider_id: 'other_provider' } })]),
    secretReferenceRegistry,
    secretResolver: createLocalTestSecretResolver(),
    trace_id: 'trace_blocked',
    clock: () => now
  });
  assert.equal(result.ready, false);
  assert.ok(result.blocking_reasons.some((reason) => reason.startsWith('lifecycle_state_not_eligible')));
  assert.ok(result.blocking_reasons.includes('adapter_provider_id_mismatch'));
  assert.ok(result.blocking_reasons.includes('secret_reference_rotation_required'));
});

test('new modules do not use provider runtime mechanisms or current runtime imports', () => {
  const files = [
    'provider-configuration-contract.js',
    'provider-configuration-registry.js',
    'provider-secret-reference-registry.js',
    'provider-secret-resolver.js',
    'provider-configuration-readiness.js'
  ].map((file) => path.join(repoRoot, 'services', 'api', 'src', 'core', file));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes("require('node:fs')"), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
  }
  for (const file of ['index.js', 'read-only-adapter-runtime.js', 'connector-runtime-registry.js']) {
    const source = fs.readFileSync(path.join(repoRoot, 'services', 'api', 'src', file === 'index.js' ? file : `core/${file}`), 'utf8');
    assert.equal(source.includes('provider-configuration-readiness'), false);
    assert.equal(source.includes('provider-secret-resolver'), false);
    assert.equal(source.includes('provider-secret-reference-registry'), false);
  }
});
