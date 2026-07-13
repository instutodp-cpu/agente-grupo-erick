'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONFIGURATION_STATUSES,
  CONFIGURATION_READINESS_STATUSES,
  SECRET_REFERENCE_TYPES,
  ENVIRONMENT_POLICIES,
  ERROR_CODES,
  REQUIRED_PROVIDER_CONFIGURATION_FIELDS,
  REQUIRED_SECRET_REFERENCE_FIELDS,
  REQUIRED_AUDIT_FIELDS,
  validateProviderConfiguration,
  validateSecretReference,
  validateConfigurationReadiness,
  findConfigurationForbiddenFields,
  sanitizeConfigurationData,
  buildConfigurationAuditEventCandidate
} = require('../src/core/provider-configuration-contract');
const {
  createProviderConfigurationRegistry
} = require('../src/core/provider-configuration-registry');

const repoRoot = path.resolve(__dirname, '../../..');
const docPath = path.join(repoRoot, 'docs', 'REAL_PROVIDER_CONFIGURATION_BOUNDARY.md');
const fixturePath = path.join(__dirname, 'fixtures', 'hermes-provider-configuration-boundary.json');
const now = '2026-07-13T12:00:00.000Z';
const future = '2030-01-01T00:00:00.000Z';
const past = '2020-01-01T00:00:00.000Z';

function fixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function validSecretRef(overrides = {}) {
  return {
    secret_ref_id: 'secret_ref_public_web_candidate',
    secret_ref_type: 'manual_fixture_ref',
    provider_id: 'provider_public_web_candidate',
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    scope: 'read_only_candidate',
    status: 'referenced_only',
    created_at: now,
    last_rotated_at: now,
    rotation_due_at: future,
    expires_at: future,
    metadata: {
      label: 'synthetic_reference_only'
    },
    ...overrides
  };
}

function validConfig(overrides = {}) {
  const base = {
    configuration_id: 'config_public_web_candidate',
    provider_id: 'provider_public_web_candidate',
    provider_type: 'public_web',
    adapter_id: 'adapter_public_web_mock',
    connector_id: 'connector_public_web',
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    environment: 'non_production_fixture',
    configuration_status: 'configuration_registered',
    configuration_version: 1,
    readiness_status: 'configuration_ready_for_mock_binding',
    secret_refs: [validSecretRef()],
    feature_flag_key: 'feature.provider.public_web.fixture',
    feature_flag_default: false,
    kill_switch_key: 'kill.provider.public_web.fixture',
    rotation: {
      rotation_required: true,
      next_rotation_due_at: future,
      status: 'rotation_not_due'
    },
    expiration: {
      expires_at: future,
      status: 'active'
    },
    tenant_policy: 'corporate_grupo_erick',
    workspace_policy: {
      allowed_workspace_types: ['corporate']
    },
    environment_policy: {
      provider_calls_allowed: false,
      provider_sdk_allowed: false,
      runtime_environment_secret_allowed: false,
      secret_references_only: true
    },
    secret_policy: {
      plaintext_secrets_allowed: false,
      secret_creation_allowed: false,
      secret_values_allowed: false,
      secret_references_only: true
    },
    owner_id: 'owner_fixture',
    reviewer_ids: ['reviewer_fixture'],
    created_at: now,
    updated_at: now,
    deprecated: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    metadata: {
      source: 'synthetic_fixture'
    }
  };
  const config = {
    ...base,
    ...overrides
  };
  if (!overrides.secret_refs && (overrides.provider_id || overrides.workspace_type || overrides.tenant_id)) {
    config.secret_refs = [
      validSecretRef({
        provider_id: config.provider_id,
        workspace_type: config.workspace_type,
        tenant_id: config.tenant_id
      })
    ];
  }
  return config;
}

function validChange(overrides = {}) {
  return {
    trace_id: 'trace_configuration_change',
    change_id: 'change_001',
    configuration_id: 'config_public_web_candidate',
    expected_version: 1,
    actor_id: 'operator_fixture',
    actor_role: 'platform_operator',
    reason: 'contract_boundary_fixture_update',
    requested_at: now,
    simulated: true,
    executed: false,
    real_provider_called: false,
    ...overrides
  };
}

