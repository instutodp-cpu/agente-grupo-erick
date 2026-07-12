'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ADAPTER_LIFECYCLE_STATUSES,
  ADAPTER_KINDS,
  EXECUTION_STATUSES,
  ERROR_CODES,
  REQUIRED_ADAPTER_METADATA_FIELDS,
  REQUIRED_REQUEST_FIELDS,
  REQUIRED_RESPONSE_FIELDS,
  BLOCKED_OPERATION_TERMS,
  FORBIDDEN_FIELDS,
  validateAdapterMetadata,
  validateAdapterRequest,
  findForbiddenFields
} = require('../src/core/read-only-adapter-contract');
const {
  createReadOnlyAdapterRegistry
} = require('../src/core/read-only-adapter-registry');
const {
  executeReadOnlyAdapter
} = require('../src/core/read-only-adapter-runtime');
const {
  metadata,
  mockResponse,
  mock_success_adapter,
  mock_timeout_adapter,
  mock_throw_adapter,
  mock_unsafe_response_adapter,
  real_candidate_adapter,
  real_adapter_forbidden_test
} = require('./helpers/read-only-test-adapters');

const docPath = path.resolve(__dirname, '../../../docs/READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md');
const fixturePath = path.resolve(__dirname, 'fixtures/hermes-read-only-adapter-interface-runtime.json');
const indexPath = path.resolve(__dirname, '../src/index.js');
const adapterExecutionPath = path.resolve(__dirname, '../src/core/adapter-execution.js');
const mockRunnerPath = path.resolve(__dirname, '../src/core/mock-adapter-runner.js');

function assertIncludesAll(actual, expected) {
  for (const item of expected) assert.ok(actual.includes(item), `missing ${item}`);
}

function request(overrides = {}) {
  return {
    trace_id: 'trace_runtime_unit',
    request_id: 'request_runtime_unit',
    adapter_id: 'mock_success_adapter',
    provider_id: 'manual_fixture_provider',
    provider_class: 'public_web',
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    user_id: 'user_synthetic',
    role: 'operator',
    company_id: 'company_synthetic',
    store_id: 'store_synthetic',
    client_id: '',
    domain: 'marketing',
    capability: 'public_web_summary',
    operation: 'read_summary',
    input: { query_hint: 'synthetic' },
    input_classification: 'synthetic',
    requested_at: '2026-07-12T00:00:00.000Z',
    simulated: true,
    executed: false,
    real_provider_called: false,
    write_allowed: false,
    action_allowed: false,
    send_allowed: false,
    publish_allowed: false,
    delete_allowed: false,
    ...overrides
  };
}

function registryWith(...adapters) {
  const registry = createReadOnlyAdapterRegistry();
  for (const adapter of adapters) {
    const result = registry.registerAdapter(adapter);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  return registry;
}

function runtimeOptions(overrides = {}) {
  let now = 1000;
  return {
    featureFlagResolver: () => true,
    killSwitchResolver: () => false,
    clock: () => {
      now += 5;
      return now;
    },
    ...overrides
  };
}

function readyReadiness(overrides = {}) {
  return {
    candidate_id: 'candidate_real_read_only',
    provider_id: 'future_provider_candidate',
    adapter_id: 'real_candidate_adapter',
    status: 'ready_for_real_read_only_pr',
    verdict: 'allow_future_read_only_pr',
    ready: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocking_requirements: [],
    blocking_reasons: [],
    ...overrides
  };
}

function assertSafeEnvelope(result) {
  assert.equal(result.simulated, true);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
  assert.ok(result.audit_event_candidate);
  assert.equal(result.audit_event_candidate.real_provider_called, false);
  const json = JSON.stringify(result);
  for (const field of FORBIDDEN_FIELDS) {
    assert.equal(json.includes(`"${field}"`), false, `result leaked forbidden field ${field}`);
  }
}

test('read-only adapter interface runtime document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('read-only adapter interface runtime fixture is complete', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assertIncludesAll(fixture.adapter_lifecycle_statuses, ADAPTER_LIFECYCLE_STATUSES);
  assertIncludesAll(fixture.adapter_kinds, ADAPTER_KINDS);
  assertIncludesAll(fixture.execution_statuses, EXECUTION_STATUSES);
  assertIncludesAll(fixture.error_codes, ERROR_CODES);
  assertIncludesAll(fixture.required_adapter_metadata_fields, REQUIRED_ADAPTER_METADATA_FIELDS);
  assertIncludesAll(fixture.required_request_fields, REQUIRED_REQUEST_FIELDS);
  assertIncludesAll(fixture.required_response_fields, REQUIRED_RESPONSE_FIELDS);
  assertIncludesAll(fixture.blocked_operation_terms, BLOCKED_OPERATION_TERMS);
  assertIncludesAll(fixture.forbidden_fields, FORBIDDEN_FIELDS);
  assertIncludesAll(fixture.runtime_pipeline_steps, [
    'validate_adapter_registration',
    'validate_request_envelope',
    'validate_forbidden_fields',
    'validate_workspace',
    'validate_tenant',
    'validate_capability',
    'validate_operation',
    'validate_adapter_kind',
    'validate_feature_flag',
    'validate_kill_switch',
    'validate_readiness_state',
    'execute_mock_adapter',
    'validate_response',
    'sanitize_response',
    'build_audit_event_candidate',
    'return_envelope'
  ]);
  assert.equal(fixture.default_rules.mock_only_execution_in_this_pr, true);
  assert.equal(fixture.default_rules.real_adapter_execution_allowed, false);
  assert.equal(fixture.default_rules.real_provider_calls_allowed, false);
  assert.equal(fixture.default_rules.feature_flag_default_off, true);
  assert.equal(fixture.default_rules.kill_switch_required, true);
  assert.equal(fixture.default_rules.audit_event_required, true);
});

