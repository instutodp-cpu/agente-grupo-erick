'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-external-integration-provider-registry.json',
);

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

const REQUIRED_PROVIDER_CANDIDATES = [
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
];

test('external integration provider registry document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('external integration provider registry fixture is safe and complete', () => {
  const registry = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const providerTypes = new Set(registry.provider_types.map((providerType) => providerType.id));
  const providerCandidates = new Set(
    registry.provider_candidates.map((provider) => provider.provider_id),
  );

  for (const providerType of REQUIRED_PROVIDER_TYPES) {
    assert.equal(providerTypes.has(providerType), true, providerType);
  }

  for (const providerId of REQUIRED_PROVIDER_CANDIDATES) {
    assert.equal(providerCandidates.has(providerId), true, providerId);
  }

  for (const providerType of registry.provider_types) {
    assert.equal(providerType.can_trigger_real_execution, false, providerType.id);
  }

  for (const provider of registry.provider_candidates) {
    assert.ok(provider.provider_id);
    assert.ok(provider.provider_type);
    assert.ok(provider.risk_level);
    assert.ok(provider.status);
    assert.equal(provider.can_trigger_real_execution, false, provider.provider_id);
    assert.equal(provider.executed, false, provider.provider_id);
    assert.equal(provider.write_allowed, false, provider.provider_id);
    assert.equal(provider.action_allowed, false, provider.provider_id);

    if (['critical', 'high'].includes(provider.risk_level)) {
      assert.equal(provider.requires_human_confirmation, true, provider.provider_id);
      assert.equal(provider.requires_governance_review, true, provider.provider_id);
    }
  }

  for (const status of [
    'proposed',
    'documented',
    'approved_for_mock_only',
    'approved_for_read_only_sandbox',
    'blocked',
    'deprecated',
  ]) {
    assert.ok(registry.allowed_statuses.includes(status), status);
  }

  assert.equal(registry.default_rules.executed, false);
  assert.equal(registry.default_rules.can_trigger_real_execution, false);
  assert.equal(registry.default_rules.write_allowed, false);
  assert.equal(registry.default_rules.action_allowed, false);
  assert.equal(registry.default_rules.real_provider_calls_allowed, false);
  assert.equal(registry.default_rules.storage_implemented, false);
  assert.equal(registry.default_rules.secrets_allowed_in_docs, false);
  assert.equal(registry.default_rules.mock_first, true);
  assert.equal(registry.default_rules.human_review_required, true);
  assert.equal(registry.default_rules.governance_review_required, true);

  for (const field of REQUIRED_FORBIDDEN_FIELDS) {
    assert.ok(registry.forbidden_fields.includes(field), field);
  }
});
