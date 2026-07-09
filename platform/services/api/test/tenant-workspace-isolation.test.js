'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/TENANT_WORKSPACE_ISOLATION.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-tenant-workspace-isolation.json',
);

const REQUIRED_WORKSPACE_TYPES = ['personal', 'grupo_erick', 'external_client'];
const REQUIRED_TENANT_ID_FORMATS = ['personal::<user_id>', 'grupo_erick', 'client::<client_id>'];

const REQUIRED_WORKSPACE_IDENTITY_FIELDS = [
  'workspace_type',
  'tenant_id',
  'user_id',
  'role',
  'company_id',
  'store_id',
  'client_id',
  'allowed_domains',
  'denied_domains',
  'scope_source',
  'scope_version',
  'isolation_policy',
  'confirmation_policy',
  'governance_policy',
];

const REQUIRED_ISOLATION_BOUNDARIES = [
  'personal_boundary',
  'grupo_erick_boundary',
  'external_client_boundary',
  'store_boundary',
  'company_boundary',
  'user_boundary',
  'role_boundary',
  'provider_boundary',
  'memory_boundary',
  'audit_boundary',
];

const REQUIRED_BLOCKING_RULES = [
  'missing_tenant_id',
  'missing_workspace_type',
  'missing_user_id',
  'personal_to_grupo_erick_leakage',
  'grupo_erick_to_personal_leakage',
  'grupo_erick_to_external_client_leakage',
  'external_client_to_grupo_erick_leakage',
  'external_client_to_external_client_leakage',
  'prompt_tenant_override_attempt',
  'provider_tenant_override_attempt',
  'memory_without_tenant',
  'audit_without_tenant',
  'cache_global_sensitive_data',
  'provider_output_without_workspace',
  'mcp_call_without_tenant',
  'supabase_without_tenant_policy',
  'vector_db_without_tenant_namespace',
  'second_brain_without_tenant_isolation',
  'raw_message_stored',
  'secret_stored',
  'executed_true',
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
  'privateUrl',
  'webhookSecret',
];

const REQUIRED_CONTRACT_REFERENCES = [
  'MEMORY_POLICY.md',
  'USER_PEER_MEMORY_SCOPES.md',
  'SECOND_BRAIN_INBOX_CONTRACT.md',
  'PERMISSION_MATRIX.md',
  'GOVERNANCE_CHECK_REPORT.md',
  'INTEGRATION_SECURITY_BOUNDARY.md',
  'EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md',
  'EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md',
  'EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md',
  'EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md',
  'GOLDEN_SCENARIOS.md',
  'DOMAIN_ONBOARDING.md',
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

test('tenant workspace isolation document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('tenant workspace isolation fixture is safe and complete', () => {
  const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const workspaceType of REQUIRED_WORKSPACE_TYPES) {
    assert.ok(contract.workspace_types.includes(workspaceType), workspaceType);
  }

  for (const tenantIdFormat of REQUIRED_TENANT_ID_FORMATS) {
    assert.ok(contract.tenant_id_formats.includes(tenantIdFormat), tenantIdFormat);
  }

  for (const field of REQUIRED_WORKSPACE_IDENTITY_FIELDS) {
    assert.ok(contract.workspace_identity_fields.includes(field), field);
  }

  for (const boundary of REQUIRED_ISOLATION_BOUNDARIES) {
    assert.ok(contract.isolation_boundaries.includes(boundary), boundary);
  }

  assert.equal(contract.default_rules.tenant_id_required, true);
  assert.equal(contract.default_rules.workspace_type_required, true);
  assert.equal(contract.default_rules.user_id_required, true);
  assert.equal(contract.default_rules.cross_workspace_access_allowed, false);
  assert.equal(contract.default_rules.cross_tenant_access_allowed, false);
  assert.equal(contract.default_rules.cross_user_access_allowed, false);
  assert.equal(contract.default_rules.prompt_can_change_tenant, false);
  assert.equal(contract.default_rules.provider_can_change_tenant, false);
  assert.equal(contract.default_rules.memory_requires_tenant, true);
  assert.equal(contract.default_rules.audit_requires_tenant, true);
  assert.equal(contract.default_rules.provider_requires_tenant, true);
  assert.equal(contract.default_rules.mcp_requires_tenant, true);
  assert.equal(contract.default_rules.cache_global_sensitive_data_allowed, false);
  assert.equal(contract.default_rules.rag_requires_tenant_namespace, true);
  assert.equal(contract.default_rules.second_brain_requires_tenant, true);
  assert.equal(contract.default_rules.executed, false);
  assert.equal(contract.default_rules.write_allowed, false);
  assert.equal(contract.default_rules.action_allowed, false);
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

  for (const example of contract.safe_isolation_examples) {
    assert.equal(example.simulated, true, example.name);
    assert.equal(example.executed, false, example.name);
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
