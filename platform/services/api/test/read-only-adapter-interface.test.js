'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ADAPTER_INTERFACE_STATUSES,
  RUNTIME_MODES,
  PROVIDER_CLASSES,
  REQUIRED_ADAPTER_FIELDS,
  REQUIRED_REQUEST_FIELDS,
  REQUIRED_RESPONSE_FIELDS,
  FORBIDDEN_FIELDS,
  DEFAULT_RULES,
  validateReadOnlyAdapterDescriptor,
  validateReadOnlyAdapterRequest,
  buildReadOnlyAdapterResponse,
  planReadOnlyAdapterRuntime,
  collectForbiddenFields
} = require('../src/core/read-only-adapter-interface');

const docPath = path.resolve(__dirname, '../../../docs/READ_ONLY_ADAPTER_INTERFACE_RUNTIME_CONTRACT.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-read-only-adapter-interface-runtime-contract.json'
);
const indexPath = path.resolve(__dirname, '../src/index.js');
const adapterExecutionPath = path.resolve(__dirname, '../src/core/adapter-execution.js');

const REQUIRED_STATUSES = [
  'interface_not_evaluated',
  'interface_valid',
  'interface_invalid',
  'runtime_plan_created',
  'runtime_blocked',
  'runtime_error_safe'
];

const REQUIRED_RUNTIME_MODES = [
  'disabled',
  'contract_only',
  'mock_only',
  'read_only_candidate',
  'readiness_required',
  'blocked_by_readiness',
  'blocked_by_runtime_policy',
  'blocked_by_input_contract',
  'safe_runtime_plan'
];

const REQUIRED_PROVIDER_CLASSES = [
  'public_web',
  'transcription',
  'internal_business_api',
  'personal_connector',
  'corporate_connector',
  'external_client_connector',
  'development_connector',
  'other_read_only'
];

const REQUIRED_FORBIDDEN_FIELDS = [
  'token',
  'secret',
  'env',
  'headers',
  'cookies',
  'credentials',
  'payload',
  'rawPayload',
  'rawMessage',
  'userMessage',
  'requiredAdapters',
  'authorization',
  'password',
  'stackTrace',
  'apiKey',
  'accessToken',
  'refreshToken',
  'requestBody',
  'responseBody',
  'rawSql',
  'rawQuery',
  'rawDatabasePayload',
  'rawSocialPayload',
  'rawTranscript',
  'rawAudio',
  'privateUrl',
  'webhookSecret'
];

const REQUIRED_CONTRACT_REFERENCES = [
  'REAL_READ_ONLY_ADAPTER_READINESS_GATE.md',
  'TENANT_WORKSPACE_ISOLATION.md',
  'EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md',
  'INTEGRATION_SECURITY_BOUNDARY.md',
  'EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md',
  'EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md',
  'EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md',
  'PUBLIC_WEB_READ_ONLY_SANDBOX.md',
  'TRANSCRIPTION_INTAKE_SANDBOX.md',
  'INTERNAL_BUSINESS_API_READ_ONLY.md',
  'PERSONAL_WORKSPACE_CONNECTOR_POLICY.md',
  'EXTERNAL_CLIENT_WORKSPACE_CONNECTOR_POLICY.md',
  'CORPORATE_WORKSPACE_CONNECTOR_POLICY.md',
  'SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md',
  'GOVERNANCE_CHECK_REPORT.md',
  'PERMISSION_MATRIX.md',
  'OPERATOR_RUNBOOK.md'
];

function assertIncludesAll(actual, expected) {
  for (const item of expected) {
    assert.ok(actual.includes(item), `missing ${item}`);
  }
}

function completeAdapter(overrides = {}) {
  return {
    adapter_id: 'adapter_public_web_fixture_read',
    provider_id: 'public_web_manual_fixture',
    provider_type: 'manual_fixture',
    provider_class: 'public_web',
    runtime_mode: 'contract_only',
    workspace_types: ['corporate'],
    tenant_strategy: 'tenant_id_required',
    domains: ['marketing'],
    capabilities: ['public_web_summary'],
    operations: ['read_summary'],
    output_contract: 'safe_summary_only',
    error_contract: 'safe_error_response',
    write_allowed: false,
    action_allowed: false,
    send_allowed: false,
    publish_allowed: false,
    delete_allowed: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    ...overrides
  };
}

