'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  evaluateReadOnlyAdapterReadiness,
  REQUIRED_BLOCKING_REQUIREMENTS
} = require('../src/core/read-only-adapter-readiness-gate');

const docPath = path.resolve(__dirname, '../../../docs/REAL_READ_ONLY_ADAPTER_READINESS_GATE.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-real-read-only-adapter-readiness-gate.json'
);
const indexPath = path.resolve(__dirname, '../src/index.js');
const adapterExecutionPath = path.resolve(__dirname, '../src/core/adapter-execution.js');

const REQUIRED_STATUSES = [
  'not_evaluated',
  'blocked',
  'conditionally_ready',
  'ready_for_real_read_only_pr',
  'deprecated',
  'invalid_candidate'
];

const REQUIRED_VERDICTS = [
  'allow_future_read_only_pr',
  'deny_future_read_only_pr'
];

const REQUIRED_EVIDENCE_STATUSES = [
  'satisfied',
  'missing',
  'failed',
  'unknown',
  'not_applicable'
];

const REQUIRED_CATEGORIES = [
  'identity_scope',
  'tenant_workspace',
  'provider_registry',
  'capability_registry',
  'permission_matrix',
  'permission_overlay',
  'security_boundary',
  'governance',
  'human_review',
  'mock_parity',
  'fixture_coverage',
  'contract_tests',
  'golden_scenarios',
  'audit',
  'logging_sanitization',
  'secret_management_plan',
  'oauth_scope_plan',
  'cost_controls',
  'rate_limit_controls',
  'timeout_controls',
  'retry_policy',
  'kill_switch',
  'feature_flag',
  'rollout_plan',
  'rollback_plan',
  'incident_runbook',
  'data_minimization',
  'retention_policy',
  'lgpd_review',
  'observability',
  'error_contract',
  'tenant_isolation_tests',
  'no_write_guarantee',
  'provider_specific_readiness'
];

const REQUIRED_IMMEDIATE_BLOCKS = [
  'write_allowed_true',
  'action_allowed_true',
  'send_allowed_true',
  'publish_allowed_true',
  'delete_allowed_true',
  'raw_sql_allowed',
  'writeback_allowed',
  'unrestricted_oauth_scope',
  'missing_tenant_scope',
  'prompt_controls_tenant',
  'provider_controls_tenant',
  'cross_tenant_access',
  'tokens_in_fixture',
  'tokens_in_logs',
  'tokens_in_memory',
  'raw_payload_logging',
  'raw_message_logging',
  'secrets_in_repository',
  'feature_flag_default_on',
  'kill_switch_missing',
  'timeout_missing',
  'unbounded_retry',
  'unknown_cost_risk',
  'unknown_rate_limit_risk',
  'real_call_in_contract_test',
  'production_rollout_without_canary',
  'executed_true_in_readiness',
  'real_provider_called_true_in_readiness'
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
  'GOLDEN_SCENARIOS.md',
  'DOMAIN_ONBOARDING.md',
  'OPERATOR_RUNBOOK.md'
];

function walkKeys(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visitor);
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      visitor(key, nestedValue);
      walkKeys(nestedValue, visitor);
    }
  }
}

function completeEvidence() {
  return REQUIRED_BLOCKING_REQUIREMENTS.map((requirementId) => ({
    requirement_id: requirementId,
    category: 'provider_specific_readiness',
    required: true,
    status: 'satisfied',
    evidence_refs: [`internal:${requirementId}`],
    notes: 'synthetic satisfied evidence',
    reviewer: 'reviewer_synthetic',
    reviewed_at: '2026-07-12T00:00:00.000Z',
    blocking_reason: null
  }));
}

