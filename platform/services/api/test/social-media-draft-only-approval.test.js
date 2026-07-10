'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docPath = path.resolve(__dirname, '../../../docs/SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md');
const fixturePath = path.resolve(
  __dirname,
  'fixtures/hermes-social-media-draft-only-approval.json',
);

const REQUIRED_SOCIAL_MODES = [
  'disabled',
  'mock_only',
  'draft_only_candidate',
  'approval_required',
  'blocked_by_workspace',
  'blocked_by_tenant_isolation',
  'blocked_by_permission_matrix',
  'blocked_by_permission_overlay',
  'blocked_by_security_boundary',
  'blocked_by_governance',
  'blocked_by_human_review',
  'blocked_by_brand_policy',
  'blocked_by_sensitive_content',
  'safe_fixture_response',
  'safe_error_response',
];

const REQUIRED_PLATFORM_CANDIDATES = [
  'instagram_draft_candidate',
  'facebook_draft_candidate',
  'linkedin_draft_candidate',
  'tiktok_draft_candidate',
  'youtube_draft_candidate',
  'x_draft_candidate',
  'whatsapp_business_draft_candidate',
  'google_business_profile_draft_candidate',
  'social_media_manual_fixture',
];

const REQUIRED_DRAFT_CONTENT_TYPES = [
  'caption_draft',
  'post_copy_draft',
  'story_copy_draft',
  'reel_script_draft',
  'short_video_script_draft',
  'carousel_outline_draft',
  'ad_copy_draft',
  'campaign_idea_draft',
  'hashtag_suggestion',
  'content_calendar_draft',
  'comment_reply_draft',
  'dm_reply_draft',
  'customer_service_reply_draft',
  'promotional_post_draft',
  'educational_post_draft',
  'institutional_post_draft',
  'product_post_draft',
  'training_content_draft',
];

const REQUIRED_DRAFT_OPERATIONS = [
  'generate_draft',
  'revise_draft',
  'summarize_campaign_brief',
  'generate_caption_candidate',
  'generate_hashtag_candidates',
  'generate_script_candidate',
  'generate_carousel_outline',
  'generate_content_calendar_candidate',
  'generate_reply_candidate',
  'classify_content_risk',
  'request_human_review',
  'request_governance_review',
  'approve_draft_for_internal_use',
  'reject_draft',
  'archive_draft_candidate',
  'duplicate_draft_candidate',
];

const REQUIRED_BLOCKED_OPERATIONS = [
  'publish_post_real',
  'publish_story_real',
  'publish_reel_real',
  'upload_video_real',
  'schedule_post_real',
  'create_ad_campaign_real',
  'boost_post_real',
  'send_dm_real',
  'reply_dm_real',
  'reply_comment_real',
  'delete_comment_real',
  'hide_comment_real',
  'like_post_real',
  'follow_account_real',
  'unfollow_account_real',
  'share_post_real',
  'delete_post_real',
  'edit_published_post_real',
  'tag_user_real',
  'mention_user_real',
  'create_live_stream_real',
  'start_live_stream_real',
  'create_social_account_real',
  'change_account_settings_real',
  'oauth_token_exchange',
  'refresh_token_use',
  'social_session_cookie_use',
  'cross_tenant_publish',
  'cross_workspace_publish',
];

const REQUIRED_BRAND_SCOPES = [
  'personal_brand',
  'grupo_erick_brand',
  'grupo_erick_store_brand',
  'external_client_brand',
  'campaign_specific_brand',
  'manual_fixture_brand',
];

const REQUIRED_SOCIAL_STATUSES = [
  'social_draft_mock_success',
  'social_draft_mock_blocked',
  'social_draft_mock_error_safe',
  'social_draft_requires_human_review',
  'social_draft_requires_governance_review',
  'social_draft_brand_scope_blocked',
  'social_draft_workspace_blocked',
  'social_draft_permission_blocked',
  'social_draft_sensitive_content_blocked',
  'social_draft_publish_blocked',
  'social_draft_send_blocked',
  'social_draft_oauth_policy_missing',
  'social_draft_not_supported',
  'social_draft_deprecated',
];

