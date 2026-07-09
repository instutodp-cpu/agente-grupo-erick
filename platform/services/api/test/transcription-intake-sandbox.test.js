'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/TRANSCRIPTION_INTAKE_SANDBOX.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-transcription-intake-sandbox.json',
);

const REQUIRED_INTAKE_MODES = [
  'disabled',
  'mock_only',
  'read_only_candidate',
  'sanitized_transcription_candidate',
  'blocked_by_registry',
  'blocked_by_security_boundary',
  'blocked_by_permission_overlay',
  'blocked_by_tenant_isolation',
  'blocked_by_cost_rate_limit',
  'blocked_by_retention_policy',
  'safe_fixture_response',
  'safe_error_response',
];

const REQUIRED_ALLOWED_SOURCE_TYPES = [
  'audio_meeting_recording',
  'audio_training_content',
  'audio_customer_service_sample',
  'audio_whatsapp_message_candidate',
  'video_training_content',
  'video_meeting_recording',
  'podcast_training_content',
  'manual_transcript_fixture',
  'sanitized_transcript_text',
  'synthetic_audio_fixture',
];

const REQUIRED_BLOCKED_SOURCE_TYPES = [
  'raw_audio_without_consent',
  'raw_audio_without_tenant',
  'raw_audio_without_retention_policy',
  'raw_transcript_without_sanitization',
  'medical_sensitive_audio',
  'financial_sensitive_audio',
  'payment_or_card_audio',
  'password_or_secret_audio',
  'legal_confidential_audio',
  'employee_private_audio',
  'customer_private_audio_without_policy',
  'child_audio_without_policy',
  'unknown_source_audio',
  'external_client_cross_tenant_audio',
];

const REQUIRED_TRANSCRIPTION_STATUSES = [
  'transcription_mock_success',
  'transcription_mock_blocked',
  'transcription_mock_error_safe',
  'transcription_requires_human_review',
  'transcription_requires_governance_review',
  'transcription_source_not_allowed',
  'transcription_missing_consent_policy',
  'transcription_missing_retention_policy',
  'transcription_sensitive_content_blocked',
  'transcription_not_supported',
  'transcription_deprecated',
];

const REQUIRED_ALLOWED_OUTPUT_TYPES = [
  'sanitized_summary',
  'transcript_quality_hint',
  'language_detected_hint',
  'duration_hint',
  'topic_summary',
  'action_items_candidate',
  'training_module_candidate',
  'quiz_candidate',
  'faq_candidate',
  'customer_intent_summary',
  'sentiment_hint',
  'sensitive_content_flags',
  'confidence_hint',
];

const REQUIRED_PROVIDER_CANDIDATES = [
  'assemblyai',
  'whisper_candidate',
  'transcription_manual_fixture',
  'synthetic_audio_fixture',
];

const REQUIRED_BLOCKING_RULES = [
  'real_provider_call_attempted',
  'assemblyai_real_before_readiness_gate',
  'whisper_real_before_readiness_gate',
  'upload_real_audio_attempted',
  'download_real_audio_attempted',
  'real_transcription_attempted',
  'raw_audio_storage_attempted',
  'raw_transcript_storage_attempted',
  'full_transcript_storage_without_policy',
  'sensitive_data_storage_attempted',
  'missing_workspace_type',
  'missing_tenant_id',
  'missing_user_id',
  'missing_consent_policy',
  'missing_retention_policy',
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
  'fullTranscript',
  'privateUrl',
  'audioUrl',
  'fileUrl',
  'downloadUrl',
  'paymentData',
  'cardData',
  'passwordData',
  'medicalData',
  'legalSensitiveData',
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

test('transcription intake sandbox document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('transcription intake sandbox fixture is safe and complete', () => {
  const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const mode of REQUIRED_INTAKE_MODES) {
    assert.ok(contract.intake_modes.includes(mode), mode);
  }

  for (const sourceType of REQUIRED_ALLOWED_SOURCE_TYPES) {
    assert.ok(contract.allowed_source_types.includes(sourceType), sourceType);
  }

  for (const sourceType of REQUIRED_BLOCKED_SOURCE_TYPES) {
    assert.ok(contract.blocked_source_types.includes(sourceType), sourceType);
  }

  for (const status of REQUIRED_TRANSCRIPTION_STATUSES) {
    assert.ok(contract.transcription_statuses.includes(status), status);
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
  assert.equal(contract.default_rules.consent_policy_required_for_real_audio, true);
  assert.equal(contract.default_rules.retention_policy_required_for_real_audio, true);
  assert.equal(contract.default_rules.raw_audio_allowed, false);
  assert.equal(contract.default_rules.raw_transcript_allowed, false);
  assert.equal(contract.default_rules.full_transcript_allowed, false);
  assert.equal(contract.default_rules.upload_real_audio_allowed, false);
  assert.equal(contract.default_rules.download_real_audio_allowed, false);
  assert.equal(contract.default_rules.storage_implemented, false);
  assert.equal(contract.default_rules.write_allowed, false);
  assert.equal(contract.default_rules.action_allowed, false);
  assert.equal(contract.default_rules.simulated, true);
  assert.equal(contract.default_rules.executed, false);
  assert.equal(contract.default_rules.real_provider_called, false);
  assert.equal(contract.default_rules.can_trigger_real_execution, false);
  assert.equal(contract.default_rules.real_provider_calls_allowed, false);
  assert.equal(contract.default_rules.requires_security_boundary, true);
  assert.equal(contract.default_rules.requires_permission_overlay, true);
  assert.equal(contract.default_rules.requires_tenant_isolation, true);
  assert.equal(contract.default_rules.requires_cost_rate_limit, true);
  assert.equal(contract.default_rules.requires_retention_policy, true);
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

  for (const example of contract.safe_transcription_examples) {
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