function completeCandidate(overrides = {}) {
  return {
    trace_id: 'trace_readiness_unit',
    candidate_id: 'candidate_read_only_unit',
    provider_id: 'provider_read_only_unit',
    adapter_id: 'adapter_read_only_unit',
    provider_type: 'public_web',
    workspace_types: ['corporate'],
    tenant_strategy: 'tenant_id_required',
    domains: ['marketing'],
    capabilities: ['public_web_summary'],
    operations: ['read_summary'],
    proposed_mode: 'real_read_only_candidate',
    risk_level: 'medium',
    evidence: completeEvidence(),
    requested_by: 'reviewer_synthetic',
    simulated: true,
    executed: false,
    real_provider_called: false,
    write_allowed: false,
    action_allowed: false,
    send_allowed: false,
    publish_allowed: false,
    delete_allowed: false,
    feature_flag_default_off: true,
    kill_switch_defined: true,
    timeout_defined: true,
    retry_policy: 'disabled',
    cost_risk: 'low',
    rate_limit_risk: 'low',
    ...overrides
  };
}

function assertDeny(result, status = 'blocked') {
  if (status) {
    assert.equal(result.status, status);
  }
  assert.equal(result.verdict, 'deny_future_read_only_pr');
  assert.equal(result.ready, false);
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
}

function assertReady(result) {
  assert.equal(result.status, 'ready_for_real_read_only_pr');
  assert.equal(result.verdict, 'allow_future_read_only_pr');
  assert.equal(result.ready, true);
  assert.equal(result.simulated, true);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
  assert.deepEqual(result.blocking_requirements, []);
}

function candidateWithRequirementStatus(requirementId, status) {
  const candidate = completeCandidate();
  candidate.evidence = candidate.evidence.map((entry) => (
    entry.requirement_id === requirementId ? { ...entry, status } : entry
  ));
  return candidate;
}

test('read-only adapter readiness gate document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('read-only adapter readiness gate fixture is safe and complete', () => {
  const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const status of REQUIRED_STATUSES) assert.ok(contract.readiness_statuses.includes(status), status);
  for (const verdict of REQUIRED_VERDICTS) assert.ok(contract.verdicts.includes(verdict), verdict);
  for (const status of REQUIRED_EVIDENCE_STATUSES) assert.ok(contract.evidence_statuses.includes(status), status);
  for (const category of REQUIRED_CATEGORIES) assert.ok(contract.requirement_categories.includes(category), category);
  for (const requirement of REQUIRED_BLOCKING_REQUIREMENTS) {
    assert.ok(contract.required_blocking_requirements.includes(requirement), requirement);
  }
  for (const condition of REQUIRED_IMMEDIATE_BLOCKS) {
    assert.ok(contract.immediate_blocking_conditions.includes(condition), condition);
  }
  for (const providerClass of REQUIRED_PROVIDER_CLASSES) {
    assert.ok(contract.provider_classes.includes(providerClass), providerClass);
  }

  assert.equal(contract.default_rules.deny_by_default, true);
  assert.equal(contract.default_rules.fail_closed, true);
  assert.equal(contract.default_rules.all_required_requirements_must_be_satisfied, true);
  assert.equal(contract.default_rules.unknown_required_requirement_blocks, true);
  assert.equal(contract.default_rules.missing_required_requirement_blocks, true);
  assert.equal(contract.default_rules.failed_required_requirement_blocks, true);
  assert.equal(contract.default_rules.conditionally_ready_allows_real_provider, false);
  assert.equal(contract.default_rules.only_ready_status_can_allow_future_pr, true);
  assert.equal(contract.default_rules.read_only_only, true);
  assert.equal(contract.default_rules.write_allowed, false);
  assert.equal(contract.default_rules.action_allowed, false);
  assert.equal(contract.default_rules.send_allowed, false);
  assert.equal(contract.default_rules.publish_allowed, false);
  assert.equal(contract.default_rules.delete_allowed, false);
  assert.equal(contract.default_rules.feature_flag_default_off_required, true);
  assert.equal(contract.default_rules.kill_switch_required, true);
  assert.equal(contract.default_rules.timeout_required, true);
  assert.equal(contract.default_rules.bounded_retry_required, true);
  assert.equal(contract.default_rules.tenant_isolation_required, true);
  assert.equal(contract.default_rules.permission_matrix_required, true);
  assert.equal(contract.default_rules.permission_overlay_required, true);
  assert.equal(contract.default_rules.security_boundary_required, true);
  assert.equal(contract.default_rules.governance_review_required, true);
  assert.equal(contract.default_rules.human_review_required, true);
  assert.equal(contract.default_rules.audit_required, true);
  assert.equal(contract.default_rules.sanitized_logging_required, true);
  assert.equal(contract.default_rules.cost_risk_must_be_known, true);
  assert.equal(contract.default_rules.rate_limit_risk_must_be_known, true);
  assert.equal(contract.default_rules.mock_parity_required, true);
  assert.equal(contract.default_rules.contract_tests_required, true);
  assert.equal(contract.default_rules.rollout_plan_required, true);
  assert.equal(contract.default_rules.rollback_plan_required, true);
  assert.equal(contract.default_rules.incident_runbook_required, true);
  assert.equal(contract.default_rules.simulated, true);
  assert.equal(contract.default_rules.executed, false);
  assert.equal(contract.default_rules.real_provider_called, false);
  assert.equal(contract.default_rules.can_trigger_real_execution, false);

  for (const field of REQUIRED_FORBIDDEN_FIELDS) assert.ok(contract.forbidden_fields.includes(field), field);
  for (const reference of REQUIRED_CONTRACT_REFERENCES) {
    assert.ok(contract.required_contract_references.includes(reference), reference);
  }

  for (const example of contract.safe_evaluation_examples) {
    assert.equal(example.simulated, true, example.name);
    assert.equal(example.executed, false, example.name);
    assert.equal(example.real_provider_called, false, example.name);
    assert.equal(example.can_trigger_real_execution, false, example.name);

    walkKeys(example, (key, value) => {
      assert.equal(forbiddenFieldSet.has(key), false, `${example.name}:${key}`);
      if (typeof value === 'string') {
        assert.equal(/^https?:\/\//i.test(value), false, `${example.name}:${key}`);
      }
    });
  }
});

