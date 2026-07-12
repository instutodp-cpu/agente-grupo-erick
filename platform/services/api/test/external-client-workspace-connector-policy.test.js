'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/EXTERNAL_CLIENT_WORKSPACE_CONNECTOR_POLICY.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-external-client-workspace-connector-policy.json',
);

const REQUIRED_CONNECTOR_MODES = [
  'disabled',
  'mock_only',
  'read_only_candidate',
  'draft_only_candidate',
  'blocked_by_workspace',
  'blocked_by_client_scope',
  'blocked_by_tenant_isolation',
  'blocked_by_permission_matrix',
  'blocked_by_permission_overlay',
  'blocked_by_security_boundary',
  'blocked_by_governance',
  'blocked_by_human_review',
  'blocked_by_oauth_policy',
  'safe_fixture_response',
  'safe_error_response',
];

const REQUIRED_CONNECTOR_CANDIDATES = [
  'client_gmail_read_candidate',
  'client_gmail_draft_candidate',
  'client_calendar_read_candidate',
  'client_calendar_draft_candidate',
  'client_drive_read_candidate',
  'client_docs_read_candidate',
  'client_sheets_read_candidate',
  'client_contacts_read_candidate',
  'client_crm_read_candidate',
  'client_helpdesk_read_candidate',
  'client_erp_read_candidate',
  'client_business_api_read_candidate',
  'client_social_draft_candidate',
  'client_web_read_candidate',
  'client_transcription_candidate',
  'client_mcp_manual_fixture',
];

const REQUIRED_ALLOWED_OPERATIONS = [
  'read_email_summary',
  'draft_email_response',
  'summarize_calendar',
  'draft_calendar_event',
  'search_drive_metadata',
  'summarize_document',
  'summarize_sheet',
  'lookup_contact_summary',
  'crm_summary',
  'helpdesk_summary',
  'erp_summary',
  'business_api_summary',
  'social_content_draft',
  'public_web_summary',
  'transcription_summary_candidate',
  'second_brain_candidate',
  'report_candidate',
  'alert_candidate',
  'dashboard_summary_candidate',
];

const REQUIRED_BLOCKED_OPERATIONS = [
  'send_email_real',
  'forward_email_real',
  'delete_email_real',
  'create_calendar_event_real',
  'update_calendar_event_real',
  'delete_calendar_event_real',
  'share_drive_file_real',
  'edit_drive_file_real',
  'delete_drive_file_real',
  'create_crm_record_real',
  'update_crm_record_real',
  'delete_crm_record_real',
  'create_helpdesk_ticket_real',
  'update_helpdesk_ticket_real',
  'close_helpdesk_ticket_real',
  'erp_writeback_real',
  'create_invoice_real',
  'payment_action_real',
  'publish_social_real',
  'send_social_message_real',
  'upload_media_real',
  'create_user_real',
  'change_role_real',
  'oauth_token_exchange',
  'refresh_token_use',
  'copy_token_between_clients',
  'use_grupo_erick_credentials',
  'use_personal_credentials',
  'cross_client_context_use',
  'cross_client_data_query',
  'cross_client_memory_use',
  'cross_client_cache_use',
  'cross_client_storage_use',
];

const REQUIRED_CONNECTOR_SCOPES = [
  'external_client_private',
  'external_client_company',
  'external_client_store',
  'external_client_department',
  'external_client_user',
  'external_client_brand',
  'external_client_manual_fixture',
];

const REQUIRED_STATUSES = [
  'external_client_connector_mock_success',
  'external_client_connector_mock_blocked',
  'external_client_connector_mock_error_safe',
  'external_client_connector_requires_human_review',
  'external_client_connector_requires_governance_review',
  'external_client_connector_workspace_blocked',
  'external_client_connector_client_scope_blocked',
  'external_client_connector_permission_blocked',
  'external_client_connector_sensitive_data_blocked',
  'external_client_connector_write_blocked',
  'external_client_connector_action_blocked',
  'external_client_connector_send_blocked',
  'external_client_connector_publish_blocked',
  'external_client_connector_oauth_policy_missing',
  'external_client_connector_not_supported',
  'external_client_connector_deprecated',
];

const REQUIRED_OUTPUT_TYPES = [
  'safe_summary',
  'sanitized_result',
  'email_summary',
  'calendar_summary',
  'document_summary',
  'sheet_summary',
  'crm_summary',
  'helpdesk_summary',
  'erp_summary',
  'business_api_summary',
  'social_draft_candidate',
  'public_web_summary',
  'transcription_summary_candidate',
  'report_candidate',
  'alert_candidate',
  'dashboard_summary_candidate',
  'second_brain_candidate',
  'freshness_hint',
  'sensitivity_hint',
  'confidence_hint',
];

