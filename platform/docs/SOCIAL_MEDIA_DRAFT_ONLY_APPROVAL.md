# Hermes Core Social Media Draft-Only Approval

Official contract for future social media draft generation and approval.

This document is a contract only. It does not implement Instagram, Facebook,
Meta Graph API, LinkedIn, TikTok, YouTube, X/Twitter, WhatsApp Business, real
providers, real adapters, external API calls, OAuth, tokens, secrets, media
storage, scheduler, cron, runtime changes, publishing, scheduling, comments,
DMs, likes, follows, deletes, edits, `executed:true` or
`real_provider_called:true`.

## What It Is

Social Media Draft-Only Approval defines how Hermes Core may generate, revise
and approve draft content for future social media workflows. It applies to
Grupo Erick, Hermes Pessoal and external clients, always isolated by workspace,
tenant and brand.

Allowed outputs are drafts: captions, post copy, scripts, hashtags, content
calendars, campaign ideas and suggested replies. No content is published
automatically, and no public or private interaction is executed.

## Objectives

- Define future social platform candidates.
- Define operations allowed only as drafts.
- Define blocked social operations.
- Require `tenant_id`, `workspace_type` and `user_id`.
- Require human review before any future publication flow.
- Require governance review for sensitive content.
- Separate Grupo Erick brands, personal content and external client brands.
- Block cross-tenant publishing and brand misuse.
- Block automatic replies to comments or DMs.
- Block credentials, tokens and real sessions.
- Prepare a safe future path for explicitly approved social media work.

## Official Social Media Modes

- `disabled`
- `mock_only`
- `draft_only_candidate`
- `approval_required`
- `blocked_by_workspace`
- `blocked_by_tenant_isolation`
- `blocked_by_permission_matrix`
- `blocked_by_permission_overlay`
- `blocked_by_security_boundary`
- `blocked_by_governance`
- `blocked_by_human_review`
- `blocked_by_brand_policy`
- `blocked_by_sensitive_content`
- `safe_fixture_response`
- `safe_error_response`

Rules:

- Every mode keeps `simulated:true` in this phase.
- Every mode keeps `executed:false`.
- Every mode keeps `real_provider_called:false`.
- Every mode keeps `can_trigger_real_execution:false`.
- No mode permits real publication, send or interaction.
- `approval_required` means human approval for a draft only.
- No mode calls a real provider.

## Future Platform Candidates

- `instagram_draft_candidate`
- `facebook_draft_candidate`
- `linkedin_draft_candidate`
- `tiktok_draft_candidate`
- `youtube_draft_candidate`
- `x_draft_candidate`
- `whatsapp_business_draft_candidate`
- `google_business_profile_draft_candidate`
- `social_media_manual_fixture`

Rules:

- No candidate is implemented in this PR.
- Every platform starts draft-only.
- WhatsApp Business draft does not send messages.
- YouTube draft does not upload.
- TikTok draft does not publish video.
- Instagram/Facebook draft does not use real Meta Graph API.
- Any real integration requires a future readiness gate.

## Draft Content Types

- `caption_draft`
- `post_copy_draft`
- `story_copy_draft`
- `reel_script_draft`
- `short_video_script_draft`
- `carousel_outline_draft`
- `ad_copy_draft`
- `campaign_idea_draft`
- `hashtag_suggestion`
- `content_calendar_draft`
- `comment_reply_draft`
- `dm_reply_draft`
- `customer_service_reply_draft`
- `promotional_post_draft`
- `educational_post_draft`
- `institutional_post_draft`
- `product_post_draft`
- `training_content_draft`

Rules:

- `comment_reply_draft` is never published automatically.
- `dm_reply_draft` is never sent automatically.
- `ad_copy_draft` does not create a real campaign.
- `content_calendar_draft` does not schedule a real post.
- `product_post_draft` must respect brand policy and tenant.

## Allowed Draft Operations

