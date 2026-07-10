'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/PERSONAL_WORKSPACE_CONNECTOR_POLICY.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-personal-workspace-connector-policy.json',
);

const REQUIRED_CONNECTOR_MODES = [
  'disabled',
  'mock_only',
  'read_only_candidate',
  'draft_only_candidate',
  'blocked_by_workspace',
  'blocked_by_tenant_isolation',
  'blocked_by_security_boundary',
  'blocked_by_permission_overlay',
  'blocked_by_governance',
  'blocked_by_human_review',
  'blocked_by_oauth_policy',
  'safe_fixture_response',
  'safe_error_response',
];

const REQUIRED_CONNECTOR_CANDIDATES = [
  'gmail_personal_read_candidate',
  'gmail_personal_draft_candidate',
  'calendar_personal_read_candidate',
  'calendar_personal_draft_candidate',
  'drive_personal_read_candidate',
  'docs_personal_read_candidate',
  'sheets_personal_read_candidate',
  'contacts_personal_read_candidate',
  'tasks_personal_read_candidate',
  'notes_personal_read_candidate',
  'files_personal_read_candidate',
  'personal_mcp_manual_fixture',
];

const REQUIRED_ALLOWED_OPERATIONS = [
  'search_email_summary',
  'read_email_summary',
  'summarize_thread',
  'draft_email_response',
  'list_calendar_summary',
  'summarize_calendar_day',
  'draft_calendar_event',
  'search_drive_metadata',
  'summarize_document',
  'summarize_sheet',
  'lookup_contact_summary',
  'summarize_task_list',
  'summarize_personal_note',
  'second_brain_candidate',
  'personal_reminder_candidate',
];

const REQUIRED_BLOCKED_OPERATIONS = [
  'send_email',
  'forward_email_real',
  'delete_email',
  'archive_email_real',
  'apply_label_real',
  'create_calendar_event_real',
  'update_calendar_event_real',
  'delete_calendar_event_real',
  'invite_attendee_real',
  'share_drive_file_real',
  'edit_drive_file_real',
  'delete_drive_file_real',
  'create_doc_real',
  'edit_doc_real',
  'create_sheet_real',
  'edit_sheet_real',
  'export_sensitive_file_real',
  'download_private_file_real',
  'sync_contacts_real',
  'create_contact_real',
  'update_contact_real',
  'delete_contact_real',
  'oauth_token_exchange',
  'refresh_token_use',
  'cross_workspace_context_use',
  'cross_tenant_context_use',
];

const REQUIRED_STATUSES = [
  'personal_connector_mock_success',
  'personal_connector_mock_blocked',
  'personal_connector_mock_error_safe',
  'personal_connector_requires_human_review',
  'personal_connector_requires_governance_review',
  'personal_connector_workspace_blocked',
  'personal_connector_permission_blocked',
  'personal_connector_sensitive_data_blocked',
  'personal_connector_write_blocked',
  'personal_connector_action_blocked',
  'personal_connector_oauth_policy_missing',
  'personal_connector_not_supported',
  'personal_connector_deprecated',
];

const REQUIRED_OUTPUT_TYPES = [
  'safe_summary',
  'sanitized_result',
  'email_summary',
  'thread_summary',
  'calendar_summary',
  'document_summary',
  'sheet_summary',
  'contact_summary',
  'task_summary',
  'note_summary',
  'draft_email_candidate',
  'draft_event_candidate',
  'second_brain_candidate',
  'reminder_candidate',
  'freshness_hint',
  'sensitivity_hint',
  'confidence_hint',
];