test('readiness gate rejects invalid candidates without throwing', () => {
  assertDeny(evaluateReadOnlyAdapterReadiness(null), 'invalid_candidate');
  assertDeny(evaluateReadOnlyAdapterReadiness({ ...completeCandidate(), candidate_id: '' }), 'invalid_candidate');
  assertDeny(evaluateReadOnlyAdapterReadiness({ ...completeCandidate(), provider_id: '' }), 'invalid_candidate');
  assertDeny(evaluateReadOnlyAdapterReadiness({ ...completeCandidate(), adapter_id: '' }), 'invalid_candidate');
  assertDeny(evaluateReadOnlyAdapterReadiness({ ...completeCandidate(), proposed_mode: 'mock_only' }), 'invalid_candidate');
  assertDeny(evaluateReadOnlyAdapterReadiness({ ...completeCandidate(), evidence: undefined }), 'invalid_candidate');
});

test('custom contracts cannot remove base requirements or immediate blockers', () => {
  const incomplete = completeCandidate({
    evidence: completeEvidence().filter((entry) => entry.requirement_id !== 'mock_adapter_exists')
  });
  const emptyContract = {
    required_blocking_requirements: [],
    immediate_blocking_conditions: []
  };
  const reducedRequiredContract = {
    required_blocking_requirements: []
  };
  const reducedImmediateContract = {
    immediate_blocking_conditions: []
  };

  const emptyContractResult = evaluateReadOnlyAdapterReadiness(incomplete, emptyContract);
  assertDeny(emptyContractResult);
  assert.ok(emptyContractResult.blocking_requirements.includes('mock_adapter_exists'));

  const reducedRequiredResult = evaluateReadOnlyAdapterReadiness(incomplete, reducedRequiredContract);
  assertDeny(reducedRequiredResult);
  assert.ok(reducedRequiredResult.blocking_requirements.includes('mock_adapter_exists'));

  const writeResult = evaluateReadOnlyAdapterReadiness(
    completeCandidate({ write_allowed: true }),
    reducedImmediateContract
  );
  assertDeny(writeResult);
  assert.ok(writeResult.blocking_requirements.includes('write_allowed_true'));
});