- `generate_draft`
- `revise_draft`
- `summarize_campaign_brief`
- `generate_caption_candidate`
- `generate_hashtag_candidates`
- `generate_script_candidate`
- `generate_carousel_outline`
- `generate_content_calendar_candidate`
- `generate_reply_candidate`
- `classify_content_risk`
- `request_human_review`
- `request_governance_review`
- `approve_draft_for_internal_use`
- `reject_draft`
- `archive_draft_candidate`
- `duplicate_draft_candidate`

Rules:

- `approve_draft_for_internal_use` approves only text inside the draft flow.
- Approval for internal use does not release publication.
- Archive and duplicate are fixture/future-structure concepts only.
- No method can cause an external action.

## Blocked Operations

- `publish_post_real`
- `publish_story_real`
- `publish_reel_real`
- `upload_video_real`
- `schedule_post_real`
- `create_ad_campaign_real`
- `boost_post_real`
- `send_dm_real`
- `reply_dm_real`
- `reply_comment_real`
- `delete_comment_real`
- `hide_comment_real`
- `like_post_real`
- `follow_account_real`
- `unfollow_account_real`
- `share_post_real`
- `delete_post_real`
- `edit_published_post_real`
- `tag_user_real`
- `mention_user_real`
- `create_live_stream_real`
- `start_live_stream_real`
- `create_social_account_real`
- `change_account_settings_real`
- `oauth_token_exchange`
- `refresh_token_use`
- `social_session_cookie_use`
- `cross_tenant_publish`
- `cross_workspace_publish`

## Future Use Cases

### Grupo Erick

- create drafts for Grupo Erick brands and stores
- create seasonal campaigns
- create editorial calendars
- create video scripts
- create suggested customer-service replies
- never publish, reply or send automatically

### Hermes Pessoal

- create personal content in the personal workspace
- never use Grupo Erick brands without future authenticated workspace switch
- never mix personal data with corporate content
- never publish automatically

### Clientes Externos

- each client uses only `client::<client_id>`
- drafts follow client brand and policy
- never access Grupo Erick brands or campaigns
- never access another client
- no client token can be used by another client

## Official Brand Scopes

- `personal_brand`
- `grupo_erick_brand`
- `grupo_erick_store_brand`
- `external_client_brand`
- `campaign_specific_brand`
- `manual_fixture_brand`

Rules:

- `brand_scope` is required.
- `brand_id` is required for Grupo Erick and external clients.
- `store_id` may be required for store campaigns.
- `client_id` is required for `external_client`.
- Brand cannot be selected only by prompt.
- Tenant and workspace determine allowed brands.
- Brand content remains in the matching tenant.

## Future Social Draft Request Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `role`
- `client_id`
- `company_id`
- `store_id`
- `brand_id`
- `brand_scope`
- `platform_candidate`
- `social_mode`
- `domain`
- `capability`
- `intent`
- `operation_type`
- `content_type`
- `campaign_id`
- `audience_hint`
- `tone_hint`
- `language_hint`
- `product_context_sanitized`
- `read_allowed`
- `draft_allowed`
- `write_allowed`
- `action_allowed`
- `publish_allowed`
- `send_allowed`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `requires_human_review`
- `requires_governance_review`
- `requires_security_boundary`
- `requires_permission_matrix`
- `requires_permission_overlay`
- `requires_tenant_isolation`
- `requires_brand_policy`
- `sanitized_input`
- `blocked_reason`

Rules:

- `workspace_type`, `tenant_id`, `user_id`, `brand_scope`,
  `platform_candidate` and `content_type` are required.
- `draft_allowed:true` may exist.
- `write_allowed:false`, `action_allowed:false`, `publish_allowed:false` and
  `send_allowed:false`.
- `executed:false`.
- `real_provider_called:false` in this phase.
- `sanitized_input` cannot contain raw messages, raw payloads, tokens, secrets,
  headers, cookies, credentials or social sessions.