const REQUIRED_BLOCKING_RULES = [
  'gmail_real_before_readiness_gate',
  'calendar_real_before_readiness_gate',
  'drive_real_before_readiness_gate',
  'contacts_real_before_readiness_gate',
  'oauth_real_without_policy',
  'token_or_secret_added',
  'refresh_token_storage_attempted',
  'real_email_send_attempted',
  'real_calendar_create_attempted',
  'real_file_edit_attempted',
  'real_file_share_attempted',
  'real_delete_attempted',
  'private_file_download_attempted',
  'personal_connector_used_in_grupo_erick',
  'personal_connector_used_in_external_client',
  'personal_data_to_corporate_context',
  'personal_data_to_external_client_context',
  'missing_workspace_type',
  'missing_tenant_id',
  'missing_user_id',
  'missing_connector_scope',
  'provider_tenant_override_attempt',
  'prompt_tenant_override_attempt',
  'cross_tenant_leakage',
  'raw_email_body_storage_attempted',
  'raw_file_storage_attempted',
  'raw_payload_storage_attempted',
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
  'rawEmailBody',
  'rawThreadBody',
  'rawCalendarPayload',
  'rawDriveFile',
  'rawDocument',
  'rawSheet',
  'rawContactPayload',
  'privateUrl',
  'attachmentRaw',
  'fullFileDump',
  'personalSensitiveDataWithoutPolicy',
  'corporateDataFromPersonalConnector',
  'externalClientDataFromPersonalConnector',
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

test('personal workspace connector policy document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('personal workspace connector policy fixture is safe and complete', () => {
  const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const mode of REQUIRED_CONNECTOR_MODES) {
    assert.ok(contract.connector_modes.includes(mode), mode);
  }

  for (const candidate of REQUIRED_CONNECTOR_CANDIDATES) {
    assert.ok(contract.personal_connector_candidates.includes(candidate), candidate);
  }

  for (const operation of REQUIRED_ALLOWED_OPERATIONS) {
    assert.ok(contract.allowed_future_operations.includes(operation), operation);
  }

  for (const operation of REQUIRED_BLOCKED_OPERATIONS) {
    assert.ok(contract.blocked_operations.includes(operation), operation);
  }

  for (const status of REQUIRED_STATUSES) {
    assert.ok(contract.personal_connector_statuses.includes(status), status);
  }

  for (const outputType of REQUIRED_OUTPUT_TYPES) {
    assert.ok(contract.allowed_sanitized_output_types.includes(outputType), outputType);
  }

  assert.equal(contract.default_rules.workspace_type_required, true);
  assert.equal(contract.default_rules.workspace_type_must_be_personal, true);
  assert.equal(contract.default_rules.tenant_id_required, true);
  assert.equal(contract.default_rules.tenant_id_must_start_with_personal, true);
  assert.equal(contract.default_rules.user_id_required, true);
  assert.equal(contract.default_rules.connector_scope_required, true);
  assert.equal(contract.default_rules.connector_scope_must_be_personal_private, true);
  assert.equal(contract.default_rules.read_only_first, true);
  assert.equal(contract.default_rules.draft_only_requires_human_review, true);
  assert.equal(contract.default_rules.write_allowed, false);
  assert.equal(contract.default_rules.action_allowed, false);
  assert.equal(contract.default_rules.send_allowed, false);
  assert.equal(contract.default_rules.delete_allowed, false);
  assert.equal(contract.default_rules.share_allowed, false);
  assert.equal(contract.default_rules.edit_allowed, false);
  assert.equal(contract.default_rules.simulated, true);
  assert.equal(contract.default_rules.executed, false);
  assert.equal(contract.default_rules.real_provider_called, false);
  assert.equal(contract.default_rules.can_trigger_real_execution, false);
  assert.equal(contract.default_rules.real_connector_calls_allowed, false);
  assert.equal(contract.default_rules.oauth_implemented, false);
  assert.equal(contract.default_rules.token_storage_implemented, false);
  assert.equal(contract.default_rules.storage_implemented, false);
  assert.equal(contract.default_rules.memory_write_implemented, false);
  assert.equal(contract.default_rules.requires_security_boundary, true);
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

  for (const example of contract.safe_personal_connector_examples) {
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