const REQUIRED_APPROVAL_STATUSES = [
  'draft_created',
  'draft_revision_requested',
  'draft_pending_human_review',
  'draft_pending_governance_review',
  'draft_approved_for_internal_use',
  'draft_rejected',
  'draft_blocked',
  'draft_expired',
  'draft_archived',
];

const REQUIRED_RISK_LEVELS = ['low', 'medium', 'high', 'critical', 'unknown'];

const REQUIRED_OUTPUT_TYPES = [
  'draft_content',
  'caption_candidate',
  'hashtag_candidates',
  'script_candidate',
  'carousel_outline_candidate',
  'reply_candidate',
  'campaign_summary',
  'content_calendar_candidate',
  'content_risk_summary',
  'brand_policy_summary',
  'tone_summary',
  'audience_summary',
  'freshness_hint',
  'confidence_hint',
];

const REQUIRED_BLOCKING_RULES = [
  'instagram_real_before_readiness_gate',
  'facebook_meta_real_before_readiness_gate',
  'linkedin_real_before_readiness_gate',
  'tiktok_real_before_readiness_gate',
  'youtube_real_before_readiness_gate',
  'x_real_before_readiness_gate',
  'whatsapp_business_real_before_readiness_gate',
  'oauth_real_without_policy',
  'token_secret_or_session_added',
  'real_post_publish_attempted',
  'real_story_publish_attempted',
  'real_reel_publish_attempted',
  'real_video_upload_attempted',
  'real_schedule_attempted',
  'real_ad_campaign_attempted',
  'real_dm_send_or_reply_attempted',
  'real_comment_reply_attempted',
  'real_comment_delete_or_hide_attempted',
  'real_like_follow_share_attempted',
  'real_post_delete_attempted',
  'real_published_post_edit_attempted',
  'brand_outside_tenant',
  'social_account_outside_tenant',
  'personal_to_grupo_erick_context',
  'grupo_erick_to_external_client_context',
  'missing_workspace_type',
  'missing_tenant_id',
  'missing_user_id',
  'missing_brand_scope',
  'missing_platform_candidate',
  'missing_content_type',
  'prompt_tenant_override_attempt',
  'provider_tenant_override_attempt',
  'prompt_brand_override_attempt',
  'human_review_removed',
  'governance_review_removed_for_high_risk',
  'raw_social_payload_storage_attempted',
  'raw_dm_or_comment_storage_attempted',
  'publish_allowed_true',
  'send_allowed_true',
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
  'oauthCode',
  'socialSessionCookie',
  'requestBody',
  'responseBody',
  'rawSocialPayload',
  'rawDm',
  'rawComment',
  'rawUserProfile',
  'privateFollowerData',
  'privateAudienceData',
  'privateUrl',
  'unpublishedMediaRaw',
  'customerSensitiveData',
  'personalSensitiveData',
  'crossTenantBrandData',
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

test('social media draft-only approval document and fixture exist', () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test('social media draft-only approval fixture is safe and complete', () => {
  const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const forbiddenFieldSet = new Set(REQUIRED_FORBIDDEN_FIELDS);

  for (const mode of REQUIRED_SOCIAL_MODES) {
    assert.ok(contract.social_modes.includes(mode), mode);
  }

  for (const platform of REQUIRED_PLATFORM_CANDIDATES) {
    assert.ok(contract.platform_candidates.includes(platform), platform);
  }

  for (const contentType of REQUIRED_DRAFT_CONTENT_TYPES) {
    assert.ok(contract.allowed_draft_content_types.includes(contentType), contentType);
  }

  for (const operation of REQUIRED_DRAFT_OPERATIONS) {
    assert.ok(contract.allowed_draft_operations.includes(operation), operation);
  }

  for (const operation of REQUIRED_BLOCKED_OPERATIONS) {
    assert.ok(contract.blocked_operations.includes(operation), operation);
  }

  for (const brandScope of REQUIRED_BRAND_SCOPES) {
    assert.ok(contract.brand_scopes.includes(brandScope), brandScope);
  }

  for (const status of REQUIRED_SOCIAL_STATUSES) {
    assert.ok(contract.social_draft_statuses.includes(status), status);
  }

  for (const status of REQUIRED_APPROVAL_STATUSES) {
    assert.ok(contract.approval_statuses.includes(status), status);
  }

  for (const riskLevel of REQUIRED_RISK_LEVELS) {
    assert.ok(contract.content_risk_levels.includes(riskLevel), riskLevel);
  }

  for (const outputType of REQUIRED_OUTPUT_TYPES) {
    assert.ok(contract.allowed_sanitized_output_types.includes(outputType), outputType);
  }

  assert.equal(contract.default_rules.workspace_type_required, true);
  assert.equal(contract.default_rules.tenant_id_required, true);
  assert.equal(contract.default_rules.user_id_required, true);
  assert.equal(contract.default_rules.brand_scope_required, true);
  assert.equal(contract.default_rules.platform_candidate_required, true);
  assert.equal(contract.default_rules.content_type_required, true);
  assert.equal(contract.default_rules.tenant_brand_match_required, true);
  assert.equal(contract.default_rules.draft_only, true);
  assert.equal(contract.default_rules.human_review_required, true);
  assert.equal(contract.default_rules.governance_review_required_for_high_risk, true);
  assert.equal(contract.default_rules.critical_content_blocked, true);
  assert.equal(contract.default_rules.write_allowed, false);
  assert.equal(contract.default_rules.action_allowed, false);
  assert.equal(contract.default_rules.publish_allowed, false);
  assert.equal(contract.default_rules.send_allowed, false);
  assert.equal(contract.default_rules.schedule_allowed, false);
  assert.equal(contract.default_rules.interaction_allowed, false);
  assert.equal(contract.default_rules.simulated, true);
  assert.equal(contract.default_rules.executed, false);
  assert.equal(contract.default_rules.real_provider_called, false);
  assert.equal(contract.default_rules.can_trigger_real_execution, false);
  assert.equal(contract.default_rules.real_social_calls_allowed, false);
  assert.equal(contract.default_rules.oauth_implemented, false);
  assert.equal(contract.default_rules.token_storage_implemented, false);
  assert.equal(contract.default_rules.media_storage_implemented, false);
  assert.equal(contract.default_rules.scheduler_implemented, false);
  assert.equal(contract.default_rules.requires_security_boundary, true);
  assert.equal(contract.default_rules.requires_permission_matrix, true);
  assert.equal(contract.default_rules.requires_permission_overlay, true);
  assert.equal(contract.default_rules.requires_tenant_isolation, true);
  assert.equal(contract.default_rules.requires_brand_policy, true);
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

  for (const example of contract.safe_social_draft_examples) {
    assert.equal(example.simulated, true, example.name);
    assert.equal(example.executed, false, example.name);
    assert.equal(example.real_provider_called, false, example.name);
    assert.equal(example.can_trigger_real_execution, false, example.name);
    assert.equal(example.write_allowed, false, example.name);
    assert.equal(example.action_allowed, false, example.name);
    assert.equal(example.publish_allowed, false, example.name);
    assert.equal(example.send_allowed, false, example.name);

    walkKeys(example, (key, value) => {
      assert.equal(forbiddenFieldSet.has(key), false, `${example.name}:${key}`);

      if (typeof value === 'string') {
        assert.equal(/^https?:\/\//i.test(value), false, `${example.name}:${key}`);
      }
    });
  }
});
