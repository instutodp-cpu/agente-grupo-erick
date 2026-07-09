'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(
  __dirname,
  '../../../docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md',
);
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-external-provider-mock-adapter-harness.json',
);

const REQUIRED_ADAPTER_MODES = [
  'mock_only',
  'blocked_by_registry',
  'blocked_by_security_boundary',
  'blocked_by_permission_overlay',
  'blocked_by_governance',
  'safe_fixture_response',
  'safe_error_response',
];

const REQUIRED_PROVIDER_MOCK_SCOPES = [
  'provider_type_mock',
  'provider_id_mock',
  'domain_mock',
  'capability_mock',
  'blocked_mock',
  'audit_mock',
];

const REQUIRED_MOCK_RESPONSE_STATUSES = [
  'mock_success',
  'mock_blocked',
  'mock_error_safe',
  'mock_requires_human_review',
  'mock_requires_governance_review',
  'mock_not_supported',
  'mock_deprecated',
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

const REQUIRED_PROVIDER_IDS = [
  'firecrawl',
  'bright_data',
  'scrapeless',
  'composio',
  'google_workspace_super',
  'assemblyai',
  'social_media_api',
  'x_direct_api',
  'internal_business_api',
  'internal_mcp_server',
  'github_connector',
];

const REQUIRED_BLOCKING_RULES = [
  'unregistered_provider',
  'missing_provider_type',
  'missing_security_boundary',
  'missing_permission_overlay',
  'write_allowed_true',
  'action_allowed_true',
  'can_trigger_real_execution_true',
  'executed_true',
  'real_provider_called_true',
  'real_oauth_attempted',
  'real_secret_attempted',
  'external_api_call_attempted',
  'storage_attempted',
  'raw_audio_or_transcript_attempted',
  'raw_html_or_payload_attempted',
  'social_post_attempted',
  'email_send_attempted',
  'calendar_modify_attempted',
  'money_movement_attempted',
  'erp_crm_database_write_attempted',
  'mcp_action_tool_attempted',
  'cross_tenant_user_domain_leakage',
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

test('external provider mock adapter harness document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('external provider mock adapter harness fixture is safe and complete', () => {
  const harness = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  for (const adapterMode of REQUIRED_ADAPTER_MODES) {
    assert.ok(harness.adapter_modes.includes(adapterMode), adapterMode);
  }

  for (const scope of REQUIRED_PROVIDER_MOCK_SCOPES) {
    assert.ok(harness.provider_mock_scopes.includes(scope), scope);
  }

  for (const status of REQUIRED_MOCK_RESPONSE_STATUSES) {
    assert.ok(harness.mock_response_statuses.includes(status), status);
  }

  for (const providerType of REQUIRED_PROVIDER_TYPES) {
    assert.ok(harness.provider_type_mock_result_contracts[providerType], providerType);
  }

  for (const providerId of REQUIRED_PROVIDER_IDS) {
    assert.ok(harness.provider_id_mock_coverage[providerId], providerId);
    assert.equal(harness.provider_id_mock_coverage[providerId].covered, true, providerId);
  }

  assert.equal(harness.default_rules.simulated, true);
  assert.equal(harness.default_rules.executed, false);
  assert.equal(harness.default_rules.real_provider_called, false);
  assert.equal(harness.default_rules.can_trigger_real_execution, false);
  assert.equal(harness.default_rules.write_allowed, false);
  assert.equal(harness.default_rules.action_allowed, false);
  assert.equal(harness.default_rules.real_provider_calls_allowed, false);
  assert.equal(harness.default_rules.oauth_implemented, false);
  assert.equal(harness.default_rules.secrets_allowed, false);
  assert.equal(harness.default_rules.storage_implemented, false);
  assert.equal(harness.default_rules.raw_content_allowed, false);
  assert.equal(harness.default_rules.mock_first, true);

  for (const blockingRule of REQUIRED_BLOCKING_RULES) {
    assert.ok(harness.blocking_rules.includes(blockingRule), blockingRule);
  }

  for (const field of REQUIRED_FORBIDDEN_FIELDS) {
    assert.ok(harness.forbidden_fields.includes(field), field);
  }

  for (const reference of REQUIRED_CONTRACT_REFERENCES) {
    assert.ok(harness.required_contract_references.includes(reference), reference);
  }

  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const example of harness.safe_mock_examples) {
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
