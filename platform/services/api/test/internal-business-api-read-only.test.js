'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/INTERNAL_BUSINESS_API_READ_ONLY.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-internal-business-api-read-only.json',
);

const REQUIRED_API_MODES = [
  'disabled',
  'mock_only',
  'read_only_candidate',
  'blocked_by_tenant_isolation',
  'blocked_by_permission_matrix',
  'blocked_by_security_boundary',
  'blocked_by_permission_overlay',
  'blocked_by_governance',
  'blocked_by_cost_rate_limit',
  'safe_fixture_response',
  'safe_error_response',
];

const REQUIRED_DATA_DOMAINS = [
  'compras',
  'financeiro',
  'estoque',
  'vendas',
  'lojas',
  'fornecedores',
  'produtos',
  'clientes',
  'crediario',
  'caixa',
  'rh',
  'treinamento',
  'atendimento',
  'marketing',
  'operacoes',
  'desenvolvimento',
  'lotericas',
  'indicadores',
  'auditoria',
];

const REQUIRED_QUERY_TYPES = [
  'list_summary',
  'get_summary',
  'aggregate_report',
  'trend_report',
  'ranking_report',
  'anomaly_candidate',
  'due_date_summary',
  'inventory_summary',
  'sales_summary',
  'purchase_summary',
  'financial_summary',
  'training_progress_summary',
  'customer_service_summary',
  'audit_summary',
  'store_performance_summary',
  'supplier_performance_summary',
];

const REQUIRED_BLOCKED_QUERY_ACTION_TYPES = [
  'create_record',
  'update_record',
  'delete_record',
  'approve_record',
  'reject_record',
  'pay_invoice',
  'create_purchase',
  'cancel_purchase',
  'modify_credit',
  'modify_limit',
  'modify_stock',
  'create_user',
  'change_user_role',
  'send_message',
  'export_sensitive_raw_data',
  'run_raw_sql',
  'run_admin_query',
  'bypass_rls',
  'cross_tenant_query',
  'full_database_dump',
  'writeback_to_erp',
  'webhook_action',
];

const REQUIRED_STATUSES = [
  'business_api_mock_success',
  'business_api_mock_blocked',
  'business_api_mock_error_safe',
  'business_api_requires_human_review',
  'business_api_requires_governance_review',
  'business_api_tenant_scope_blocked',
  'business_api_permission_blocked',
  'business_api_sensitive_data_blocked',
  'business_api_write_blocked',
  'business_api_raw_query_blocked',
  'business_api_not_supported',
  'business_api_deprecated',
];

const REQUIRED_ALLOWED_OUTPUT_TYPES = [
  'safe_summary',
  'aggregate_result',
  'sanitized_rows_sample',
  'metric_summary',
  'trend_summary',
  'ranking_summary',
  'anomaly_candidate_summary',
  'due_date_summary',
  'inventory_summary',
  'sales_summary',
  'purchase_summary',
  'financial_summary',
  'training_progress_summary',
  'audit_summary',
  'store_performance_summary',
  'supplier_performance_summary',
  'freshness_hint',
  'sensitivity_hint',
  'confidence_hint',
];

const REQUIRED_PROVIDER_CANDIDATES = [
  'supabase_read_only_candidate',
  'postgres_read_only_candidate',
  'base44_read_only_candidate',
  'erp_export_fixture',
  'linx_read_only_candidate',
  'internal_business_api_manual_fixture',
];