test('metadata validation blocks unsafe metadata', () => {
  assert.equal(validateAdapterMetadata(metadata()).valid, true);
  assert.ok(validateAdapterMetadata(metadata({ adapter_id: '' })).errors.includes('invalid_adapter_id'));
  assert.ok(validateAdapterMetadata(metadata({ provider_id: '' })).errors.includes('invalid_provider_id'));
  assert.ok(validateAdapterMetadata(metadata({ version: '' })).errors.includes('invalid_version'));
  assert.ok(validateAdapterMetadata(metadata({ supported_workspace_types: [] })).errors.includes('invalid_supported_workspace_types'));
  assert.ok(validateAdapterMetadata(metadata({ supported_domains: [] })).errors.includes('invalid_supported_domains'));
  assert.ok(validateAdapterMetadata(metadata({ supported_capabilities: [] })).errors.includes('invalid_supported_capabilities'));
  assert.ok(validateAdapterMetadata(metadata({ supported_operations: [] })).errors.includes('invalid_supported_operations'));
  assert.ok(validateAdapterMetadata(metadata({ supported_operations: ['create_record'] })).errors.includes('blocked_operation::create_record'));
  assert.ok(validateAdapterMetadata(metadata({ timeout_ms: 0 })).errors.includes('timeout_ms_out_of_bounds'));
  assert.ok(validateAdapterMetadata(metadata({ retry_policy: { strategy: 'unbounded', max_attempts: 99 } })).errors.includes('retry_policy_unbounded'));
  assert.ok(validateAdapterMetadata(metadata({ feature_flag_key: '' })).errors.includes('invalid_feature_flag_key'));
  assert.ok(validateAdapterMetadata(real_adapter_forbidden_test.metadata).errors.includes('real_read_only_not_allowed_in_this_pr'));
});

test('registry registers valid adapters and protects internal state', () => {
  const registry = createReadOnlyAdapterRegistry();
  assert.equal(registry.registerAdapter(mock_success_adapter).ok, true);
  assert.equal(registry.hasAdapter('mock_success_adapter'), true);
  assert.equal(registry.listAdapters().length, 1);
  assert.equal(registry.getAdapter('mock_success_adapter').metadata.adapter_id, 'mock_success_adapter');
  assert.equal(registry.registerAdapter(mock_success_adapter).ok, false);
  assert.equal(registry.registerAdapter({ metadata: metadata({ adapter_id: '' }) }).ok, false);
  const returned = registry.getAdapter('mock_success_adapter');
  returned.metadata.adapter_id = 'mutated';
  assert.equal(registry.getAdapter('mock_success_adapter').metadata.adapter_id, 'mock_success_adapter');
  assert.equal(registry.registerAdapter(real_candidate_adapter).ok, true);
  assert.equal(registry.registerAdapter(real_adapter_forbidden_test).ok, false);
  assert.equal(registry.unregisterAdapter('mock_success_adapter').removed, true);
  assert.equal(registry.hasAdapter('mock_success_adapter'), false);
});

