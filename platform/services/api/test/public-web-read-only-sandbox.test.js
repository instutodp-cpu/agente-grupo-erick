'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/PUBLIC_WEB_READ_ONLY_SANDBOX.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-public-web-read-only-sandbox.json',
);

const REQUIRED_SANDBOX_MODES = [
  'disabled',
  'mock_only',
  'read_only_candidate',
  'blocked_by_registry',
  'blocked_by_security_boundary',
  'blocked_by_permission_overlay',
  'blocked_by_tenant_isolation',
  'blocked_by_cost_rate_limit',
  'safe_fixture_response',
  'safe_error_response',
];

const REQUIRED_ALLOWED_SOURCE_TYPES = [
  'public_product_page',
  'public_price_page',
  'public_supplier_page',
  'public_competitor_page',
  'public_market_article',
  'public_documentation_page',
  'public_travel_listing',
  'public_hotel_listing',
  'public_promotion_page',
  'public_search_result_summary',
  'public_government_page',
  'public_regulatory_page',
];

const REQUIRED_BLOCKED_SOURCE_TYPES = [
  'authenticated_page',
  'private_dashboard',
  'customer_portal',
  'employee_portal',
  'bank_portal',
  'payment_page',
  'checkout_page',
  'cart_page',
  'order_creation_page',
  'login_page',
  'password_reset_page',
  'private_api_response',
  'raw_social_dm',
  'private_social_content',
  'age_restricted_content',
  'sensitive_personal_data_page',
  'confidential_document',
  'malware_or_phishing_page',
];

const REQUIRED_SANDBOX_STATUSES = [
  'sandbox_mock_success',
  'sandbox_mock_blocked',
  'sandbox_mock_error_safe',
  'sandbox_requires_human_review',
  'sandbox_requires_governance_review',
  'sandbox_source_not_allowed',
  'sandbox_source_not_public',
  'sandbox_not_supported',
  'sandbox_deprecated',
];

const REQUIRED_ALLOWED_OUTPUT_TYPES = [
  'safe_summary',
  'public_result_snippet',
  'comparison_summary',
  'price_observation',
  'promotion_observation',
  'supplier_public_summary',
  'competitor_public_summary',
  'travel_public_summary',
  'documentation_summary',
  'market_public_summary',
  'freshness_hint',
  'confidence_hint',
];

const REQUIRED_PROVIDER_CANDIDATES = [
  'firecrawl',
  'bright_data',
  'scrapeless',
  'public_web_manual_fixture',
];

const REQUIRED_BLOCKING_RULES = [
  'real_provider_call_attempted',
  'firecrawl_real_before_readiness_gate',
  'bright_data_real_before_readiness_gate',
  'scrapeless_real_before_readiness_gate',
  'scraping_real_attempted',
  'crawling_real_attempted',
  'oauth_or_secret_added',
  'authenticated_page_access_attempted',
  'private_portal_access_attempted',
  'checkout_or_cart_access_attempted',
  'payment_access_attempted',
  'form_submit_attempted',
  'purchase_or_reservation_attempted',
  'raw_html_storage_attempted',
  'full_page_text_storage_without_policy',
  'sensitive_data_storage_attempted',
  'missing_workspace_type',
  'missing_tenant_id',
  'missing_user_id',
  'provider_tenant_override_attempt',
  'prompt_tenant_override_attempt',
  'cross_tenant_leakage',
  'executed_true',
  'real_provider_called_true',
  'write_allowed_true',
  'action_allowed_true',
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
  'fullPageText',
  'privateUrl',
  'checkoutData',
  'cartData',
  'paymentData',
  'loginData',
  'webhookSecret',
];

const REQUIRED_CONTRACT_REFERENCES = [
  'TENANT_WORKSPACE_ISOLATION.md',
  'EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md',
  'INTEGRATION_SECURITY_BOUNDARY.md',
  'EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md',
  'EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md',
  'EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md',
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

test('public web read only sandbox document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('public web read only sandbox fixture is safe and complete', () => {
  const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const mode of REQUIRED_SANDBOX_MODES) {
    assert.ok(contract.sandbox_modes.includes(mode), mode);
  }

  for (const sourceType of REQUIRED_ALLOWED_SOURCE_TYPES) {
    assert.ok(contract.allowed_public_source_types.includes(sourceType), sourceType);
  }

  for (const sourceType of REQUIRED_BLOCKED_SOURCE_TYPES) {
    assert.ok(contract.blocked_source_types.includes(sourceType), sourceType);
  }

  for (const status of REQUIRED_SANDBOX_STATUSES) {
    assert.ok(contract.sandbox_statuses.includes(status), status);
  }

  for (const outputType of REQUIRED_ALLOWED_OUTPUT_TYPES) {
    assert.ok(contract.allowed_sanitized_output_types.includes(outputType), outputType);
  }

  for (const providerCandidate of REQUIRED_PROVIDER_CANDIDATES) {
    assert.ok(contract.provider_candidates.includes(providerCandidate), providerCandidate);
  }

  assert.equal(contract.default_rules.workspace_type_required, true);
  assert.equal(contract.default_rules.tenant_id_required, true);
  assert.equal(contract.default_rules.user_id_required, true);
  assert.equal(contract.default_rules.public_only, true);
  assert.equal(contract.default_rules.authenticated_access_allowed, false);
  assert.equal(contract.default_rules.private_portal_access_allowed, false);
  assert.equal(contract.default_rules.login_allowed, false);
  assert.equal(contract.default_rules.form_submit_allowed, false);
  assert.equal(contract.default_rules.checkout_allowed, false);
  assert.equal(contract.default_rules.purchase_allowed, false);
  assert.equal(contract.default_rules.reservation_allowed, false);
  assert.equal(contract.default_rules.write_allowed, false);
  assert.equal(contract.default_rules.action_allowed, false);
  assert.equal(contract.default_rules.simulated, true);
  assert.equal(contract.default_rules.executed, false);
  assert.equal(contract.default_rules.real_provider_called, false);
  assert.equal(contract.default_rules.can_trigger_real_execution, false);
  assert.equal(contract.default_rules.raw_html_allowed, false);
  assert.equal(contract.default_rules.raw_payload_allowed, false);
  assert.equal(contract.default_rules.raw_message_allowed, false);
  assert.equal(contract.default_rules.storage_implemented, false);
  assert.equal(contract.default_rules.real_provider_calls_allowed, false);
  assert.equal(contract.default_rules.requires_security_boundary, true);
  assert.equal(contract.default_rules.requires_permission_overlay, true);
  assert.equal(contract.default_rules.requires_tenant_isolation, true);
  assert.equal(contract.default_rules.requires_cost_rate_limit, true);
  assert.equal(contract.default_rules.mock_first, true);
  assert.equal(contract.default_rules.read_only_first, true);

  for (const blockingRule of REQUIRED_BLOCKING_RULES) {
    assert.ok(contract.blocking_rules.includes(blockingRule), blockingRule);
  }

  for (const field of REQUIRED_FORBIDDEN_FIELDS) {
    assert.ok(contract.forbidden_fields.includes(field), field);
  }

  for (const reference of REQUIRED_CONTRACT_REFERENCES) {
    assert.ok(contract.required_contract_references.includes(reference), reference);
  }

  for (const example of contract.safe_public_web_examples) {
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