const REQUIRED_BLOCKING_RULES = [
  'supabase_real_before_readiness_gate',
  'postgres_real_before_readiness_gate',
  'base44_real_before_readiness_gate',
  'erp_real_before_readiness_gate',
  'linx_real_before_readiness_gate',
  'real_database_query_attempted',
  'raw_sql_attempted',
  'writeback_attempted',
  'create_update_delete_attempted',
  'approval_rejection_attempted',
  'payment_attempted',
  'purchase_attempted',
  'stock_modification_attempted',
  'credit_or_limit_modification_attempted',
  'missing_workspace_type',
  'missing_tenant_id',
  'missing_user_id',
  'missing_data_domain',
  'missing_query_type',
  'provider_tenant_override_attempt',
  'prompt_tenant_override_attempt',
  'cross_tenant_leakage',
  'full_database_dump_attempted',
  'raw_database_payload_attempted',
  'sensitive_data_without_policy',
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
  'rawSql',
  'rawQuery',
  'rawDatabasePayload',
  'fullDatabaseDump',
  'fullCpf',
  'fullCnpj',
  'fullCardNumber',
  'bankAccount',
  'paymentCredentials',
  'personalSensitiveData',
  'privateEmployeeData',
  'customerPrivateData',
  'crossTenantData',
  'webhookSecret',
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

test('internal business API read-only document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('internal business API read-only fixture is safe and complete', () => {
  const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const mode of REQUIRED_API_MODES) {
    assert.ok(contract.api_modes.includes(mode), mode);
  }

  for (const domain of REQUIRED_DATA_DOMAINS) {
    assert.ok(contract.allowed_data_domains.includes(domain), domain);
  }

  for (const queryType of REQUIRED_QUERY_TYPES) {
    assert.ok(contract.allowed_query_types.includes(queryType), queryType);
  }

  for (const actionType of REQUIRED_BLOCKED_QUERY_ACTION_TYPES) {
    assert.ok(contract.blocked_query_action_types.includes(actionType), actionType);
  }

  for (const status of REQUIRED_STATUSES) {
    assert.ok(contract.business_api_statuses.includes(status), status);
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
  assert.equal(contract.default_rules.data_domain_required, true);
  assert.equal(contract.default_rules.query_type_required, true);
  assert.equal(contract.default_rules.permission_check_required, true);
  assert.equal(contract.default_rules.tenant_isolation_required, true);
  assert.equal(contract.default_rules.read_only, true);
  assert.equal(contract.default_rules.write_allowed, false);
  assert.equal(contract.default_rules.action_allowed, false);
  assert.equal(contract.default_rules.simulated, true);
  assert.equal(contract.default_rules.executed, false);
  assert.equal(contract.default_rules.real_provider_called, false);
  assert.equal(contract.default_rules.can_trigger_real_execution, false);
  assert.equal(contract.default_rules.real_provider_calls_allowed, false);
  assert.equal(contract.default_rules.real_database_queries_allowed, false);
  assert.equal(contract.default_rules.raw_sql_allowed, false);
  assert.equal(contract.default_rules.writeback_allowed, false);
  assert.equal(contract.default_rules.storage_implemented, false);
  assert.equal(contract.default_rules.cache_implemented, false);
  assert.equal(contract.default_rules.rag_requires_tenant_namespace, true);
  assert.equal(contract.default_rules.requires_security_boundary, true);
  assert.equal(contract.default_rules.requires_permission_overlay, true);
  assert.equal(contract.default_rules.requires_tenant_isolation, true);
  assert.equal(contract.default_rules.requires_cost_rate_limit, true);
  assert.equal(contract.default_rules.requires_governance_review_for_sensitive_domains, true);
  assert.equal(contract.default_rules.mock_first, true);
  assert.equal(contract.default_rules.read_only_first, true);
  assert.equal(contract.default_rules.sanitized_output_only, true);

  for (const blockingRule of REQUIRED_BLOCKING_RULES) {
    assert.ok(contract.blocking_rules.includes(blockingRule), blockingRule);
  }

  for (const field of REQUIRED_FORBIDDEN_FIELDS) {
    assert.ok(contract.forbidden_fields.includes(field), field);
  }

  for (const reference of REQUIRED_CONTRACT_REFERENCES) {
    assert.ok(contract.required_contract_references.includes(reference), reference);
  }

  for (const example of contract.safe_business_api_examples) {
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
