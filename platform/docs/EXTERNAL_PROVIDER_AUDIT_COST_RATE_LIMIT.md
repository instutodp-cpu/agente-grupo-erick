# Hermes Core External Provider Audit, Cost and Rate Limit

Official contract for external provider audit, cost and rate limit controls.

This document is a contract only. It does not implement a real provider, real
adapter, real OAuth, real secret, storage, MCP, scheduler, cron, external API
call, runtime change or any path to `executed:true` or
`real_provider_called:true`.

## What It Is

External Provider Audit, Cost and Rate Limit defines how Hermes Core will
control audit, cost, usage limits, fallback and stop conditions for future
external providers. It exists to prevent unexpected cost, API abuse, rate-limit
failure, data leakage and out-of-governance execution before any read-only
sandbox or real adapter work.

It does not call providers, does not create storage, does not create scheduler
behavior, does not replace Provider Registry, Security Boundary, Permission
Overlay, Mock Adapter Harness or human confirmation, and does not authorize
`executed:true`.

## Objectives

- Define minimum audit fields for external providers.
- Define cost controls before future real calls.
- Define rate limit controls before future real calls.
- Define fallback policies.
- Define stop conditions.
- Define budget guardrails by provider, domain and tenant.
- Define what can and cannot enter audit events.
- Keep logs sanitized.
- Ensure failures are safe.
- Ensure cost/rate controls never unlock real execution by themselves.

## Provider Audit Event Contract

Allowed audit fields:

- `trace_id`
- `event_id`
- `event_type`
- `provider_id`
- `provider_type`
- `domain`
- `capability`
- `adapter_mode`
- `provider_permission_state`
- `risk_level`
- `status`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `read_allowed`
- `write_allowed`
- `action_allowed`
- `human_review_required`
- `governance_review_required`
- `confirmation_required`
- `confirmation_id`
- `cost_risk`
- `rate_limit_risk`
- `estimated_cost_units`
- `budget_scope`
- `rate_limit_scope`
- `fallback_policy`
- `stop_condition`
- `blocked_reason`
- `error_code`
- `timestamp`

Rules:

- `simulated:true` in this phase.
- `executed:false` always.
- `real_provider_called:false` in this phase.
- `can_trigger_real_execution:false` always.
- `write_allowed:false` in this phase.
- `action_allowed:false` in this phase.
- audit events cannot contain tokens, secrets, env, headers, cookies,
  credentials, raw payloads, raw messages, raw transcripts, raw audio or private
  URLs.

## Official Event Types

- `external_provider_mock_requested`
- `external_provider_mock_completed`
- `external_provider_mock_blocked`
- `external_provider_cost_estimated`
- `external_provider_rate_limit_checked`
- `external_provider_fallback_selected`
- `external_provider_stop_condition_triggered`
- `external_provider_governance_review_required`
- `external_provider_human_review_required`
- `external_provider_real_call_blocked`

No event type authorizes a real provider call.

## Cost Risk Levels

- `none`
- `low`
- `medium`
- `high`
- `critical`
- `unknown`

Rules:

- `unknown` blocks promotion to real sandbox.
- `high` and `critical` require governance review.
- paid providers require a budget scope before sandbox.
- providers billed per request, minute, token or hour require stop conditions.
- cost never authorizes real execution.

## Rate Limit Risk Levels

- `none`
- `low`
- `medium`
- `high`
- `critical`
- `unknown`

Rules:

- `unknown` blocks promotion to real sandbox.
- `high` and `critical` require fallback and stop conditions.
- rate limit never authorizes real execution.
- a provider without documented rate limit cannot become read-only sandbox.

## Budget Scopes

- `provider`
- `provider_type`
- `domain`
- `tenant`
- `user`
- `environment`
- `daily`
- `monthly`
- `per_request`

These are contracts only in this phase; no real counter is implemented.

## Rate Limit Scopes

- `provider`
- `provider_type`
- `domain`
- `tenant`
- `user`
- `environment`
- `per_minute`
- `per_hour`
- `per_day`

These are contracts only in this phase; no real rate limiter is implemented.

## Fallback Policies

- `no_fallback`
- `safe_mock_fallback`
- `cached_safe_summary_candidate`
- `manual_review_required`
- `provider_disabled`
- `stop_and_report`
- `retry_later_not_automatic`

Rules:

- automatic real retry is prohibited in this phase.
- fallback cannot call another real provider.
- fallback cannot bypass Security Boundary.
- fallback cannot bypass Permission Overlay.
- fallback cannot execute an action.

## Stop Conditions

- `cost_unknown`
- `budget_missing`
- `rate_limit_unknown`
- `provider_not_registered`
- `permission_overlay_blocked`
- `security_boundary_blocked`
- `governance_review_missing`
- `human_review_missing`
- `forbidden_field_detected`
- `raw_content_detected`
- `real_provider_call_attempted`
- `write_action_attempted`
- `cross_tenant_user_domain_risk`
- `repeated_safe_errors`
- `provider_deprecated`

## Provider Type Rules

### public_web_scraping

- cost and rate limit are mandatory before sandbox.
- fallback is mandatory when provider is unavailable.
- raw scraping without policy blocks promotion.
- automatic real retry is prohibited.

