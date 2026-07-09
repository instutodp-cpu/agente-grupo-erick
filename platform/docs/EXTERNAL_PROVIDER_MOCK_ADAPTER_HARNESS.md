# Hermes Core External Provider Mock Adapter Harness

Official contract for the External Provider Mock Adapter Harness.

This document is a contract only. It does not implement a real provider, real
adapter, real OAuth, real secret, storage, MCP, external API call, runtime
change or any path to `executed:true`.

## What It Is

External Provider Mock Adapter Harness defines how future external providers are
simulated before any real integration exists. It is used to test response shape,
security controls, audit fields and decision handling with static fixtures and
synthetic data only.

The harness does not call external APIs, does not create real adapters, does
not create OAuth/secrets, does not replace Provider Registry, does not replace
Integration Security Boundary, does not replace External Provider Permission
Overlay, does not replace human confirmation and does not authorize
`executed:true`.

## Objectives

- Enforce mock-first for every external provider.
- Standardize mock provider input and output.
- Simulate safe success, safe blocking and safe error paths.
- Ensure every mock result is sanitized.
- Ensure no mock contains real data, token, secret, raw payload or raw user
  message.
- Validate the relationship with Provider Registry, Security Boundary and
  Permission Overlay.
- Prepare future read-only sandbox work without executing anything real.
- Allow safe audit with `simulated:true` and `executed:false`.

## Official Adapter Modes

- `mock_only`
- `blocked_by_registry`
- `blocked_by_security_boundary`
- `blocked_by_permission_overlay`
- `blocked_by_governance`
- `safe_fixture_response`
- `safe_error_response`

Rules:

- every mode keeps `executed:false`
- every mode keeps `real_provider_called:false`
- every mode keeps `can_trigger_real_execution:false`
- no mode allows write/action
- no mode calls a real provider

## Provider Mock Scopes

- `provider_type_mock`
- `provider_id_mock`
- `domain_mock`
- `capability_mock`
- `blocked_mock`
- `audit_mock`

## Mock Adapter Request Contract

Minimum fields:

- `trace_id`
- `provider_id`
- `provider_type`
- `domain`
- `capability`
- `intent`
- `provider_permission_state`
- `risk_level`
- `adapter_mode`
- `simulated`
- `executed`
- `real_provider_called`
- `read_allowed`
- `write_allowed`
- `action_allowed`
- `requires_human_review`
- `requires_governance_review`
- `requires_security_boundary`
- `requires_provider_registry_entry`
- `requires_permission_overlay`
- `confirmation_required`
- `sanitized_input`
- `blocked_reason`

Rules:

- `simulated = true`
- `executed = false`
- `real_provider_called = false`
- `write_allowed = false`
- `action_allowed = false`
- `sanitized_input` cannot contain `rawMessage`, `userMessage`, internal
  payloads or secrets.

## Mock Adapter Response Contract

Minimum fields:

- `trace_id`
- `provider_id`
- `provider_type`
- `domain`
- `capability`
- `adapter_mode`
- `status`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `safe_result`
- `safe_summary`
- `sanitized_output`
- `blocked_reason`
- `error_code`
- `audit_event_candidate`
- `next_review_step`
- `human_review_required`
- `governance_review_required`

Rules:

- `simulated = true`
- `executed = false`
- `real_provider_called = false`
- `can_trigger_real_execution = false`
- `safe_result` cannot contain raw data.
- `sanitized_output` cannot contain raw data.
- `audit_event_candidate` cannot contain secrets, raw payloads or raw user
  messages.

## Official Mock Response Statuses

- `mock_success`
- `mock_blocked`
- `mock_error_safe`
- `mock_requires_human_review`
- `mock_requires_governance_review`
- `mock_not_supported`
- `mock_deprecated`

No status authorizes real execution.

## Mock Result Types By Provider Type

### public_web_scraping

- result types: `safe_summary`, `public_result_snippet`
- `source_type`: `public_web`
- raw HTML is prohibited
- private or authenticated scraping is prohibited

### app_integration_hub

- result types: `safe_summary`, `connected_app_candidate`
- real OAuth is prohibited
- Gmail send, Calendar modify and Drive write are prohibited