function assertNoForbiddenKeys(value, forbiddenFields) {
  const found = [];
  function visit(entry) {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    for (const [key, nested] of Object.entries(entry)) {
      if (forbiddenFields.includes(key)) found.push(key);
      visit(nested);
    }
  }
  visit(value);
  assert.deepEqual([...new Set(found)].sort(), []);
}

test('provider configuration contract document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('fixture exposes required contract lists and safe defaults', () => {
  const data = fixture();
  for (const status of CONFIGURATION_STATUSES) assert.ok(data.configuration_statuses.includes(status));
  for (const status of CONFIGURATION_READINESS_STATUSES) assert.ok(data.configuration_readiness_statuses.includes(status));
  for (const type of SECRET_REFERENCE_TYPES) assert.ok(data.secret_reference_types.includes(type));
  for (const policy of ENVIRONMENT_POLICIES) assert.ok(data.environment_policies.includes(policy));
  for (const code of ERROR_CODES) assert.ok(data.error_codes.includes(code));
  for (const field of REQUIRED_PROVIDER_CONFIGURATION_FIELDS) assert.ok(data.required_provider_configuration_fields.includes(field));
  for (const field of REQUIRED_SECRET_REFERENCE_FIELDS) assert.ok(data.required_secret_reference_fields.includes(field));
  for (const field of REQUIRED_AUDIT_FIELDS) assert.ok(data.required_audit_fields.includes(field));
  assert.equal(data.default_rules.deny_by_default, true);
  assert.equal(data.default_rules.fail_closed, true);
  assert.equal(data.default_rules.private_registry_storage, true);
  assert.equal(data.default_rules.no_plaintext_secrets, true);
  assert.equal(data.default_rules.no_runtime_environment_provider_secrets, true);
  assert.equal(data.default_rules.provider_calls_allowed, false);
  assert.equal(data.default_rules.oauth_implemented, false);
  assert.equal(data.default_rules.feature_flag_default_off, true);
  assert.equal(data.default_rules.kill_switch_required, true);
  assert.equal(data.default_rules.simulated, true);
  assert.equal(data.default_rules.executed, false);
  assert.equal(data.default_rules.real_provider_called, false);
  assert.equal(data.default_rules.can_trigger_real_execution, false);
  assert.ok(data.required_contract_references.includes('CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md'));
});

test('valid provider configuration and secret reference pass validation', () => {
  const config = validConfig();
  assert.deepEqual(validateProviderConfiguration(config, { now }).errors, []);
  assert.equal(validateProviderConfiguration(config, { now }).valid, true);
  assert.equal(validateSecretReference(config.secret_refs[0], config, { now }).valid, true);
  assert.equal(validateConfigurationReadiness(config, { now }).ready, true);
});

test('invalid and incomplete provider configurations fail closed', () => {
  assert.equal(validateProviderConfiguration(null, { now }).valid, false);
  assert.ok(validateProviderConfiguration({ ...validConfig(), provider_id: '' }, { now }).errors.includes('invalid_provider_id'));
  assert.ok(validateProviderConfiguration({ ...validConfig(), secret_refs: [] }, { now }).errors.includes('secret_refs_required'));
  assert.ok(validateProviderConfiguration({ ...validConfig(), feature_flag_default: true }, { now }).errors.includes('feature_flag_default_must_be_false'));
  assert.ok(validateProviderConfiguration({ ...validConfig(), kill_switch_key: '' }, { now }).errors.includes('invalid_kill_switch_key'));
});

test('invalid secret references and provider registry mismatch block readiness', () => {
  const config = validConfig({
    secret_refs: [validSecretRef({ secret_ref_type: 'plaintext' })]
  });
  assert.ok(validateProviderConfiguration(config, { now }).errors.includes('secret_ref_type_not_allowed'));
  const missingProvider = validateProviderConfiguration(validConfig(), {
    now,
    providerRegistry: {
      hasProvider() {
        return false;
      }
    }
  });
  assert.ok(missingProvider.errors.includes('provider_not_registered'));
});

