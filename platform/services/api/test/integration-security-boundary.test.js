'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/INTEGRATION_SECURITY_BOUNDARY.md');
const fixturePath = path.resolve(__dirname, 'fixtures/hermes-integration-security-boundary.json');

const REQUIRED_BOUNDARY_LAYERS = [
  'identity_boundary',
  'secret_boundary',
  'payload_boundary',
  'action_boundary',
  'provider_boundary',
  'domain_boundary',
  'cost_boundary',
  'compliance_boundary',
  'audit_boundary',
  'sandbox_boundary',
];

const ALLOWED_AUDIT_FIELDS = [
  'trace_id',
  'provider_id',
  'provider_type',
  'domain',
  'intent',
  'risk_level',
  'status',
  'simulated',
  'executed',
  'adapter_mode',
  'confirmation_required',
  'confirmation_id',
  'blocked_reason',
  'timestamp',
  'cost_risk',
  'rate_limit_risk',
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

const REQUIRED_PROVIDER_TYPE_RULES = [
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
  'real_oauth_added',
  'real_secret_added',
  'real_env_key_added',
  'external_api_called',
  'external_write_attempted',
  'social_post_attempted',
  'email_send_attempted',
  'calendar_modify_attempted',
  'money_movement_attempted',
  'erp_mutation_attempted',
  'action_mcp_tool_enabled',
  'raw_transcript_stored',
  'raw_audio_stored',
  'raw_scraping_stored_without_policy',
  'secret_exposed',
  'raw_payload_exposed',
  'cross_tenant_leakage',
  'cross_user_leakage',
  'confirmation_gate_removed',
  'kill_switch_removed',
  'executed_true_detected',
];

const REQUIRED_CONTRACT_REFERENCES = [
  'EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md',
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

test('integration security boundary document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('integration security boundary fixture is safe and complete', () => {
  const boundary = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const boundaryLayers = new Set(boundary.boundary_layers.map((layer) => layer.id));
  const providerTypeRules = new Set(boundary.provider_type_rules.map((rule) => rule.id));

  for (const layerId of REQUIRED_BOUNDARY_LAYERS) {
    assert.equal(boundaryLayers.has(layerId), true, layerId);
  }

  for (const layer of boundary.boundary_layers) {
    assert.equal(layer.can_trigger_real_execution, false, layer.id);
    assert.equal(layer.required, true, layer.id);
  }

  assert.deepEqual([...boundary.allowed_audit_fields].sort(), [...ALLOWED_AUDIT_FIELDS].sort());

  for (const field of REQUIRED_FORBIDDEN_FIELDS) {
    assert.ok(boundary.forbidden_fields.includes(field), field);
  }

  assert.equal(boundary.default_rules.executed, false);
  assert.equal(boundary.default_rules.can_trigger_real_execution, false);
  assert.equal(boundary.default_rules.write_allowed, false);
  assert.equal(boundary.default_rules.action_allowed, false);
  assert.equal(boundary.default_rules.real_provider_calls_allowed, false);
  assert.equal(boundary.default_rules.secrets_allowed_in_docs, false);
  assert.equal(boundary.default_rules.secrets_allowed_in_fixtures, false);
  assert.equal(boundary.default_rules.raw_payload_logging_allowed, false);
  assert.equal(boundary.default_rules.raw_message_logging_allowed, false);
  assert.equal(boundary.default_rules.cross_tenant_access_allowed, false);
  assert.equal(boundary.default_rules.cross_user_access_allowed, false);
  assert.equal(boundary.default_rules.cross_domain_access_allowed, false);
  assert.equal(boundary.default_rules.mock_first, true);
  assert.equal(boundary.default_rules.human_review_required, true);
  assert.equal(boundary.default_rules.governance_review_required, true);

  for (const providerType of REQUIRED_PROVIDER_TYPE_RULES) {
    assert.equal(providerTypeRules.has(providerType), true, providerType);
  }

  for (const rule of boundary.provider_type_rules) {
    assert.equal(rule.can_trigger_real_execution, false, rule.id);
    assert.equal(rule.write_allowed, false, rule.id);
    assert.equal(rule.action_allowed, false, rule.id);
  }

  for (const blockingRule of REQUIRED_BLOCKING_RULES) {
    assert.ok(boundary.blocking_rules.includes(blockingRule), blockingRule);
  }

  for (const contractReference of REQUIRED_CONTRACT_REFERENCES) {
    assert.ok(boundary.required_contract_references.includes(contractReference), contractReference);
  }
});