test('custom contracts can only add requirements and unknown conditions fail closed', () => {
  const additiveContract = {
    required_blocking_requirements: ['provider_specific_extra_review']
  };
  const missingExtra = evaluateReadOnlyAdapterReadiness(completeCandidate(), additiveContract);
  assertDeny(missingExtra);
  assert.ok(missingExtra.blocking_requirements.includes('provider_specific_extra_review'));

  const withExtra = completeCandidate({
    evidence: [
      ...completeEvidence(),
      {
        requirement_id: 'provider_specific_extra_review',
        category: 'provider_specific_readiness',
        required: true,
        status: 'satisfied',
        evidence_refs: ['internal:provider_specific_extra_review'],
        notes: 'synthetic extra evidence',
        reviewer: 'reviewer_synthetic',
        reviewed_at: '2026-07-12T00:00:00.000Z',
        blocking_reason: null
      }
    ]
  });
  assertReady(evaluateReadOnlyAdapterReadiness(withExtra, additiveContract));

  const unknownConditionResult = evaluateReadOnlyAdapterReadiness(completeCandidate(), {
    immediate_blocking_conditions: ['provider_specific_unknown_condition']
  });
  assertDeny(unknownConditionResult);
  assert.ok(
    unknownConditionResult.blocking_requirements.includes(
      'unknown_immediate_blocking_condition::provider_specific_unknown_condition'
    )
  );
});

test('forbidden candidate fields block without leaking values', () => {
  const secretValue = 'synthetic_secret_value_must_not_echo';
  const rootToken = evaluateReadOnlyAdapterReadiness(completeCandidate({ token: secretValue }));
  const nestedAccessToken = evaluateReadOnlyAdapterReadiness(completeCandidate({
    synthetic_metadata: { accessToken: secretValue }
  }));
  const nestedRawPayload = evaluateReadOnlyAdapterReadiness(completeCandidate({
    synthetic_metadata: { safe: { rawPayload: secretValue } }
  }));

  assertDeny(rootToken);
  assert.ok(rootToken.blocking_requirements.includes('forbidden_candidate_field::token'));
  assertDeny(nestedAccessToken);
  assert.ok(nestedAccessToken.blocking_requirements.includes('forbidden_candidate_field::accessToken'));
  assertDeny(nestedRawPayload);
  assert.ok(nestedRawPayload.blocking_requirements.includes('forbidden_candidate_field::rawPayload'));

  for (const result of [rootToken, nestedAccessToken, nestedRawPayload]) {
    assert.equal(JSON.stringify(result).includes(secretValue), false);
  }
});

test('structural fields are validated before evidence can satisfy readiness', () => {
  const invalidCases = [
    [{ workspace_types: undefined }, 'workspace_types_must_be_non_empty_string_array'],
    [{ workspace_types: [] }, 'workspace_types_must_be_non_empty_string_array'],
    [{ domains: undefined }, 'domains_must_be_non_empty_string_array'],
    [{ domains: [] }, 'domains_must_be_non_empty_string_array'],
    [{ capabilities: undefined }, 'capabilities_must_be_non_empty_string_array'],
    [{ capabilities: [] }, 'capabilities_must_be_non_empty_string_array'],
    [{ operations: undefined }, 'operations_must_be_non_empty_string_array'],
    [{ operations: [] }, 'operations_must_be_non_empty_string_array']
  ];

  for (const [override, expectedReason] of invalidCases) {
    const result = evaluateReadOnlyAdapterReadiness(completeCandidate(override));
    assertDeny(result, 'invalid_candidate');
    assert.ok(result.blocking_requirements.includes(expectedReason), expectedReason);
  }
});