test('tenant and workspace policies block mismatches', () => {
  assert.ok(validateProviderConfiguration(validConfig({ tenant_id: 'client::other' }), { now }).errors.includes('corporate_tenant_required'));
  assert.ok(validateProviderConfiguration(validConfig({
    workspace_type: 'personal',
    tenant_id: 'grupo_erick',
    workspace_policy: { allowed_workspace_types: ['corporate'] }
  }), { now }).errors.includes('corporate_workspace_required'));
  const external = validConfig({
    configuration_id: 'config_client_fixture',
    workspace_type: 'external_client',
    tenant_id: 'client::client_a',
    client_id: 'client_b',
    tenant_policy: 'external_client_tenant',
    workspace_policy: { allowed_workspace_types: ['external_client'] }
  });
  assert.ok(validateProviderConfiguration(external, { now }).errors.includes('external_client_tenant_mismatch'));
});

test('environment policy, rotation, and expiration are enforced', () => {
  assert.ok(validateProviderConfiguration(validConfig({
    environment_policy: {
      provider_calls_allowed: true,
      provider_sdk_allowed: false,
      runtime_environment_secret_allowed: false,
      secret_references_only: true
    }
  }), { now }).errors.includes('provider_calls_must_be_disabled'));
  assert.ok(validateProviderConfiguration(validConfig({
    rotation: {
      rotation_required: true,
      next_rotation_due_at: past,
      status: 'rotation_overdue'
    }
  }), { now }).errors.includes('rotation_due_or_expired'));
  assert.ok(validateProviderConfiguration(validConfig({
    expiration: {
      expires_at: past,
      status: 'expired'
    }
  }), { now }).errors.includes('configuration_expired'));
});

test('forbidden fields are detected recursively and sanitized without values', () => {
  const unsafe = {
    ok: true,
    nested: {
      accessToken: 'do-not-return',
      rawConfig: {
        privateKey: 'also-secret'
      }
    }
  };
  assert.deepEqual(findConfigurationForbiddenFields(unsafe), [
    'forbidden_field::accessToken',
    'forbidden_field::rawConfig'
  ]);
  const sanitized = sanitizeConfigurationData(unsafe);
  assert.equal(JSON.stringify(sanitized).includes('do-not-return'), false);
  assert.equal(JSON.stringify(sanitized).includes('also-secret'), false);
  assert.deepEqual(sanitized, { ok: true, nested: {} });
  assert.equal(unsafe.nested.accessToken, 'do-not-return');
});

test('configuration registry is private, frozen, and defensively cloned', () => {
  const registry = createProviderConfigurationRegistry();
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(registry._configurations, undefined);
  assert.equal(Object.keys(registry).includes('_configurations'), false);
  assert.throws(() => {
    registry.registerConfiguration = () => ({ ok: true });
  }, TypeError);

  assert.equal(registry.registerConfiguration(validConfig(), { now }).ok, true);
  const snapshot = registry.getConfiguration('config_public_web_candidate');
  snapshot.metadata.source = 'mutated';
  assert.equal(registry.getConfiguration('config_public_web_candidate').metadata.source, 'synthetic_fixture');
  const listed = registry.listConfigurations();
  listed[0].provider_id = 'mutated';
  assert.equal(registry.getConfiguration('config_public_web_candidate').provider_id, 'provider_public_web_candidate');
});

test('configuration registry rejects invalid, duplicate, and invalid initial records', () => {
  const registry = createProviderConfigurationRegistry();
  assert.equal(registry.registerConfiguration(validConfig(), { now }).ok, true);
  assert.equal(registry.registerConfiguration(validConfig(), { now }).error_code, 'DUPLICATE_CONFIGURATION');
  assert.equal(registry.registerConfiguration(validConfig({ configuration_id: 'bad', feature_flag_default: true }), { now }).ok, false);
  assert.throws(() => createProviderConfigurationRegistry({
    initialConfigurations: [validConfig({ configuration_id: 'bad-initial', feature_flag_default: true })],
    context: { now }
  }), /INVALID_INITIAL_PROVIDER_CONFIGURATION/);
});

