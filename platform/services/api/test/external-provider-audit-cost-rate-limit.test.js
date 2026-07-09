'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(
  __dirname,
  '../../../docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md',
);
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-external-provider-audit-cost-rate-limit.json',
);

const REQUIRED_AUDIT_FIELDS = [
  'trace_id',
  'event_id',
  'event_type',
  'provider_id',
  'provider_type',
  'domain',
  'capability',
  'adapter_mode',
  'provider_permission_state',
  'risk_level',
  'status',
  'simulated',
  'executed',
  'real_provider_called',
  'can_trigger_real_execution',
  'read_allowed',
  'write_allowed',
  'action_allowed',
  'human_review_required',
  'governance_review_required',
  'confirmation_required',
  'confirmation_id',
  'cost_risk',
  'rate_limit_risk',
  'estimated_cost_units',
  'budget_scope',
  'rate_limit_scope',
  'fallback_policy',
  'stop_condition',
  'blocked_reason',
  'error_code',
  'timestamp',
];

const REQUIRED_EVENT_TYPES = [
  'external_provider_mock_requested',
  'external_provider_mock_completed',
  'external_provider_mock_blocked',
  'external_provider_cost_estimated',
  'external_provider_rate_limit_checked',
  'external_provider_fallback_selected',
  'external_provider_stop_condition_triggered',
  'external_provider_governance_review_required',
  'external_provider_human_review_required',
  'external_provider_real_call_blocked',
];

const REQUIRED_RISK_LEVELS = ['none', 'low', 'medium', 'high', 'critical', 'unknown'];

const REQUIRED_BUDGET_SCOPES = [
  'provider',
  'provider_type',
  'domain',
  'tenant',
  'user',
  'environment',
  'daily',
  'monthly',
  'per_request',
];

const REQUIRED_RATE_LIMIT_SCOPES = [
  'provider',
  'provider_type',
  'domain',
  'tenant',
  'user',
  'environment',
  'per_minute',
  'per_hour',
  'per_day',
];

const REQUIRED_FALLBACK_POLICIES = [
  'no_fallback',
  'safe_mock_fallback',
  'cached_safe_summary_candidate',
  'manual_review_required',
  'provider_disabled',
  'stop_and_report',
  'retry_later_not_automatic',
];

const REQUIRED_STOP_CONDITIONS = [
  'cost_unknown',
  'budget_missing',
  'rate_limit_unknown',
  'provider_not_registered',
  'permission_overlay_blocked',
  'security_boundary_blocked',
  'governance_review_missing',
  'human_review_missing',
  'forbidden_field_detected',
  'raw_content_detected',
  'real_provider_call_attempted',
  'write_action_attempted',
  'cross_tenant_user_domain_risk',
  'repeated_safe_errors',
  'provider_deprecated',
];

const REQUIRED_PROVIDER_TYPES = [
  'public_web_scraping',
  'app_integration_hub',
  'transcription_provider',
  'social_media_provider',
  'direct_platform_api',
  'internal_business_api',
  'internal_mcp_server',
  'developer_platform',
];

const REQUIRED_BLOCKING_RULES = [
  'real_provider_called_true',
  'executed_true',
  'write_allowed_true',
  'action_allowed_true',
  'external_api_call_attempted',
  'automatic_retry_real_call',
  'missing_budget_scope',
  'missing_rate_limit_risk',
  'cost_risk_unknown_for_sandbox',
  'rate_limit_unknown_for_sandbox',
  'fallback_calls_real_provider',
  'forbidden_field_logged',
  'raw_payload_or_message_logged',
  'raw_content_storage_attempted',
  'missing_retention_policy',
  'cross_tenant_user_domain_leakage',
  'kill_switch_removed',
  'confirmation_gate_removed',
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
  'rawTranscript',
  'rawAudio',
  'rawHtml',
  'privateUrl',
  'webhookSecret',
];