## Future Social Draft Response Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `brand_id`
- `brand_scope`
- `platform_candidate`
- `social_mode`
- `operation_type`
- `content_type`
- `status`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `draft_content`
- `caption_candidate`
- `hashtag_candidates`
- `script_candidate`
- `carousel_outline_candidate`
- `reply_candidate`
- `content_risk_level`
- `sensitive_content_flags`
- `brand_policy_flags`
- `approval_status`
- `publish_allowed`
- `send_allowed`
- `blocked_reason`
- `error_code`
- `audit_event_candidate`
- `next_review_step`
- `human_review_required`
- `governance_review_required`

Rules:

- `simulated:true`.
- `executed:false`.
- `real_provider_called:false`.
- `can_trigger_real_execution:false`.
- `publish_allowed:false`.
- `send_allowed:false`.
- Every output is a draft.
- `approval_status` does not release real publication.
- `reply_candidate` does not send replies.
- Responses cannot contain tokens, session cookies, raw payloads, credentials or
  sensitive personal data.

## Official Statuses

- `social_draft_mock_success`
- `social_draft_mock_blocked`
- `social_draft_mock_error_safe`
- `social_draft_requires_human_review`
- `social_draft_requires_governance_review`
- `social_draft_brand_scope_blocked`
- `social_draft_workspace_blocked`
- `social_draft_permission_blocked`
- `social_draft_sensitive_content_blocked`
- `social_draft_publish_blocked`
- `social_draft_send_blocked`
- `social_draft_oauth_policy_missing`
- `social_draft_not_supported`
- `social_draft_deprecated`

No status authorizes publication or real execution.

## Official Approval Statuses

- `draft_created`
- `draft_revision_requested`
- `draft_pending_human_review`
- `draft_pending_governance_review`
- `draft_approved_for_internal_use`
- `draft_rejected`
- `draft_blocked`
- `draft_expired`
- `draft_archived`

Rules:

- `draft_approved_for_internal_use` is not publish approval.
- No status activates a real provider.
- No status changes `executed:false`.
- No status changes `publish_allowed:false`.

## Content Risk Levels

- `low`
- `medium`
- `high`
- `critical`
- `unknown`

High/critical examples include financial promotions, medical claims, content
for minors, regulated giveaways, lotteries/gaming, credit, personal data,
politics, legal content, outcome promises, misleading advertising,
discriminatory content and reputational crises.

Rules:

- `unknown` requires governance review.
- `high` requires human review and governance review.
- `critical` remains blocked in this phase.
- Quality score never replaces review.

## Allowed Sanitized Output

- `draft_content`
- `caption_candidate`
- `hashtag_candidates`
- `script_candidate`
- `carousel_outline_candidate`
- `reply_candidate`
- `campaign_summary`
- `content_calendar_candidate`
- `content_risk_summary`
- `brand_policy_summary`
- `tone_summary`
- `audience_summary`
- `freshness_hint`
- `confidence_hint`

Blocked output fields include access tokens, refresh tokens, session cookies,
OAuth codes, raw social payloads, raw DMs, raw comments, raw profiles, private
audience data, raw messages, raw payloads, credentials, secrets, headers,
cookies, passwords, private URLs, raw media and cross-tenant brand data.

## Future OAuth And Token Policy

- This PR does not implement OAuth.
- Tokens cannot enter fixtures, logs or memory.
- Session cookies are prohibited.
- OAuth scopes must be minimal.
- Future publication requires its own policy.
- Revocation must exist before real integration.
- Secret management is required before any real provider.
- Readiness gate, sanitized audit and kill switch are mandatory.

## Tenant, Workspace And Brand Rules

- Every request needs `workspace_type`, `tenant_id` and `user_id`.
- Hermes Pessoal uses `personal::<user_id>`.
- Grupo Erick uses `grupo_erick`.
- External clients use `client::<client_id>`.
- `brand_scope` must match tenant.
- Grupo Erick cannot publish to external client accounts.
- External clients cannot use Grupo Erick brands.
- External client A cannot use external client B brands.
- Connectors/providers and prompts cannot alter `tenant_id`.
- Prompts cannot choose `brand_id` outside the tenant.
- Future cache and media storage need tenant and brand namespaces.

## Permission And Review Rules