### transcription_provider

- result types: `sanitized_summary`, `transcript_quality_hint`
- raw audio is prohibited
- raw transcript is prohibited

### social_media_provider

- result types: `draft_text`, `suggested_schedule`, `comment_summary`
- real post, DM and reply are prohibited

### direct_platform_api

- result types: `public_read_summary`, `draft_text`
- real post is prohibited

### internal_business_api

- result types: `safe_business_summary`, `synthetic_metric_sample`
- real ERP/CRM/Supabase/Base44 write is prohibited
- money movement is prohibited

### internal_mcp_server

- result types: `tool_manifest_summary`, `read_only_tool_candidate`
- action tools are prohibited

### developer_platform

- result types: `pr_summary`, `issue_summary`, `docs_summary`
- push, merge and write are prohibited

## Required Provider Candidate Mock Coverage

The harness contract covers these future provider candidates:

- `firecrawl`
- `bright_data`
- `scrapeless`
- `composio`
- `google_workspace_super`
- `assemblyai`
- `social_media_api`
- `x_direct_api`
- `internal_business_api`
- `internal_mcp_server`
- `github_connector`

## Blocking Rules

Mock must return blocked when:

- provider id does not exist in the registry
- provider type does not exist in the registry
- provider does not satisfy Permission Overlay
- provider violates Security Boundary
- `write_allowed` is true
- `action_allowed` is true
- `can_trigger_real_execution` is true
- `executed` is true
- `real_provider_called` is true
- real OAuth is attempted
- real secret is attempted
- real external API call is attempted
- real storage is attempted
- raw audio, transcript, HTML or payload is attempted
- real social post is attempted
- real email send is attempted
- real calendar modify is attempted
- money movement is attempted
- ERP/CRM/database write is attempted
- MCP action tool is attempted
- cross-tenant, cross-user or cross-domain leakage is attempted

## Relationship With Existing Contracts

- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: every mock provider must have a
  provider registry candidate.
- `INTEGRATION_SECURITY_BOUNDARY.md`: mock requests and responses must stay
  inside the security boundary.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability
  combinations must be allowed by the overlay.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe mock contract
  changes.
- `PERMISSION_MATRIX.md`: domain/capability permissions remain primary.
- `GOLDEN_SCENARIOS.md`: provider mock flows need safe scenarios before
  expansion.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: mock output cannot become memory without future
  sanitization and review.
- `USER_PEER_MEMORY_SCOPES.md`: user and tenant isolation remain mandatory.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: mock output can only become future inbox
  candidates after sanitization.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores cannot approve real provider
  calls.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot become executable provider
  automations.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: mock requests and responses can
  produce only sanitized audit/cost/rate-limit examples and cannot create real
  provider calls, retries, rate limiters or budget trackers.
- `TENANT_WORKSPACE_ISOLATION.md`: mock requests and responses must remain
  synthetic and scoped to a single workspace and tenant.
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: public web mock examples must remain
  synthetic, public-only and free of raw HTML or real provider calls.
- `TRANSCRIPTION_INTAKE_SANDBOX.md`: transcription mock examples must remain
  synthetic or sanitized and free of raw audio, raw transcripts, uploads and
  real provider calls.
- `INTERNAL_BUSINESS_API_READ_ONLY.md`: internal business mock examples must
  remain synthetic, read-only and free of raw SQL, raw database payloads,
  writeback and real provider calls.
- `PERSONAL_WORKSPACE_CONNECTOR_POLICY.md`: personal connector mock examples
  must remain synthetic, personal-workspace-only and free of OAuth tokens, raw
  email, raw files, send/write/delete/share and real connector calls.
- `OPERATOR_RUNBOOK.md`: operators must use the runbook for validation,
  rollback and future adapter PR rules.

## Security And LGPD

- mock uses synthetic data only
- mock does not use real Grupo Erick data
- mock does not use real customer, employee or supplier data
- mock does not store data
- mock does not call providers
- mock does not log raw content
- future output must be sanitized
- future personal data requires minimization and retention policy