const REQUIRED_CONTRACT_REFERENCES = [
  'EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md',
  'INTEGRATION_SECURITY_BOUNDARY.md',
  'EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md',
  'EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md',
  'GOVERNANCE_CHECK_REPORT.md',
  'PERMISSION_MATRIX.md',
  'GOLDEN_SCENARIOS.md',
  'DOMAIN_ONBOARDING.md',
  'MEMORY_POLICY.md',
  'USER_PEER_MEMORY_SCOPES.md',
  'SECOND_BRAIN_INBOX_CONTRACT.md',
  'QUALITY_SCORE_FEEDBACK_LOOP.md',
  'SKILL_CANDIDATE_REGISTRY.md',
  'OPERATOR_RUNBOOK.md',
];

function walkKeys(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) {
      walkKeys(item, visitor);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      visitor(key, nestedValue);
      walkKeys(nestedValue, visitor);
    }
  }
}

test('external provider audit cost rate limit document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('external provider audit cost rate limit fixture is safe and complete', () => {
  const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const field of REQUIRED_AUDIT_FIELDS) {
    assert.ok(contract.allowed_audit_fields.includes(field), field);
  }

  for (const field of contract.allowed_audit_fields) {
    assert.equal(forbiddenFieldSet.has(field), false, field);
  }

  for (const eventType of REQUIRED_EVENT_TYPES) {
    assert.ok(contract.event_types.includes(eventType), eventType);
  }

  for (const riskLevel of REQUIRED_RISK_LEVELS) {
    assert.ok(contract.cost_risk_levels.includes(riskLevel), riskLevel);
    assert.ok(contract.rate_limit_risk_levels.includes(riskLevel), riskLevel);
  }

  for (const scope of REQUIRED_BUDGET_SCOPES) {
    assert.ok(contract.budget_scopes.includes(scope), scope);
  }

  for (const scope of REQUIRED_RATE_LIMIT_SCOPES) {
    assert.ok(contract.rate_limit_scopes.includes(scope), scope);
  }

  for (const policy of REQUIRED_FALLBACK_POLICIES) {
    assert.ok(contract.fallback_policies.includes(policy), policy);
  }

  for (const stopCondition of REQUIRED_STOP_CONDITIONS) {
    assert.ok(contract.stop_conditions.includes(stopCondition), stopCondition);
  }

  for (const providerType of REQUIRED_PROVIDER_TYPES) {
    assert.ok(contract.provider_type_rules[providerType], providerType);
  }

  assert.equal(contract.default_rules.simulated, true);
  assert.equal(contract.default_rules.executed, false);
  assert.equal(contract.default_rules.real_provider_called, false);
  assert.equal(contract.default_rules.can_trigger_real_execution, false);
  assert.equal(contract.default_rules.write_allowed, false);
  assert.equal(contract.default_rules.action_allowed, false);
  assert.equal(contract.default_rules.real_provider_calls_allowed, false);
  assert.equal(contract.default_rules.automatic_retry_allowed, false);
  assert.equal(contract.default_rules.fallback_real_provider_allowed, false);
  assert.equal(contract.default_rules.storage_implemented, false);
  assert.equal(contract.default_rules.raw_content_allowed, false);
  assert.equal(contract.default_rules.budget_required_before_sandbox, true);
  assert.equal(contract.default_rules.rate_limit_required_before_sandbox, true);
  assert.equal(contract.default_rules.mock_first, true);

  for (const blockingRule of REQUIRED_BLOCKING_RULES) {
    assert.ok(contract.blocking_rules.includes(blockingRule), blockingRule);
  }

  for (const field of REQUIRED_FORBIDDEN_FIELDS) {
    assert.ok(contract.forbidden_fields.includes(field), field);
  }

  for (const reference of REQUIRED_CONTRACT_REFERENCES) {
    assert.ok(contract.required_contract_references.includes(reference), reference);
  }

  for (const example of contract.safe_audit_examples) {
    assert.equal(example.simulated, true, example.name);
    assert.equal(example.executed, false, example.name);
    assert.equal(example.real_provider_called, false, example.name);
    assert.equal(example.can_trigger_real_execution, false, example.name);
    assert.equal(example.write_allowed, false, example.name);
    assert.equal(example.action_allowed, false, example.name);

    walkKeys(example, (key, value) => {
      assert.equal(forbiddenFieldSet.has(key), false, `${example.name}:${key}`);

      if (typeof value === 'string') {
        assert.equal(/^https?:\/\//i.test(value), false, `${example.name}:${key}`);
      }
    });
  }
});
