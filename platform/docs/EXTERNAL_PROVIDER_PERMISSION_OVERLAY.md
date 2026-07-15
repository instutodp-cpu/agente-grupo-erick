# Hermes Core External Provider Permission Matrix Overlay

Official contract for the External Provider Permission Matrix Overlay.

This overlay is documentation and contract only. It does not implement a real
provider, adapter, OAuth, secret, storage, MCP, external API call, runtime
change or any path to `executed:true`.

## What It Is

External Provider Permission Matrix Overlay is an overlay on top of the existing
Permission Matrix. It does not replace `PERMISSION_MATRIX.md`.

The overlay adds rules for cases where a domain wants to use a future external
provider. It crosses:

- `provider_id`
- `provider_type`
- domain
- capability
- risk level
- read/write/action permissions
- human review
- governance review
- security boundary

It depends on:

- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`
- `INTEGRATION_SECURITY_BOUNDARY.md`
- `GOVERNANCE_CHECK_REPORT.md`
- `PERMISSION_MATRIX.md`

The overlay does not execute integrations, does not create adapters, does not
authorize writes and does not authorize `executed:true`.

## Objectives

- Prevent a provider allowed in one domain from being used in another domain
  without review.
- Prevent read-only providers from becoming write/action providers.
- Prevent high or critical providers from advancing without human review and
  governance review.
- Define permission rules by provider type and domain.
- Define permission rules by provider id and domain.
- Keep external capabilities as mock/read-only candidates only.
- Block dangerous combinations by default.
- Keep Permission Matrix as the primary source for domain/capability rules.
- Keep Integration Security Boundary as the blocker for secrets, actions and raw
  payloads.

## Official Concepts

### overlay_scope

The scope where the overlay applies: external provider + domain + capability.

### provider_permission_state

Allowed states:

- `blocked`
- `mock_only`
- `read_only_candidate`
- `draft_only_candidate`
- `requires_human_review`
- `requires_governance_review`
- `deprecated`

No state allows real execution in this phase.

### provider_capability_type

Allowed capability types:

- `public_read`
- `private_read`
- `draft_generation`
- `sanitized_transcription`
- `inbox_candidate`
- `audit_candidate`
- `write_action`
- `financial_action`
- `social_post_action`
- `email_send_action`
- `calendar_modify_action`
- `mcp_action_tool`

`write_action`, `financial_action`, `social_post_action`, `email_send_action`,
`calendar_modify_action` and `mcp_action_tool` are blocked in this phase.

## Official Domains

- `compras`
- `financeiro`
- `treinamento`
- `marketing`
- `desenvolvimento`

## Official Provider Types

- `public_web_scraping`
- `app_integration_hub`
- `transcription_provider`
- `social_media_provider`
- `direct_platform_api`
- `internal_business_api`
- `internal_mcp_server`
- `developer_platform`

## Provider Type + Domain Rules

### public_web_scraping

- `compras`: `read_only_candidate` for public price, product and supplier data;
  write/action remains blocked.
- `financeiro`: blocked by default; any use requires governance review.
- `treinamento`: `read_only_candidate` for public content only.
- `marketing`: `read_only_candidate` for public research.
- `desenvolvimento`: `read_only_candidate` for public docs.

### app_integration_hub

- `compras`: blocked.
- `financeiro`: blocked.
- `treinamento`: future `mock_only` or `read_only_candidate` with explicit
  scope.
- `marketing`: future `draft_only_candidate` or `read_only_candidate`.
- `desenvolvimento`: future `read_only_candidate`.
- Gmail/Calendar write/send/modify is always blocked.

### transcription_provider

- `compras`: blocked by default.
- `financeiro`: blocked by default.
- `treinamento`: `sanitized_transcription` candidate.
- `marketing`: `sanitized_transcription` candidate.
- `desenvolvimento`: `sanitized_transcription` candidate.
- Raw audio/transcript storage is blocked.

### social_media_provider

- `compras`: blocked.
- `financeiro`: blocked.
- `treinamento`: blocked.
- `marketing`: `draft_only_candidate`; real post/DM/reply is blocked.
- `desenvolvimento`: blocked.

### direct_platform_api

- `compras`: blocked.
- `financeiro`: blocked.
- `treinamento`: blocked.
- `marketing`: `public_read` or `draft_only_candidate`; real post is blocked.
- `desenvolvimento`: `read_only_candidate` only for public docs/issues.

### internal_business_api

- `compras`: future `read_only_candidate`; write/action blocked.
- `financeiro`: future `read_only_candidate` with critical review; money
  movement blocked.
- `treinamento`: future `read_only_candidate`.
- `marketing`: future `read_only_candidate`.
- `desenvolvimento`: future `read_only_candidate`.
- Any write to ERP, CRM, Supabase or Base44 is blocked.

### internal_mcp_server

- All domains: future `mock_only` or `read_only_candidate`.
- Any action tool is blocked.
- Critical review is required.

### developer_platform

- `desenvolvimento`: `read_only_candidate` for PRs, docs and issues.
- `marketing`: `read_only_candidate` or `draft_only_candidate` for docs/designs.
- `treinamento`: `read_only_candidate` for docs.
- `compras`: blocked by default.
- `financeiro`: blocked by default.
- Push, merge and write remain blocked.

## Initial Provider ID Rules

### firecrawl

- `compras`: `read_only_candidate`
- `marketing`: `read_only_candidate`
- `treinamento`: `read_only_candidate`
- `desenvolvimento`: `read_only_candidate`
- `financeiro`: `blocked`
- write/action: false

### bright_data

- `compras`: `read_only_candidate` with high review
- `marketing`: `read_only_candidate` with high review
- `desenvolvimento`: `read_only_candidate` with high review
- `financeiro`: `blocked`
- write/action: false

### scrapeless

- `compras`: `read_only_candidate` with high review
- `marketing`: `read_only_candidate` with high review
- `desenvolvimento`: `read_only_candidate` with high review
- `financeiro`: `blocked`
- write/action: false

### composio

- all domains: `mock_only` by default
- Gmail/Calendar send/modify: blocked
- OAuth: critical review
- write/action: false

### google_workspace_super

- all domains: `mock_only` by default
- Gmail/Calendar/Drive write/send/modify: blocked
- OAuth: critical review
- write/action: false

### assemblyai

- `treinamento`: `sanitized_transcription` candidate
- `marketing`: `sanitized_transcription` candidate
- `desenvolvimento`: `sanitized_transcription` candidate
- `compras` and `financeiro`: blocked
- raw audio/transcript: blocked

### social_media_api

- `marketing`: `draft_only_candidate`
- all other domains: blocked
- real post/DM/reply: blocked

### x_direct_api

- `marketing`: `public_read` or `draft_only_candidate`
- all other domains: blocked
- real post: blocked

### internal_business_api

- `compras`: future `read_only_candidate`
- `financeiro`: future `read_only_candidate` with critical review
- `treinamento`, `marketing`, `desenvolvimento`: future `read_only_candidate`
- any write/action: blocked

### internal_mcp_server

- all domains: future `mock_only` or `read_only_candidate`
- action tools: blocked

### github_connector

- `desenvolvimento`: `read_only_candidate`
- `marketing` and `treinamento`: `read_only_candidate`
- `compras` and `financeiro`: blocked
- push/merge/write: blocked

## Overlay Decision Fields

Minimum fields for an overlay rule:

- `overlay_id`
- `provider_id`
- `provider_type`
- `domain`
- `capability`
- `provider_permission_state`
- `risk_level`
- `read_allowed`
- `write_allowed`
- `action_allowed`
- `can_trigger_real_execution`
- `executed`
- `requires_human_review`
- `requires_governance_review`
- `requires_security_boundary`
- `requires_provider_registry_entry`
- `requires_permission_matrix_entry`
- `requires_golden_scenario`
- `requires_domain_onboarding`
- `allowed_use_cases`
- `blocked_use_cases`
- `blocking_reason`
- `audit_requirements`

Mandatory rules:

- `can_trigger_real_execution = false`
- `executed = false`
- `write_allowed = false`
- `action_allowed = false`
- `requires_security_boundary = true`
- `requires_provider_registry_entry = true`
- high/critical providers require human review and governance review
- `financeiro` requires critical review for external providers
- real social media posts are always blocked
- real email send is always blocked
- real calendar modify is always blocked
- money movement is always blocked
- ERP/CRM mutation is always blocked
- MCP action tools are always blocked

## Official Blocking Rules

These are blocked:

- unregistered provider
- provider without Security Boundary
- provider without Permission Matrix entry
- new domain without Domain Onboarding
- sensitive capability without Golden Scenario
- any `write_allowed = true` in this phase
- any `action_allowed = true` in this phase
- any `can_trigger_real_execution = true`
- any `executed = true`
- real Gmail send
- real Calendar modify
- real social post
- real DM or public reply automation
- money movement
- ERP/CRM/Supabase/Base44 write
- internal MCP action tools
- raw transcript/audio storage
- cross-tenant, cross-user or cross-domain leakage
- secret, token, env, header or cookie exposure

## Relationship With Existing Contracts

- `PERMISSION_MATRIX.md`: primary source for domain/capability permissions.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: provider must be registered.
- `INTEGRATION_SECURITY_BOUNDARY.md`: boundary must block secrets, raw payloads,
  cross-scope leakage and actions.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe overlay changes.
- `GOLDEN_SCENARIOS.md`: sensitive provider flows need scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: provider output cannot become memory without sanitization.
- `USER_PEER_MEMORY_SCOPES.md`: user/tenant scope must remain isolated.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: provider output can only become sanitized
  inbox candidates.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores do not approve provider
  permissions.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot become executable provider
  automations.
- `OPERATOR_RUNBOOK.md`: operators must validate, rollback and review future
  provider changes.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: allowed provider/domain/capability
  combinations may be simulated with synthetic fixtures before any sandbox or
  real provider work.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: allowed provider/domain/capability
  combinations still need audit, cost, rate limit, fallback and stop-condition
  contracts before any sandbox work.
- `TENANT_WORKSPACE_ISOLATION.md`: provider/domain/capability combinations must
  also stay inside the selected workspace and tenant.
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: public web provider combinations must
  remain read-only candidates and cannot allow login, checkout, form submit or
  real provider calls.
- `TRANSCRIPTION_INTAKE_SANDBOX.md`: transcription provider combinations must
  remain mock/sanitized candidates and cannot allow upload, raw transcript
  storage or real provider calls.
- `INTERNAL_BUSINESS_API_READ_ONLY.md`: internal business provider combinations
  must remain mock/read-only candidates and cannot allow raw SQL, writeback,
  cross-tenant queries or real provider calls.
- `PERSONAL_WORKSPACE_CONNECTOR_POLICY.md`: personal connector combinations
  must remain mock/read-only/draft-only candidates and cannot allow OAuth,
  send/write/delete/share, cross-workspace context or real connector calls.

## Security And LGPD

- The overlay does not authorize raw data.
- The overlay does not authorize storage.
- The overlay does not authorize a real provider.
- The overlay does not authorize real action.
- Future output must be sanitized.
- Personal data requires minimization, explicit scope and retention policy.
- Logs must be sanitized.

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

## Connector Lifecycle Runtime Registry

`CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md` records connector lifecycle state and
requires permission-related scope evidence before mock-only or readiness
transitions can proceed. It keeps `mock_only` as the phase ceiling and does not
authorize write/action/send/publish/delete.

## Public Web Read-Only Adapter Pilot

`PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md` maps public web use to read-only
capabilities such as `public_web_search`, `public_web_read`,
`public_web_compare`, `public_web_summarize`, price inspection and promotion
inspection. Permission overlay does not permit login, forms, checkout,
purchase, reservation, publish/send/write/delete or cross-tenant use.