- Draft generation requires marketing/content permission.
- Draft review requires the appropriate permission.
- Internal-use approval requires human review.
- High/critical content requires governance review.
- Role never authorizes real publication by itself.
- Future super_admin does not remove tenant isolation or audit.
- Future super_admin does not authorize publication in this phase.
- Human confirmation does not replace readiness gate.
- Draft approval does not replace future publication confirmation.

## Blocking Rules

Future PRs must be blocked when they:

- implement real social providers before readiness gate
- implement real OAuth without policy
- add tokens, secrets or session cookies
- publish, schedule, upload, create ads, send/reply DMs or reply comments
- delete/hide comments, like, follow, share, delete or edit real posts
- use a brand or social account outside the tenant
- mix personal, Grupo Erick or external client content
- allow prompts/providers to alter tenant or brand scope
- remove human review or governance review for high/critical content
- store raw social payloads, raw DMs or raw comments
- allow `publish_allowed:true`, `send_allowed:true`, `executed:true`,
  `real_provider_called:true`, `write_allowed:true` or `action_allowed:true`

## Relationship With Existing Contracts

- `TENANT_WORKSPACE_ISOLATION.md`: social drafts stay tenant-scoped.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: social candidates must be
  registered before sandbox work.
- `INTEGRATION_SECURITY_BOUNDARY.md`: social data must stay inside security
  boundaries.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: platform/domain/capability use
  must pass overlay rules.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: this phase uses only safe mock
  and fixture behavior.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: future providers need audit,
  cost, rate and stop-condition rules.
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: public web reads do not unlock posting.
- `TRANSCRIPTION_INTAKE_SANDBOX.md`: transcription does not unlock posting.
- `INTERNAL_BUSINESS_API_READ_ONLY.md`: business data remains read-only.
- `PERSONAL_WORKSPACE_CONNECTOR_POLICY.md`: personal connectors stay personal.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe social changes.
- `PERMISSION_MATRIX.md`: domain permissions remain primary.
- `GOLDEN_SCENARIOS.md`: future social flows need safe scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: social output cannot become memory without policy.
- `USER_PEER_MEMORY_SCOPES.md`: user/peer memory remains scoped.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: social output can only become future inbox
  candidates after sanitization.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores cannot approve publishing.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot become executable social agents.
- `OPERATOR_RUNBOOK.md`: operators must validate future social changes.

## Security, LGPD And Brand

- Data minimization.
- No raw DMs, raw comments, follower data or private audience data.
- No social credentials or tokens.
- No automatic publishing.
- Client content stays in the client tenant.
- Grupo Erick content stays in the Grupo Erick tenant.
- Personal content stays in the personal workspace.
- Brand, tone and audience must remain in scope.
- Draft is not publication.
- Internal approval is not publication authorization.


## External Client Workspace Connector Policy

`docs/EXTERNAL_CLIENT_WORKSPACE_CONNECTOR_POLICY.md` documents the contract-only
policy for future external client SaaS connectors. It keeps every connector
scoped to `workspace_type=external_client`, `tenant_id=client::<client_id>` and
`client_id`, blocks cross-client access, and does not implement real connectors,
OAuth, tokens, APIs, storage, cache, memory, providers, adapters or runtime
changes. It keeps mock-first, read-only first, human review, governance review,
`simulated:true`, `executed:false`, `real_provider_called:false`, `send_allowed:false` and `publish_allowed:false` mandatory.


## Corporate Workspace Connector Policy

`docs/CORPORATE_WORKSPACE_CONNECTOR_POLICY.md` documents the contract-only
policy for future Grupo Erick corporate connectors. It keeps corporate access
scoped to `workspace_type=corporate`, `tenant_id=grupo_erick` and
`organization_id=grupo_erick`, blocks personal and external-client context,
and does not implement real corporate connectors, OAuth, tokens, APIs, storage,
cache, memory, providers, adapters or runtime changes. It keeps mock-first,
read-only first, human review, governance review, `simulated:true`, `executed:false`, `real_provider_called:false`, `send_allowed:false` and
`publish_allowed:false` mandatory.