test('request validation blocks invalid fields and write operations', () => {
  assert.equal(validateAdapterRequest(request()).valid, true);
  assert.ok(validateAdapterRequest(null).errors.includes('request_must_be_object'));
  assert.ok(validateAdapterRequest(request({ trace_id: '' })).errors.includes('invalid_trace_id'));
  assert.ok(validateAdapterRequest(request({ request_id: '' })).errors.includes('invalid_request_id'));
  assert.ok(validateAdapterRequest(request({ workspace_type: '' })).errors.includes('invalid_workspace_type'));
  assert.ok(validateAdapterRequest(request({ tenant_id: '' })).errors.includes('invalid_tenant_id'));
  assert.ok(validateAdapterRequest(request({ user_id: '' })).errors.includes('invalid_user_id'));
  assert.ok(validateAdapterRequest(request({ domain: '' })).errors.includes('invalid_domain'));
  assert.ok(validateAdapterRequest(request({ capability: '' })).errors.includes('invalid_capability'));
  assert.ok(validateAdapterRequest(request({ operation: '' })).errors.includes('invalid_operation'));
  assert.ok(validateAdapterRequest(request({ token: 'nope' })).errors.includes('forbidden_field::token'));
  assert.ok(validateAdapterRequest(request({ input: { nested: { accessToken: 'nope' } } })).errors.includes('forbidden_field::accessToken'));
  assert.ok(validateAdapterRequest(request({ write_allowed: true })).errors.includes('write_allowed_must_be_false'));
  assert.ok(validateAdapterRequest(request({ action_allowed: true })).errors.includes('action_allowed_must_be_false'));
  assert.ok(validateAdapterRequest(request({ send_allowed: true })).errors.includes('send_allowed_must_be_false'));
  assert.ok(validateAdapterRequest(request({ publish_allowed: true })).errors.includes('publish_allowed_must_be_false'));
  assert.ok(validateAdapterRequest(request({ delete_allowed: true })).errors.includes('delete_allowed_must_be_false'));
  for (const operation of ['create_record', 'send_email', 'publish_post', 'merge_pr']) {
    assert.ok(validateAdapterRequest(request({ operation })).errors.includes(`blocked_operation::${operation}`));
  }
});

test('runtime blocks missing adapter and disabled adapter', async () => {
  const missing = await executeReadOnlyAdapter(request(), runtimeOptions({ registry: createReadOnlyAdapterRegistry() }));
  assert.equal(missing.status, 'adapter_not_registered');
  assert.equal(missing.error.error_code, 'ADAPTER_NOT_REGISTERED');
  assertSafeEnvelope(missing);

  const disabled = {
    ...mock_success_adapter,
    metadata: metadata({ enabled: false })
  };
  const result = await executeReadOnlyAdapter(request(), runtimeOptions({ registry: registryWith(disabled) }));
  assert.equal(result.status, 'adapter_disabled');
  assert.equal(result.error.error_code, 'ADAPTER_DISABLED');
});

test('runtime validates identity scopes tenant and operation declarations', async () => {
  const registry = registryWith(mock_success_adapter);
  const cases = [
    [request({ adapter_id: 'other_adapter' }), 'adapter_not_registered', 'ADAPTER_NOT_REGISTERED'],
    [request({ provider_id: 'other_provider' }), 'adapter_validation_failed', 'INVALID_ADAPTER_REQUEST'],
    [request({ provider_class: 'other_class' }), 'adapter_validation_failed', 'INVALID_ADAPTER_REQUEST'],
    [request({ workspace_type: 'personal' }), 'adapter_workspace_blocked', 'WORKSPACE_NOT_ALLOWED'],
    [request({ domain: 'financeiro' }), 'adapter_operation_blocked', 'CAPABILITY_NOT_SUPPORTED'],
    [request({ capability: 'unknown' }), 'adapter_operation_blocked', 'CAPABILITY_NOT_SUPPORTED'],
    [request({ operation: 'get_other_summary' }), 'adapter_operation_blocked', 'OPERATION_NOT_SUPPORTED'],
    [request({ tenant_id: 'other' }), 'adapter_tenant_blocked', 'TENANT_SCOPE_INVALID']
  ];

  for (const [candidate, status, code] of cases) {
    const result = await executeReadOnlyAdapter(candidate, runtimeOptions({ registry }));
    assert.equal(result.status, status);
    assert.equal(result.error.error_code, code);
    assertSafeEnvelope(result);
  }
});