const REQUIRED_BLOCKING_RULES = [
  'real_client_connector_before_readiness_gate',
  'oauth_real_without_policy',
  'token_secret_without_management',
  'token_shared_between_clients',
  'grupo_erick_token_used_for_client',
  'personal_token_used_for_client',
  'real_send_attempted',
  'real_publish_attempted',
  'real_create_update_delete_attempted',
  'erp_writeback_attempted',
  'payment_attempted',
  'user_or_role_change_attempted',
  'client_a_connector_used_by_client_b',
  'cross_client_data_query_attempted',
  'cross_client_memory_attempted',
  'cross_client_cache_attempted',
  'cross_client_storage_attempted',
  'grupo_erick_context_used',
  'personal_context_used',
  'missing_workspace_type',
  'missing_tenant_id',
  'missing_client_id',
  'missing_user_id',
  'missing_connector_scope',
  'prompt_tenant_override_attempt',
  'prompt_client_override_attempt',
  'provider_tenant_override_attempt',
  'cross_client_leakage',
  'raw_payload_storage_attempted',
  'raw_file_storage_attempted',
  'raw_database_payload_storage_attempted',
  'sensitive_data_without_policy',
  'send_allowed_true',
  'publish_allowed_true',
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
  'rawEmailBody',
  'rawCalendarPayload',
  'rawDriveFile',
  'rawDocument',
  'rawSheet',
  'rawCrmPayload',
  'rawHelpdeskPayload',
  'rawErpPayload',
  'rawDatabasePayload',
  'rawSocialPayload',
  'rawTranscript',
  'rawAudio',
  'privateUrl',
  'fullFileDump',
  'fullDatabaseDump',
  'otherClientData',
  'grupoErickData',
  'personalWorkspaceData',
  'crossTenantMemory',
  'crossTenantCache',
  'crossTenantStorage',
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
  'INTERNAL_BUSINESS_API_READ_ONLY.md',
  'PERSONAL_WORKSPACE_CONNECTOR_POLICY.md',
  'SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md',
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

test('external client workspace connector policy document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('external client workspace connector policy fixture is safe and complete', () => {
  const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const mode of REQUIRED_CONNECTOR_MODES) {
    assert.ok(contract.connector_modes.includes(mode), mode);
  }

  for (const candidate of REQUIRED_CONNECTOR_CANDIDATES) {
    assert.ok(contract.external_client_connector_candidates.includes(candidate), candidate);
  }

  for (const operation of REQUIRED_ALLOWED_OPERATIONS) {
    assert.ok(contract.allowed_future_operations.includes(operation), operation);
  }

  for (const operation of REQUIRED_BLOCKED_OPERATIONS) {
    assert.ok(contract.blocked_operations.includes(operation), operation);
  }

  for (const scope of REQUIRED_CONNECTOR_SCOPES) {
    assert.ok(contract.connector_scopes.includes(scope), scope);
  }

  for (const status of REQUIRED_STATUSES) {
    assert.ok(contract.external_client_connector_statuses.includes(status), status);
  }

  for (const outputType of REQUIRED_OUTPUT_TYPES) {
    assert.ok(contract.allowed_sanitized_output_types.includes(outputType), outputType);
  }

  assert.equal(contract.default_rules.workspace_type_required, true);
  assert.equal(contract.default_rules.workspace_type_must_be_external_client, true);
  assert.equal(contract.default_rules.tenant_id_required, true);
  assert.equal(contract.default_rules.tenant_id_must_match_client_id, true);
  assert.equal(contract.default_rules.client_id_required, true);
  assert.equal(contract.default_rules.user_id_required, true);
  assert.equal(contract.default_rules.connector_scope_required, true);
  assert.equal(contract.default_rules.read_only_first, true);
  assert.equal(contract.default_rules.draft_only_requires_human_review, true);
  assert.equal(contract.default_rules.write_allowed, false);
  assert.equal(contract.default_rules.action_allowed, false);
  assert.equal(contract.default_rules.send_allowed, false);
  assert.equal(contract.default_rules.publish_allowed, false);
  assert.equal(contract.default_rules.simulated, true);
  assert.equal(contract.default_rules.executed, false);
  assert.equal(contract.default_rules.real_provider_called, false);
  assert.equal(contract.default_rules.can_trigger_real_execution, false);
  assert.equal(contract.default_rules.real_connector_calls_allowed, false);
  assert.equal(contract.default_rules.oauth_implemented, false);
  assert.equal(contract.default_rules.token_storage_implemented, false);
  assert.equal(contract.default_rules.storage_implemented, false);
  assert.equal(contract.default_rules.memory_write_implemented, false);
  assert.equal(contract.default_rules.cache_implemented, false);
  assert.equal(contract.default_rules.cross_client_access_allowed, false);
  assert.equal(contract.default_rules.grupo_erick_context_allowed, false);
  assert.equal(contract.default_rules.personal_context_allowed, false);
  assert.equal(contract.default_rules.requires_security_boundary, true);
  assert.equal(contract.default_rules.requires_permission_matrix, true);
  assert.equal(contract.default_rules.requires_permission_overlay, true);
  assert.equal(contract.default_rules.requires_tenant_isolation, true);
  assert.equal(contract.default_rules.requires_oauth_policy, true);
  assert.equal(contract.default_rules.mock_first, true);
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

  for (const example of contract.safe_external_client_connector_examples) {
    assert.equal(example.simulated, true, example.name);
    assert.equal(example.executed, false, example.name);
    assert.equal(example.real_provider_called, false, example.name);
    assert.equal(example.can_trigger_real_execution, false, example.name);
    assert.equal(example.write_allowed, false, example.name);
    assert.equal(example.action_allowed, false, example.name);
    assert.equal(example.send_allowed, false, example.name);
    assert.equal(example.publish_allowed, false, example.name);

    walkKeys(example, (key, value) => {
      assert.equal(forbiddenFieldSet.has(key), false, `${example.name}:${key}`);

      if (typeof value === 'string') {
        assert.equal(/^https?:\/\//i.test(value), false, `${example.name}:${key}`);
      }
    });
  }
});