### app_integration_hub

- OAuth, cost and limits must be scoped per app and user.
- Gmail/Calendar write/send/modify remains blocked.
- any real call is blocked in this phase.

### transcription_provider

- cost per minute/hour needs budget.
- raw audio/transcript is prohibited.
- future output must be `sanitized_summary`.
- stop when cost is unknown or retention is missing.

### social_media_provider

- real post, DM and reply are blocked.
- cost/rate limit is scoped by platform.
- reputational risk is treated as high or critical.
- fallback must be draft/manual review.

### direct_platform_api

- cost and reputation are high by default.
- real post is blocked.
- unknown rate limit blocks sandbox.

### internal_business_api

- critical.
- any write/mutation is blocked.
- budget may be low, but compliance is critical.
- stop when cross-tenant/user/domain risk appears.

### internal_mcp_server

- critical.
- action tools are blocked.
- tool discovery must be auditable and sanitized.
- stop when tool manifest exposes secret, payload or action.

### developer_platform

- future read can be a candidate.
- push, merge and write are blocked.
- rate limit must be documented before sandbox.

## Blocking Rules

Future PRs must be blocked when they:

- attempt `real_provider_called:true`
- attempt `executed:true`
- attempt `write_allowed:true`
- attempt `action_allowed:true`
- call a real external provider
- add automatic real retry
- add cost without budget scope
- add provider without rate limit risk
- add provider with `cost_risk: unknown` in sandbox
- add provider with `rate_limit_risk: unknown` in sandbox
- add fallback that calls another real provider
- add logs with secrets, raw payload or raw message
- add raw content storage
- add scraping/transcription without retention policy
- allow cross-tenant, cross-user or cross-domain leakage
- remove kill switch
- remove confirmation gate

## Relationship With Existing Contracts

- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: provider cost/rate rules must
  match the registry risk.
- `INTEGRATION_SECURITY_BOUNDARY.md`: audit/cost/rate fields must stay inside
  the security boundary.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability must be
  allowed before any mock or sandbox.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: mock audit examples must remain
  synthetic and safe.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe cost/rate changes.
- `PERMISSION_MATRIX.md`: domain/capability permissions remain primary.
- `GOLDEN_SCENARIOS.md`: provider flows need safe scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: audit output cannot become memory without future
  sanitization and review.
- `USER_PEER_MEMORY_SCOPES.md`: user and tenant isolation remain mandatory.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: audit output can only become future inbox
  candidates after sanitization.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores cannot approve costs,
  retries or real provider calls.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot become executable provider
  automations.
- `OPERATOR_RUNBOOK.md`: operators must use the runbook for validation,
  rollback and future provider PR rules.
- `TENANT_WORKSPACE_ISOLATION.md`: provider audit, cost and rate-limit metadata
  must include workspace/tenant scope before any future sandbox.
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: public web sandbox events must include
  audit/cost/rate-limit metadata before any future read-only provider work.
- `TRANSCRIPTION_INTAKE_SANDBOX.md`: transcription sandbox events must include
  audit/cost/rate-limit and retention metadata before any future sanitized
  provider work.
- `INTERNAL_BUSINESS_API_READ_ONLY.md`: internal business sandbox events must
  include audit/cost/rate-limit, tenant and sensitivity metadata before any
  future read-only provider work.
- `PERSONAL_WORKSPACE_CONNECTOR_POLICY.md`: personal connector sandbox events
  must include audit/cost/rate-limit, tenant, user and OAuth policy metadata
  before any future connector work.

## Security And LGPD

- audit must be minimized.
- audit cannot store raw content.
- audit cannot store unnecessary personal data.
- audit cannot store token, secret, env, header or cookie.
- retention must be defined before real storage.
- cost and rate limits require human review before any real provider.

## Social Media Draft-Only Approval

`docs/SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md` documents the contract-only policy
for future social media draft generation and approval. It keeps all output as
draft content, separates personal, Grupo Erick and external client brand scopes,
and does not implement real social providers, OAuth, tokens, publishing,
scheduling, comments, DMs, media storage, scheduler, adapters or runtime
changes. It keeps `simulated:true`, `executed:false`,
`real_provider_called:false`, `publish_allowed:false` and `send_allowed:false`
mandatory.

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

## Real Read-Only Adapter Readiness Gate

`docs/REAL_READ_ONLY_ADAPTER_READINESS_GATE.md` documents the first executable readiness gate for future real read-only adapters. This PR creates a deterministic, deny-by-default and fail-closed gate, fixture and tests only. It does not create a real adapter, call a provider, activate an integration, enable a feature flag, add OAuth or secrets, or change `/message` or `/confirm`. `READY` means only eligible for a future integration PR; `executed:false`, `real_provider_called:false` and `can_trigger_real_execution:false` remain mandatory in this PR.

## Read-Only Adapter Interface Runtime

`READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md` defines the isolated adapter interface, in-memory registry and mock-only runtime for future read-only integrations. It permits only local mocks/test doubles in this PR, blocks real providers and real candidates from execution, requires readiness/feature-flag/kill-switch checks for future candidates, and does not alter `/message` or `/confirm`.