test('configuration change applies once and replay is blocked without duplicate history', () => {
  const registry = createProviderConfigurationRegistry();
  assert.equal(registry.registerConfiguration(validConfig(), { now }).ok, true);
  const next = validConfig({
    updated_at: '2026-07-13T12:05:00.000Z',
    metadata: {
      source: 'synthetic_fixture_updated'
    }
  });
  const applied = registry.applyConfigurationChange(validChange(), next, {
    now,
    clock: () => '2026-07-13T12:05:00.000Z'
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.new_version, 2);
  assert.equal(applied.executed, false);
  assert.equal(applied.real_provider_called, false);
  assert.equal(applied.can_trigger_real_execution, false);
  assert.equal(registry.getConfigurationHistory('config_public_web_candidate').length, 1);

  const replay = registry.applyConfigurationChange(validChange(), next, {
    now,
    clock: () => '2026-07-13T12:06:00.000Z'
  });
  assert.equal(replay.applied, false);
  assert.equal(replay.error.error_code, 'REPLAYED_CONFIGURATION_CHANGE');
  assert.equal(registry.getConfiguration('config_public_web_candidate').configuration_version, 2);
  assert.equal(registry.getConfigurationHistory('config_public_web_candidate').length, 1);
});

test('configuration change version conflict and bounded history are deterministic', () => {
  const registry = createProviderConfigurationRegistry({ maxHistoryPerConfiguration: 2 });
  assert.equal(registry.registerConfiguration(validConfig(), { now }).ok, true);
  const first = registry.applyConfigurationChange(validChange({ change_id: 'change_a' }), validConfig({ updated_at: '2026-07-13T12:01:00.000Z' }), { now, clock: () => '2026-07-13T12:01:00.000Z' });
  assert.equal(first.applied, true);
  const conflict = registry.applyConfigurationChange(validChange({ change_id: 'change_b', expected_version: 1 }), validConfig({ updated_at: '2026-07-13T12:02:00.000Z' }), { now, clock: () => '2026-07-13T12:02:00.000Z' });
  assert.equal(conflict.applied, false);
  assert.equal(conflict.error.error_code, 'VERSION_CONFLICT');
  const second = registry.applyConfigurationChange(validChange({ change_id: 'change_c', expected_version: 2 }), validConfig({ updated_at: '2026-07-13T12:03:00.000Z' }), { now, clock: () => '2026-07-13T12:03:00.000Z' });
  assert.equal(second.applied, true);
  const history = registry.getConfigurationHistory('config_public_web_candidate');
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((event) => event.change_id), ['change_a', 'change_c']);
  history[0].provider_id = 'mutated';
  assert.notEqual(registry.getConfigurationHistory('config_public_web_candidate')[0].provider_id, 'mutated');
  assert.throws(() => createProviderConfigurationRegistry({ maxHistoryPerConfiguration: 0 }), /INVALID_CONFIGURATION_HISTORY_LIMIT/);
});

test('audit candidates are sanitized and never contain configuration payloads', () => {
  const audit = buildConfigurationAuditEventCandidate({
    trace_id: 'trace_audit',
    change_id: 'change_audit',
    configuration_id: 'config_public_web_candidate',
    provider_id: 'provider_public_web_candidate',
    adapter_id: 'adapter_public_web_mock',
    connector_id: 'connector_public_web',
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    status: 'configuration_registered',
    applied: true,
    previous_version: 1,
    new_version: 2,
    actor_id: 'operator_fixture',
    actor_role: 'platform_operator',
    occurred_at: now
  });
  for (const field of REQUIRED_AUDIT_FIELDS) assert.ok(Object.prototype.hasOwnProperty.call(audit, field));
  assert.equal(audit.simulated, true);
  assert.equal(audit.executed, false);
  assert.equal(audit.real_provider_called, false);
  assert.equal(audit.can_trigger_real_execution, false);
  assertNoForbiddenKeys(audit, fixture().forbidden_fields);
  assert.equal(Object.prototype.hasOwnProperty.call(audit, 'configuration'), false);
});

test('new provider configuration modules do not use external provider mechanisms', () => {
  const files = [
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'provider-configuration-contract.js'),
    path.join(repoRoot, 'services', 'api', 'src', 'core', 'provider-configuration-registry.js')
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes('process.env'), false);
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('axios'), false);
  }
  const indexSource = fs.readFileSync(path.join(repoRoot, 'services', 'api', 'src', 'index.js'), 'utf8');
  assert.equal(indexSource.includes('provider-configuration-registry'), false);
  assert.equal(indexSource.includes('provider-configuration-contract'), false);
});
