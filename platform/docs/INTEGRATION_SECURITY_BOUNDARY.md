# Hermes Core Integration Security Boundary

Official contract for the Hermes Core integration security boundary.

This document defines the safety boundary for any future external integration.
It is documentation and contract only. It does not implement a real provider,
real adapter, real OAuth, real secret, real storage, real MCP, external API
call, runtime change or any path to `executed:true`.

## What It Is

Integration Security Boundary is the contract that defines what a future
integration can never access, expose, store or execute. It sits between:

- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`
- `PERMISSION_MATRIX.md`
- `GOVERNANCE_CHECK_REPORT.md`
- future adapters

The boundary does not execute integrations, does not create adapters, does not
replace Permission Matrix, does not replace human confirmation and does not
authorize `executed:true`.

## Objectives

- Protect tokens, secrets, API keys, OAuth data, headers and cookies.
- Prevent leakage of internal payloads, `rawMessage`, `userMessage` and full
  request bodies.
- Prevent cross-tenant, cross-user and cross-domain leakage.
- Block premature real writes and external actions.
- Block external actions without human confirmation.
- Require rate limit and cost controls before any real provider.
- Keep logs sanitized.
- Require kill switch and rollback paths for sensitive providers.
- Define limits for a future read-only sandbox.
- Require human review and governance review for high or critical providers.

## Official Boundary Layers

### identity_boundary

Protects `user_id`, `tenant_id`, `role`, `store_id`, `company_id` and scopes.
No integration can mix users, companies, tenants, stores or domains.

### secret_boundary

Protects `token`, `secret`, `env`, `apiKey`, `accessToken`, `refreshToken`,
`authorization`, `headers`, `cookies` and `credentials`. No secret may appear
in docs, fixtures, logs, audit events, responses or tests.

### payload_boundary

Protects `rawPayload`, internal payload, `rawMessage`, `userMessage`, full
request body, full stack trace and `requiredAdapters`. Only sanitized public
fields can leave the boundary.

### action_boundary

Blocks `write_allowed`, `action_allowed` and `can_trigger_real_execution`.
Real writes and real actions remain prohibited in this phase.

### provider_boundary

Every future provider must exist in `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`.
Unregistered providers are blocked.

### domain_boundary

Every integration must respect Permission Matrix, Domain Onboarding and Golden
Scenarios. A provider allowed in one domain does not unlock another domain.

### cost_boundary

No real provider can run without documented `cost_risk`, `rate_limit_risk`,
`fallback_policy` and stop conditions.

### compliance_boundary

Scraping, transcription, social media, Gmail/Calendar and internal business data
require documented LGPD, retention and data minimization rules.

### audit_boundary

Logs and audit events must be sanitized. Audit can record `provider_id`,
`provider_type`, `domain`, `risk_level`, `simulated`, `executed:false`,
`status` and `blocked_reason`. Audit cannot record secrets, tokens, raw payload
or raw user message.

### sandbox_boundary

Any future integration starts as mock-only. A future read-only sandbox requires
a separate PR. No sandbox can write, post, send, delete, alter or move data.

## Allowed Integration Audit Fields

Only these sanitized fields are allowed in future integration logs/audit:

- `trace_id`
- `provider_id`
- `provider_type`
- `domain`
- `intent`
- `risk_level`
- `status`
- `simulated`
- `executed`
- `adapter_mode`
- `confirmation_required`
- `confirmation_id`
- `blocked_reason`
- `timestamp`
- `cost_risk`
- `rate_limit_risk`

## Forbidden Fields

No boundary layer, fixture, log, audit event, response or test can expose:

- `token`
- `secret`
- `env`
- `headers`
- `cookies`
- `credentials`
- `payload`
- `rawPayload`
- `rawMessage`
- `userMessage`
- `requiredAdapters`
- `authorization`
- `password`
- `stackTrace`
- `apiKey`
- `accessToken`
- `refreshToken`
- `requestBody`
- `responseBody`
- `rawTranscript`
- `rawAudio`
- `privateUrl`
- `webhookSecret`

## Mandatory Rules

- `executed:false` always in this phase.
- `can_trigger_real_execution:false` always.
- `write_allowed:false` always in this phase.
- `action_allowed:false` always in this phase.
- `real_provider_calls_allowed:false` in this phase.
- `secrets_allowed_in_docs:false`.
- `secrets_allowed_in_fixtures:false`.
- `raw_payload_logging_allowed:false`.
- `raw_message_logging_allowed:false`.
- `cross_tenant_access_allowed:false`.
- `cross_user_access_allowed:false`.
- `cross_domain_access_allowed:false`.
- `human_review_required:true` for high and critical providers.
- `governance_review_required:true` for every external provider.
- `kill_switch_required:true` for high and critical providers.
- `rollback_plan_required:true` for high and critical providers.

## Mandatory Blocking Rules

Future PRs must be blocked when they:

- add real OAuth
- add a real secret
- add a real `.env` key
- call a real external API
- write to an external system
- post to social media
- send email
- modify calendar data
- move money
- mutate ERP, CRM, Supabase, Base44 or internal business data
- enable MCP action tools
- store raw transcript
- store raw audio
- store raw scraping output without policy
- expose token, secret, env, header or cookie
- expose raw payload or raw user message
- allow cross-tenant or cross-user leakage
- remove confirmation gate
- remove kill switch
- attempt `executed:true`

## Provider Type Rules

### public_web_scraping

- Mock only in this phase.
- Future read-only sandbox requires compliance, rate limit and fallback policy.
- Raw HTML storage is prohibited without policy.
- Scraping private or authenticated data is prohibited.

### app_integration_hub

- Critical when OAuth is used.
- Sending email, changing calendar data, creating files and deleting data are
  prohibited.
- Future read-only sandbox requires granular per-user scopes.

### transcription_provider

- Raw audio storage is prohibited.
- Raw transcript storage is prohibited without policy.
- Future output must be `sanitized_summary`.
- Human review is required when personal data is present.

### social_media_provider

- Real posts are prohibited.
- Real DMs are prohibited.
- Automated public replies are prohibited.
- Future use is draft or suggestion only.

### direct_platform_api

- Real posts are prohibited.
- Cost and reputation risk must be reviewed.
- Future use is public read or draft only.

### internal_business_api

- Critical.
- Mock only in this phase.
- Future read-only access requires tenant, role, store, audit and kill switch.
- Writing to finance, compras, estoque, ERP or database systems is prohibited.

### internal_mcp_server

- Critical.
- Action tools are blocked.
- Start read-only and mock-first.
- MCP cannot expose secrets, env or internal payload.

### developer_platform

- Reading PRs, docs and issues can be future read-only work.
- Push, merge and write operations are prohibited without a specific PR and
  confirmation.

## Relationship With Existing Contracts

- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: every provider must be registered
  before any mock, sandbox or adapter work.
- `GOVERNANCE_CHECK_REPORT.md`: governance must check the boundary before
  sensitive changes.
- `PERMISSION_MATRIX.md`: the boundary cannot expand domain permissions.
- `GOLDEN_SCENARIOS.md`: new provider flows need official scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: provider output cannot become memory unless sanitized and
  governed.
- `USER_PEER_MEMORY_SCOPES.md`: provider access cannot bypass user or tenant
  scope.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: provider output can only become future inbox
  candidates after sanitization.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores do not approve provider calls
  or real execution.
- `SKILL_CANDIDATE_REGISTRY.md`: skill candidates cannot become executable
  provider automations.
- `OPERATOR_RUNBOOK.md`: operators must use the runbook for validation, rollback
  and future adapter PR rules.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability
  combinations must pass the overlay before any future mock, sandbox or adapter
  work.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: mock provider requests and
  responses must remain synthetic, sanitized and inside this boundary.

## Security And LGPD

- Use data minimization.
- Define retention before any storage.
- Sanitize before any future inbox or memory candidate.
- Require consent and explicit scope for personal data.
- Store no raw data in this phase.
- Do not add a real provider without retention policy and governance review.
