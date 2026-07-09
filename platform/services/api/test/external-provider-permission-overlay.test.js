'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-external-provider-permission-overlay.json',
);

const REQUIRED_PROVIDER_PERMISSION_STATES = [
  'blocked',
  'mock_only',
  'read_only_candidate',
  'draft_only_candidate',
  'requires_human_review',
  'requires_governance_review',
  'deprecated',
];

const REQUIRED_PROVIDER_CAPABILITY_TYPES = [
  'public_read',
  'private_read',
  'draft_generation',
  'sanitized_transcription',
  'inbox_candidate',
  'audit_candidate',
  'write_action',
  'financial_action',
  'social_post_action',
  'email_send_action',
  'calendar_modify_action',
  'mcp_action_tool',
];

const REQUIRED_DOMAINS = [
  'compras',
  'financeiro',
  'treinamento',
  'marketing',
  'desenvolvimento',
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
  'missing_security_boundary',
  'missing_permission_matrix_entry',
  'missing_domain_onboarding',
  'missing_golden_scenario',
  'write_allowed_true',
  'action_allowed_true',
  'can_trigger_real_execution_true',
  'executed_true',
  'gmail_send_real',
  'calendar_modify_real',
  'social_post_real',
  'social_dm_reply_real',
  'money_movement',
  'erp_crm_database_write',
  'internal_mcp_action_tool',
  'raw_transcript_or_audio_storage',
  'cross_tenant_user_domain_leakage',
  'secret_exposure',
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
  'privateUrl',
  'webhookSecret',
];

const REQUIRED_CONTRACT_REFERENCES = [
  'PERMISSION_MATRIX.md',
  'EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md',
  'INTEGRATION_SECURITY_BOUNDARY.md',
  'GOVERNANCE_CHECK_REPORT.md',
  'GOLDEN_SCENARIOS.md',
  'DOMAIN_ONBOARDING.md',
  'MEMORY_POLICY.md',
  'USER_PEER_MEMORY_SCOPES.md',
  'SECOND_BRAIN_INBOX_CONTRACT.md',
  'QUALITY_SCORE_FEEDBACK_LOOP.md',
  'SKILL_CANDIDATE_REGISTRY.md',
  'OPERATOR_RUNBOOK.md',
];

test('external provider permission overlay document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('external provider permission overlay fixture is safe and complete', () => {
  const overlay = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  for (const state of REQUIRED_PROVIDER_PERMISSION_STATES) {
    assert.ok(overlay.provider_permission_states.includes(state), state);
  }

  for (const capabilityType of REQUIRED_PROVIDER_CAPABILITY_TYPES) {
    assert.ok(overlay.provider_capability_types.includes(capabilityType), capabilityType);
  }

  for (const domain of REQUIRED_DOMAINS) {
    assert.ok(overlay.domain_provider_type_rules[domain], domain);

    for (const providerType of REQUIRED_PROVIDER_TYPES) {
      const rule = overlay.domain_provider_type_rules[domain][providerType];

      assert.ok(rule, `${domain}:${providerType}`);
      assert.equal(rule.can_trigger_real_execution, false, `${domain}:${providerType}`);
      assert.equal(rule.executed, false, `${domain}:${providerType}`);
      assert.equal(rule.write_allowed, false, `${domain}:${providerType}`);
      assert.equal(rule.action_allowed, false, `${domain}:${providerType}`);
    }
  }

  const providerIds = new Set(overlay.provider_id_rules.map((rule) => rule.provider_id));

  for (const providerId of REQUIRED_PROVIDER_IDS) {
    assert.equal(providerIds.has(providerId), true, providerId);
  }

  for (const rule of overlay.provider_id_rules) {
    assert.equal(rule.can_trigger_real_execution, false, rule.provider_id);
    assert.equal(rule.executed, false, rule.provider_id);
    assert.equal(rule.write_allowed, false, rule.provider_id);
    assert.equal(rule.action_allowed, false, rule.provider_id);

    if (['high', 'critical'].includes(rule.risk_level)) {
      assert.equal(rule.requires_human_review, true, rule.provider_id);
      assert.equal(rule.requires_governance_review, true, rule.provider_id);
    }
  }

  assert.equal(overlay.default_rules.executed, false);
  assert.equal(overlay.default_rules.can_trigger_real_execution, false);
  assert.equal(overlay.default_rules.write_allowed, false);
  assert.equal(overlay.default_rules.action_allowed, false);
  assert.equal(overlay.default_rules.real_provider_calls_allowed, false);
  assert.equal(overlay.default_rules.requires_security_boundary, true);
  assert.equal(overlay.default_rules.requires_provider_registry_entry, true);
  assert.equal(overlay.default_rules.requires_permission_matrix_entry, true);
  assert.equal(overlay.default_rules.mock_first, true);

  for (const blockingRule of REQUIRED_BLOCKING_RULES) {
    assert.ok(overlay.blocking_rules.includes(blockingRule), blockingRule);
  }

  for (const field of REQUIRED_FORBIDDEN_FIELDS) {
    assert.ok(overlay.forbidden_fields.includes(field), field);
  }

  for (const reference of REQUIRED_CONTRACT_REFERENCES) {
    assert.ok(overlay.required_contract_references.includes(reference), reference);
  }
});