test('write-like operations are rejected structurally', () => {
  for (const operation of ['create_record', 'send_email', 'publish_post']) {
    const result = evaluateReadOnlyAdapterReadiness(completeCandidate({ operations: [operation] }));
    assertDeny(result, 'invalid_candidate');
    assert.ok(result.blocking_requirements.includes(`blocked_operation::${operation}`), operation);
  }
});

test('fixed safety booleans are required on input and cannot be changed by custom contract', () => {
  const simulatedFalse = evaluateReadOnlyAdapterReadiness(completeCandidate({ simulated: false }));
  const executedTrue = evaluateReadOnlyAdapterReadiness(completeCandidate({ executed: true }));
  const realProviderCalledTrue = evaluateReadOnlyAdapterReadiness(completeCandidate({ real_provider_called: true }));
  const unsafeContractResult = evaluateReadOnlyAdapterReadiness(completeCandidate(), {
    default_rules: {
      simulated: false,
      executed: true,
      real_provider_called: true,
      can_trigger_real_execution: true
    },
    verdicts: ['allow_future_read_only_pr']
  });

  assertDeny(simulatedFalse, 'invalid_candidate');
  assert.ok(simulatedFalse.blocking_requirements.includes('simulated_must_be_true'));
  assertDeny(executedTrue, 'invalid_candidate');
  assert.ok(executedTrue.blocking_requirements.includes('executed_true_in_readiness'));
  assertDeny(realProviderCalledTrue, 'invalid_candidate');
  assert.ok(realProviderCalledTrue.blocking_requirements.includes('real_provider_called_true_in_readiness'));

  assertReady(unsafeContractResult);
  assert.equal(unsafeContractResult.simulated, true);
  assert.equal(unsafeContractResult.executed, false);
  assert.equal(unsafeContractResult.real_provider_called, false);
  assert.equal(unsafeContractResult.can_trigger_real_execution, false);
});

test('readiness gate blocks missing failed and unknown required requirements', () => {
  const missing = completeCandidate({
    evidence: completeEvidence().filter((entry) => entry.requirement_id !== 'mock_adapter_exists')
  });
  const failed = candidateWithRequirementStatus('contract_tests_exist', 'failed');
  const unknown = candidateWithRequirementStatus('cost_risk_known', 'unknown');

  assertDeny(evaluateReadOnlyAdapterReadiness(missing));
  assert.ok(evaluateReadOnlyAdapterReadiness(missing).blocking_requirements.includes('mock_adapter_exists'));
  assertDeny(evaluateReadOnlyAdapterReadiness(failed));
  assert.ok(evaluateReadOnlyAdapterReadiness(failed).blocking_requirements.includes('contract_tests_exist'));
  assertDeny(evaluateReadOnlyAdapterReadiness(unknown));
  assert.ok(evaluateReadOnlyAdapterReadiness(unknown).blocking_requirements.includes('cost_risk_known'));
});

test('readiness gate handles duplicate and unknown requirements deterministically', () => {
  const candidate = completeCandidate({
    evidence: [
      ...completeEvidence(),
      completeEvidence()[0],
      {
        requirement_id: 'unknown_extra_requirement',
        category: 'provider_specific_readiness',
        required: false,
        status: 'satisfied',
        evidence_refs: ['internal:unknown'],
        notes: 'unknown extra evidence',
        reviewer: 'reviewer_synthetic',
        reviewed_at: '2026-07-12T00:00:00.000Z',
        blocking_reason: null
      }
    ]
  });

  const result = evaluateReadOnlyAdapterReadiness(candidate);
  assertReady(result);
  assert.equal(result.satisfied_requirements.includes('unknown_extra_requirement'), false);
});