test('runtime validates tenant strategies', async () => {
  const personalAdapter = { ...mock_success_adapter, metadata: metadata({
    adapter_id: 'personal_adapter',
    tenant_strategy: 'personal_user_tenant',
    supported_workspace_types: ['personal'],
    readiness_candidate_id: 'candidate_personal',
    feature_flag_key: 'flag_personal'
  }) };
  const externalAdapter = { ...mock_success_adapter, metadata: metadata({
    adapter_id: 'external_adapter',
    tenant_strategy: 'external_client_tenant',
    supported_workspace_types: ['external_client'],
    readiness_candidate_id: 'candidate_external',
    feature_flag_key: 'flag_external'
  }) };
  const registry = registryWith(personalAdapter, externalAdapter);

  const personalBad = await executeReadOnlyAdapter(request({
    adapter_id: 'personal_adapter',
    workspace_type: 'personal',
    tenant_id: 'personal::other_user'
  }), runtimeOptions({ registry }));
  assert.equal(personalBad.status, 'adapter_tenant_blocked');

  const externalMissing = await executeReadOnlyAdapter(request({
    adapter_id: 'external_adapter',
    workspace_type: 'external_client',
    tenant_id: 'client::client_a',
    client_id: ''
  }), runtimeOptions({ registry }));
  assert.equal(externalMissing.status, 'adapter_tenant_blocked');

  const externalBad = await executeReadOnlyAdapter(request({
    adapter_id: 'external_adapter',
    workspace_type: 'external_client',
    tenant_id: 'client::client_b',
    client_id: 'client_a'
  }), runtimeOptions({ registry }));
  assert.equal(externalBad.status, 'adapter_tenant_blocked');
});

test('runtime enforces feature flag kill switch and readiness binding', async () => {
  const registry = registryWith(mock_success_adapter, real_candidate_adapter);
  const featureOff = await executeReadOnlyAdapter(request(), { registry });
  assert.equal(featureOff.status, 'adapter_feature_flag_off');
  assert.equal(featureOff.error.error_code, 'FEATURE_FLAG_OFF');

  const kill = await executeReadOnlyAdapter(request(), runtimeOptions({
    registry,
    killSwitchResolver: () => true
  }));
  assert.equal(kill.status, 'adapter_kill_switch_active');
  assert.equal(kill.error.error_code, 'KILL_SWITCH_ACTIVE');

  const realRequest = request({
    adapter_id: 'real_candidate_adapter',
    provider_id: 'future_provider_candidate'
  });
  const noReadiness = await executeReadOnlyAdapter(realRequest, runtimeOptions({ registry }));
  assert.equal(noReadiness.status, 'adapter_readiness_required');
  assert.equal(noReadiness.error.error_code, 'READINESS_REQUIRED');

  for (const readiness of [
    { ready: true },
    readyReadiness({ verdict: undefined }),
    readyReadiness({ candidate_id: undefined }),
    readyReadiness({ adapter_id: 'other_adapter' }),
    readyReadiness({ provider_id: 'other_provider' }),
    readyReadiness({ candidate_id: 'other_candidate' }),
    readyReadiness({ blocking_requirements: ['missing_control'] }),
    readyReadiness({ blocking_reasons: ['blocked'] }),
    readyReadiness({ executed: true })
  ]) {
    const result = await executeReadOnlyAdapter(realRequest, runtimeOptions({
      registry,
      readinessEvaluator: () => readiness
    }));
    assert.equal(result.status, 'adapter_readiness_required');
    assert.equal(result.error.error_code, 'READINESS_REQUIRED');
    assert.equal(result.executed, false);
  }

  const readyButStillBlocked = await executeReadOnlyAdapter(realRequest, runtimeOptions({
    registry,
    readinessEvaluator: () => readyReadiness()
  }));
  assert.equal(readyButStillBlocked.status, 'adapter_kind_not_allowed');
  assert.equal(readyButStillBlocked.executed, false);
});