function completeRequest(overrides = {}) {
  return {
    trace_id: 'trace_interface_unit',
    workspace_type: 'corporate',
    tenant_id: 'grupo_erick',
    user_id: 'user_synthetic_unit',
    adapter_id: 'adapter_public_web_fixture_read',
    provider_id: 'public_web_manual_fixture',
    provider_class: 'public_web',
    domain: 'marketing',
    capability: 'public_web_summary',
    operation: 'read_summary',
    sanitized_input: {
      query_hint: 'synthetic public summary'
    },
    simulated: true,
    executed: false,
    real_provider_called: false,
    ...overrides
  };
}

function readyReadiness() {
  return {
    candidate_id: 'candidate_interface_unit',
    provider_id: 'public_web_manual_fixture',
    adapter_id: 'adapter_public_web_fixture_read',
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

function assertFixedRuntimeFlags(result) {
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
}

test('read-only adapter interface document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('read-only adapter interface fixture is safe and complete', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  assertIncludesAll(fixture.adapter_interface_statuses, REQUIRED_STATUSES);
  assertIncludesAll(fixture.runtime_modes, REQUIRED_RUNTIME_MODES);
  assertIncludesAll(fixture.provider_classes, REQUIRED_PROVIDER_CLASSES);
  assertIncludesAll(fixture.required_adapter_fields, REQUIRED_ADAPTER_FIELDS);
  assertIncludesAll(fixture.required_request_fields, REQUIRED_REQUEST_FIELDS);
  assertIncludesAll(fixture.required_response_fields, REQUIRED_RESPONSE_FIELDS);
  assertIncludesAll(fixture.forbidden_fields, REQUIRED_FORBIDDEN_FIELDS);
  assertIncludesAll(fixture.required_contract_references, REQUIRED_CONTRACT_REFERENCES);

  assert.equal(fixture.default_rules.contract_only, true);
  assert.equal(fixture.default_rules.read_only_only, true);
  assert.equal(fixture.default_rules.runtime_registration_allowed, false);
  assert.equal(fixture.default_rules.adapter_invocation_allowed, false);
  assert.equal(fixture.default_rules.real_provider_calls_allowed, false);
  assert.equal(fixture.default_rules.write_allowed, false);
  assert.equal(fixture.default_rules.action_allowed, false);
  assert.equal(fixture.default_rules.send_allowed, false);
  assert.equal(fixture.default_rules.publish_allowed, false);
  assert.equal(fixture.default_rules.delete_allowed, false);
  assert.equal(fixture.default_rules.simulated, true);
  assert.equal(fixture.default_rules.executed, false);
  assert.equal(fixture.default_rules.real_provider_called, false);
  assert.equal(fixture.default_rules.can_trigger_real_execution, false);

  for (const example of fixture.safe_runtime_examples) {
    assert.equal(example.adapter.write_allowed, false);
    assert.equal(example.adapter.action_allowed, false);
    assert.equal(example.adapter.send_allowed, false);
    assert.equal(example.adapter.publish_allowed, false);
    assert.equal(example.adapter.delete_allowed, false);
    assert.equal(example.adapter.simulated, true);
    assert.equal(example.adapter.executed, false);
    assert.equal(example.adapter.real_provider_called, false);
    assert.equal(example.adapter.can_trigger_real_execution, false);
    assert.equal(example.request.simulated, true);
    assert.equal(example.request.executed, false);
    assert.equal(example.request.real_provider_called, false);
  }
});

test('runtime constants match contract defaults', () => {
  assertIncludesAll(ADAPTER_INTERFACE_STATUSES, REQUIRED_STATUSES);
  assertIncludesAll(RUNTIME_MODES, REQUIRED_RUNTIME_MODES);
  assertIncludesAll(PROVIDER_CLASSES, REQUIRED_PROVIDER_CLASSES);
  assertIncludesAll(FORBIDDEN_FIELDS, REQUIRED_FORBIDDEN_FIELDS);

  assert.equal(DEFAULT_RULES.contract_only, true);
  assert.equal(DEFAULT_RULES.runtime_registration_allowed, false);
  assert.equal(DEFAULT_RULES.adapter_invocation_allowed, false);
  assert.equal(DEFAULT_RULES.real_provider_calls_allowed, false);
  assert.equal(DEFAULT_RULES.executed, false);
  assert.equal(DEFAULT_RULES.real_provider_called, false);
  assert.equal(DEFAULT_RULES.can_trigger_real_execution, false);
});

test('valid descriptor and request pass structural validation', () => {
  assert.equal(validateReadOnlyAdapterDescriptor(completeAdapter()).valid, true);
  assert.equal(validateReadOnlyAdapterRequest(completeRequest()).valid, true);
});

test('descriptor blocks missing fields, unsafe modes and write-like operations', () => {
  const missing = validateReadOnlyAdapterDescriptor(completeAdapter({ adapter_id: '' }));
  assert.equal(missing.valid, false);
  assert.ok(missing.errors.includes('missing_adapter_id'));

  const invalidMode = validateReadOnlyAdapterDescriptor(completeAdapter({ runtime_mode: 'real_enabled' }));
  assert.equal(invalidMode.valid, false);
  assert.ok(invalidMode.errors.includes('runtime_mode_not_allowed'));

  const writeOperation = validateReadOnlyAdapterDescriptor(completeAdapter({ operations: ['create_record'] }));
  assert.equal(writeOperation.valid, false);
  assert.ok(writeOperation.errors.includes('write_like_operation::create_record'));
});

test('request blocks unsafe flags, write-like operations and invalid booleans', () => {
  const writeOperation = validateReadOnlyAdapterRequest(completeRequest({ operation: 'send_email' }));
  assert.equal(writeOperation.valid, false);
  assert.ok(writeOperation.errors.includes('write_like_operation::send_email'));

  const executed = validateReadOnlyAdapterRequest(completeRequest({ executed: true }));
  assert.equal(executed.valid, false);
  assert.ok(executed.errors.includes('executed_not_false'));

  const realProvider = validateReadOnlyAdapterRequest(completeRequest({ real_provider_called: true }));
  assert.equal(realProvider.valid, false);
  assert.ok(realProvider.errors.includes('real_provider_called_not_false'));
});

test('forbidden fields are detected recursively without leaking values', () => {
  const candidate = completeRequest({
    sanitized_input: {
      nested: {
        accessToken: 'do-not-return-this-value',
        rawPayload: 'do-not-return-this-value'
      }
    }
  });

  const found = collectForbiddenFields(candidate);
  assert.deepEqual(found, ['forbidden_field::accessToken', 'forbidden_field::rawPayload']);

  const validation = validateReadOnlyAdapterRequest(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('forbidden_field::accessToken'));
  assert.equal(JSON.stringify(validation).includes('do-not-return-this-value'), false);
});

test('response builder forces fixed safety flags', () => {
  const response = buildReadOnlyAdapterResponse({
    ...completeRequest(),
    status: 'runtime_plan_created',
    simulated: false,
    executed: true,
    real_provider_called: true,
    can_trigger_real_execution: true
  });

  assertFixedRuntimeFlags(response);
  assert.equal(response.status, 'runtime_plan_created');
});

test('runtime plan never allows adapter invocation or real provider calls', () => {
  const plan = planReadOnlyAdapterRuntime({
    adapter: completeAdapter(),
    request: completeRequest(),
    readiness: readyReadiness()
  });

  assert.equal(plan.status, 'safe_runtime_plan');
  assert.equal(plan.interface_ready, true);
  assert.equal(plan.execution_allowed, false);
  assert.equal(plan.adapter_invocation_allowed, false);
  assert.equal(plan.real_provider_calls_allowed, false);
  assert.equal(plan.write_allowed, false);
  assert.equal(plan.action_allowed, false);
  assert.equal(plan.send_allowed, false);
  assert.equal(plan.publish_allowed, false);
  assert.equal(plan.delete_allowed, false);
  assertFixedRuntimeFlags(plan);
  assertFixedRuntimeFlags(plan.response_contract);
});

test('runtime plan blocks when readiness is absent or request is unsafe', () => {
  const noReadiness = planReadOnlyAdapterRuntime({
    adapter: completeAdapter(),
    request: completeRequest(),
    readiness: { status: 'blocked', ready: false }
  });
  assert.equal(noReadiness.status, 'runtime_blocked');
  assert.equal(noReadiness.interface_ready, false);
  assert.ok(noReadiness.blocking_reasons.includes('readiness_not_ready_for_future_pr'));

  const unsafe = planReadOnlyAdapterRuntime({
    adapter: completeAdapter(),
    request: completeRequest({ operation: 'publish_post' }),
    readiness: readyReadiness()
  });
  assert.equal(unsafe.status, 'runtime_blocked');
  assert.equal(unsafe.interface_ready, false);
  assert.ok(unsafe.blocking_reasons.includes('request::write_like_operation::publish_post'));
});

test('read-only adapter interface is not imported by runtime entrypoint or adapter executor', () => {
  const indexSource = fs.readFileSync(indexPath, 'utf8');
  const adapterExecutionSource = fs.readFileSync(adapterExecutionPath, 'utf8');

  assert.equal(indexSource.includes('read-only-adapter-interface'), false);
  assert.equal(adapterExecutionSource.includes('read-only-adapter-interface'), false);
});