test('readiness gate blocks immediate unsafe conditions', () => {
  const cases = [
    ['write_allowed', true, 'write_allowed_true'],
    ['action_allowed', true, 'action_allowed_true'],
    ['send_allowed', true, 'send_allowed_true'],
    ['publish_allowed', true, 'publish_allowed_true'],
    ['delete_allowed', true, 'delete_allowed_true'],
    ['feature_flag_default_off', false, 'feature_flag_default_on'],
    ['kill_switch_defined', false, 'kill_switch_missing'],
    ['timeout_defined', false, 'timeout_missing'],
    ['cost_risk', 'unknown', 'unknown_cost_risk'],
    ['rate_limit_risk', 'unknown', 'unknown_rate_limit_risk'],
    ['real_provider_called', true, 'real_provider_called_true_in_readiness'],
    ['executed', true, 'executed_true_in_readiness']
  ];

  for (const [field, value, expectedBlock] of cases) {
    const result = evaluateReadOnlyAdapterReadiness(completeCandidate({ [field]: value }));
    assertDeny(result, null);
    assert.ok(result.blocking_requirements.includes(expectedBlock), expectedBlock);
  }
});

test('readiness gate blocks key missing controls by evidence', () => {
  const requirements = [
    'tenant_isolation_tests_exist',
    'permission_matrix_mapped',
    'permission_overlay_mapped',
    'security_boundary_mapped',
    'governance_review_completed',
    'human_review_owner_declared',
    'mock_adapter_exists',
    'contract_tests_exist',
    'rollout_plan_defined',
    'rollback_plan_defined',
    'incident_runbook_defined'
  ];

  for (const requirement of requirements) {
    const result = evaluateReadOnlyAdapterReadiness(candidateWithRequirementStatus(requirement, 'missing'));
    assertDeny(result);
    assert.ok(result.blocking_requirements.includes(requirement), requirement);
  }
});

test('complete synthetic candidate is ready only for a future PR', () => {
  const candidate = completeCandidate();
  const snapshot = JSON.stringify(candidate);
  const result = evaluateReadOnlyAdapterReadiness(candidate);

  assertReady(result);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(result.can_trigger_real_execution, false);
  assert.equal(JSON.stringify(candidate), snapshot);
});

test('readiness result does not contain forbidden fields', () => {
  const result = evaluateReadOnlyAdapterReadiness(completeCandidate());
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  walkKeys(result, (key) => {
    assert.equal(forbiddenFieldSet.has(key), false, key);
  });
});

test('readiness gate fails closed on internal error', () => {
  const badContract = {};
  Object.defineProperty(badContract, 'required_blocking_requirements', {
    get() {
      throw new Error('synthetic contract failure');
    }
  });

  const result = evaluateReadOnlyAdapterReadiness(completeCandidate(), badContract);
  assertDeny(result);
  assert.ok(result.blocking_requirements.includes('readiness_gate_internal_error'));
});

test('blocking order is deterministic and duplicate blockers are removed', () => {
  const candidate = completeCandidate({
    evidence: completeEvidence().filter((entry) => ![
      'mock_adapter_exists',
      'contract_tests_exist'
    ].includes(entry.requirement_id)),
    write_allowed: true
  });
  const first = evaluateReadOnlyAdapterReadiness(candidate);
  const second = evaluateReadOnlyAdapterReadiness(candidate);

  assert.deepEqual(first.blocking_requirements, second.blocking_requirements);
  assert.deepEqual(first.blocking_requirements, [...new Set(first.blocking_requirements)]);
  assert.deepEqual(first.blocking_requirements, [...first.blocking_requirements].sort());
});

test('readiness gate is not imported by runtime entrypoint or adapter executor', () => {
  const indexSource = fs.readFileSync(indexPath, 'utf8');
  const adapterExecutionSource = fs.readFileSync(adapterExecutionPath, 'utf8');

  assert.equal(indexSource.includes('read-only-adapter-readiness-gate'), false);
  assert.equal(adapterExecutionSource.includes('read-only-adapter-readiness-gate'), false);
  assert.match(indexSource, /\/message/);
  assert.match(indexSource, /\/confirm/);
  assert.match(adapterExecutionSource, /planAdapterExecution/);
});