test('runtime executes only local mock adapters and returns safe audit', async () => {
  const registry = registryWith(mock_success_adapter);
  const originalRequest = request();
  const originalMetadata = JSON.stringify(mock_success_adapter.metadata);
  const result = await executeReadOnlyAdapter(originalRequest, runtimeOptions({ registry }));
  assert.equal(result.status, 'adapter_mock_success');
  assert.equal(result.executed, true);
  assert.equal(result.simulated, true);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
  assert.equal(result.audit_event_candidate.event_name, 'read_only_adapter_runtime_evaluated');
  assert.equal(JSON.stringify(result.audit_event_candidate).includes('query_hint'), false);
  assert.equal(JSON.stringify(result.audit_event_candidate).includes('Synthetic sanitized result'), false);
  assert.deepEqual(originalRequest, request());
  assert.equal(JSON.stringify(mock_success_adapter.metadata), originalMetadata);
  assertSafeEnvelope(result);
});

test('runtime handles timeout throw unsafe and invalid mock responses safely', async () => {
  const timeout = await executeReadOnlyAdapter(request({ adapter_id: 'mock_timeout_adapter' }), runtimeOptions({
    registry: registryWith(mock_timeout_adapter),
    timeoutRunner: () => Promise.resolve({ __adapter_timeout: true })
  }));
  assert.equal(timeout.status, 'adapter_timeout');
  assert.equal(timeout.error.error_code, 'ADAPTER_TIMEOUT');

  const thrown = await executeReadOnlyAdapter(request({ adapter_id: 'mock_throw_adapter' }), runtimeOptions({
    registry: registryWith(mock_throw_adapter)
  }));
  assert.equal(thrown.status, 'adapter_internal_error_safe');
  assert.equal(thrown.error.error_code, 'INTERNAL_ADAPTER_ERROR');
  assert.equal(JSON.stringify(thrown).includes('synthetic adapter failure'), false);

  const unsafe = await executeReadOnlyAdapter(request({ adapter_id: 'mock_unsafe_response_adapter' }), runtimeOptions({
    registry: registryWith(mock_unsafe_response_adapter)
  }));
  assert.equal(unsafe.status, 'adapter_contract_violation');
  assert.equal(unsafe.error.error_code, 'UNSAFE_ADAPTER_RESPONSE');
  assert.equal(JSON.stringify(unsafe).includes('never-return-this'), false);

  const invalidAdapter = {
    ...mock_success_adapter,
    metadata: metadata({ adapter_id: 'invalid_response_adapter', readiness_candidate_id: 'candidate_invalid_response' }),
    execute: () => mockResponse({ status: 'not_a_status' })
  };
  const invalid = await executeReadOnlyAdapter(request({ adapter_id: 'invalid_response_adapter' }), runtimeOptions({
    registry: registryWith(invalidAdapter)
  }));
  assert.equal(invalid.status, 'adapter_contract_violation');
  assert.equal(invalid.error.error_code, 'INVALID_ADAPTER_RESPONSE');
});

test('runtime does not expose forbidden field values', async () => {
  const result = await executeReadOnlyAdapter(request({
    input: { nested: { rawPayload: 'do-not-leak' } }
  }), runtimeOptions({ registry: registryWith(mock_success_adapter) }));
  assert.equal(result.status, 'adapter_validation_failed');
  assert.equal(result.error.error_code, 'FORBIDDEN_FIELD_DETECTED');
  assert.equal(JSON.stringify(result).includes('do-not-leak'), false);
  assert.ok(findForbiddenFields({ nested: { rawPayload: 'do-not-leak' } }).includes('forbidden_field::rawPayload'));
});

test('new runtime is not imported by current production flow modules', () => {
  for (const filePath of [indexPath, adapterExecutionPath, mockRunnerPath]) {
    const source = fs.readFileSync(filePath, 'utf8');
    assert.equal(source.includes('read-only-adapter-runtime'), false);
    assert.equal(source.includes('read-only-adapter-registry'), false);
  }
});
