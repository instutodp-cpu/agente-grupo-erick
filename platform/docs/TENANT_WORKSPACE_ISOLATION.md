# Hermes Core Tenant and Workspace Isolation

Official contract for separating Hermes Core workspaces and tenants.

This document is a contract only. It does not implement real authentication,
real tenant resolution, real storage, real RLS, real Supabase, real memory,
real cache, real RAG/vector database, real MCP, runtime changes or any path to
`executed:true`.

## What It Is

Tenant and Workspace Isolation defines how future context, memory, audit,
cache, inbox, provider output, MCP calls and business data must be scoped. It
separates Hermes Pessoal, Grupo Erick and external SaaS clients before any
sandbox, memory implementation, Supabase, RAG, MCP or real data access exists.

It does not replace Permission Matrix, Memory Policy, Integration Security
Boundary, human confirmation or governance review.

## Objectives

- Separate personal context from corporate context.
- Separate Grupo Erick from external clients.
- Separate external clients from each other.
- Require tenant/workspace scope for future memory, audit, cache, inbox,
  provider output and MCP calls.
- Prevent Grupo Erick data from leaking into Hermes Pessoal.
- Prevent personal data from leaking into Grupo Erick.
- Prevent one external client from seeing another external client's data.
- Prepare for future RLS/Supabase and SaaS multi-company operation.

## Official Workspace Types

### personal

Hermes Pessoal workspace.

Use cases: personal life, personal calendar, travel, health, productivity,
individual preferences and personal notes. It must not access corporate data
without explicit authenticated corporate workspace scope.

### grupo_erick

Internal Grupo Erick workspace.

Use cases: finance, purchases, HR, training, marketing, support, stores,
operations and development. It can contain sensitive corporate data and must
never leak to `personal`.

### external_client

External SaaS client workspace.

Use cases: third-party companies, managers, teams and external users. Each
client must have an isolated tenant and must never access Grupo Erick or another
client.

## Official Tenant ID Formats

- `personal::<user_id>`
- `grupo_erick`
- `client::<client_id>`

Rules:

- Every future memory, audit, cache, inbox item, provider result or business
  data record needs `tenant_id`.
- `tenant_id` cannot be inferred from natural-language messages.
- `tenant_id` cannot be changed by a user prompt.
- `tenant_id` cannot be inherited from an external provider without validation.
- `tenant_id` must come from authenticated context in the future.
- This phase is contract only and does not implement real auth.

## Workspace Identity Fields

Minimum future identity fields:

- `workspace_type`
- `tenant_id`
- `user_id`
- `role`
- `company_id`
- `store_id`
- `client_id`
- `allowed_domains`
- `denied_domains`
- `scope_source`
- `scope_version`
- `isolation_policy`
- `confirmation_policy`
- `governance_policy`

Rules:

- `personal` requires `workspace_type: personal` and `tenant_id` starting with
  `personal::`.
- `grupo_erick` requires `workspace_type: grupo_erick` and `tenant_id:
  grupo_erick`.
- `external_client` requires `workspace_type: external_client` and `tenant_id`
  starting with `client::`.
- `client_id` is required for `external_client`.
- `user_id` is required in every future workspace.
- `role` never authorizes real execution by itself.

## Official Isolation Boundaries

- `personal_boundary`: blocks leakage between personal and corporate context.
- `grupo_erick_boundary`: blocks internal corporate data from personal or
  external client workspaces.
- `external_client_boundary`: blocks leakage between external clients and from
  external clients to Grupo Erick.
- `store_boundary`: scopes data by `store_id` when present.
- `company_boundary`: scopes data by `company_id` when present.
- `user_boundary`: scopes preferences, memory and decisions by `user_id`.
- `role_boundary`: scopes permissions by role without authorizing real
  execution.
- `provider_boundary`: every future provider/MCP must respect workspace and
  tenant.
- `memory_boundary`: every future memory needs `tenant_id`, `user_id` and
  `workspace_type`.
- `audit_boundary`: every future audit event needs tenant/workspace and
  sanitized fields.

## Required Separation Rules

- `personal` cannot read `grupo_erick`.
- `personal` cannot read `external_client`.
- `grupo_erick` cannot read `personal`.
- `grupo_erick` cannot read `external_client`.
- `external_client` cannot read `personal`.
- `external_client` cannot read `grupo_erick`.
- External client A cannot read external client B.
- User A cannot read user B without an explicit rule.
- Store A cannot read store B without an allowed role.
- Company A cannot read company B.
- External providers cannot alter `tenant_id`.
- User prompts cannot alter `tenant_id`.
- Memory cannot cross workspaces.
- Audit cannot contain cross-tenant data.
- Cache cannot be global for sensitive data.
- Inbox/Second Brain cannot mix tenants.
- `executed:false` remains mandatory in this phase.

## Workspace Default Policies

### personal

Initial allowed domains:

- pessoal
- agenda
- produtividade
- viagens
- saude
- desenvolvimento pessoal

Initial denied domains:

- financeiro corporativo
- compras corporativas
- RH corporativo
- dados de cliente externo

Business data access is false by default.

### grupo_erick

Initial allowed domains:

- financeiro
- compras
- marketing
- treinamento
- RH
- operacoes
- atendimento
- desenvolvimento

Initial denied domains:

- personal private data
- external client private data

Business data access is a future read-only candidate and never write in this
phase.

### external_client

Allowed domains are configurable by client and may include atendimento,
relatorios, automacao assistida, treinamento if contracted and marketing if
contracted.

Denied domains:

- Grupo Erick internal data
- personal private data
- other client private data

Business data access is limited to the matching `client::<client_id>`.

## Future Memory Rules

Every future memory record needs:

- `workspace_type`
- `tenant_id`
- `user_id`
- `memory_scope`
- `source_domain`
- `sensitivity_level`
- `retention_policy`
- `sanitized:true`

Blocked:

- memory without `tenant_id`
- memory without `workspace_type`
- personal memory inside `grupo_erick`
- Grupo Erick memory inside `personal`
- external client memory shared with another client
- memory with `rawMessage`, `userMessage` or `rawPayload`
- memory with secrets or tokens
- memory with sensitive personal data without policy

## Future Audit Rules

Every future audit event needs:

- `trace_id`
- `event_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `domain`
- `event_type`
- `status`
- `simulated`
- `executed`
- `timestamp`

Blocked:

- audit without `tenant_id`
- audit without `workspace_type`
- cross-tenant audit
- audit with raw payload
- audit with secrets or tokens
- audit with raw message
- audit that exposes Grupo Erick data to personal or external client workspaces

## Future Provider And MCP Rules

- Every future provider request needs `workspace_type` and `tenant_id`.
- Every future MCP tool call needs `workspace_type` and `tenant_id`.
- Providers cannot infer tenant from text.
- Providers cannot return data to another tenant.
- Providers cannot save output without tenant policy.
- MCP action tools remain blocked.
- External clients cannot use Grupo Erick MCP tools.
- Hermes Pessoal cannot use corporate MCP tools without explicit authenticated
  workspace switch.
- Grupo Erick cannot use personal memory as operational context.

## Grupo Erick Internal Data Rules

- Grupo Erick data stays under `tenant_id: grupo_erick`.
- Store-scoped data must use `store_id` when applicable.
- Company/unit data must use `company_id` when applicable.
- Finance and purchases data are sensitive.
- Future access starts read-only.
- Any write remains blocked in this phase.
- Grupo Erick data cannot appear in `personal`.
- Grupo Erick data cannot appear in `client::<client_id>`.

## External SaaS Client Rules

- Each external client uses `tenant_id: client::<client_id>`.
- Each client has its own `company_id` and `client_id`.
- One client's data must never appear to another client.
- Templates can be shared only when global, sanitized and free of client data.
- Cross-tenant aggregate metrics require anonymization and governance approval.
- No external client can access Grupo Erick data.

## Blocking Rules

Future PRs must be blocked when they:

- add memory without `tenant_id`
- add audit without `tenant_id`
- add global cache for sensitive data
- add provider output without `workspace_type`
- add MCP calls without `tenant_id`
- allow prompts to alter `tenant_id`
- allow providers to alter `tenant_id`
- mix `personal` and `grupo_erick`
- mix `grupo_erick` and `external_client`
- mix two external clients
- store `rawMessage`, `userMessage` or `rawPayload` in memory
- store secrets or tokens
- create Supabase/RLS without tenant policy
- create vector DB/RAG without tenant namespace
- create Second Brain without tenant isolation
- allow `executed:true`
- allow real write/action in this phase

## Relationship With Existing Contracts

- `MEMORY_POLICY.md`: memory layers must include tenant/workspace scope before
  real storage.
- `USER_PEER_MEMORY_SCOPES.md`: user and peer memory remains isolated by user,
  role and workspace.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: inbox items must stay tenant-scoped before
  future storage.
- `PERMISSION_MATRIX.md`: workspace isolation does not expand domain
  permissions.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block missing tenant or
  cross-tenant changes.
- `INTEGRATION_SECURITY_BOUNDARY.md`: providers must respect identity, secret
  and payload boundaries.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: every provider candidate must
  document tenant/workspace requirements.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability use
  remains constrained by the overlay.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: mock examples must stay
  tenant-safe and synthetic.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: provider audit/cost/rate-limit
  metadata must include tenant/workspace scope before sandbox work.
- `GOLDEN_SCENARIOS.md`: future tenant flows need safe scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot bypass tenant isolation.
- `OPERATOR_RUNBOOK.md`: operators must validate tenant/workspace isolation
  before sensitive future PRs.

## Security And LGPD

- Minimize data by tenant.
- Keep personal data in the smallest possible scope.
- Corporate data cannot become personal memory.
- Personal data cannot become corporate context.
- External clients require strict isolation.
- Retention must be defined before real storage.
- Sensitive data requires a clear policy.

## Public Web Data Read-Only Sandbox

`docs/PUBLIC_WEB_READ_ONLY_SANDBOX.md` defines how future public web reads must
stay inside `workspace_type`, `tenant_id` and `user_id`. Public web output
cannot cross Hermes Pessoal, Grupo Erick or external client boundaries.

## Transcription Intake Sandbox

`docs/TRANSCRIPTION_INTAKE_SANDBOX.md` defines how future audio, video and
transcript intake must stay inside `workspace_type`, `tenant_id` and `user_id`.
Transcription output cannot cross Hermes Pessoal, Grupo Erick or external
client boundaries.

## Internal Business API Read-Only

`docs/INTERNAL_BUSINESS_API_READ_ONLY.md` defines how future internal business
queries must stay inside `workspace_type`, `tenant_id` and `user_id`. Business
data cannot cross Hermes Pessoal, Grupo Erick or external client boundaries.

## Personal Workspace Connector Policy

`docs/PERSONAL_WORKSPACE_CONNECTOR_POLICY.md` defines how future personal
connectors must stay inside `workspace_type=personal`, `tenant_id=personal::*`
and `connector_scope=personal_private`. Personal connector output cannot cross
Hermes Pessoal, Grupo Erick or external client boundaries.

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

`CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md` requires every lifecycle record to
declare workspace types and tenant strategy. Transitions cannot rely on prompt
text to change tenant scope, and lifecycle state never bypasses tenant or
workspace isolation.

## Real Provider Configuration Boundary

`REAL_PROVIDER_CONFIGURATION_BOUNDARY.md` requires every future provider
configuration to declare tenant and workspace policy before it can be retained
in the private configuration registry. Configuration records cannot widen
tenant scope, cannot use prompt text as tenant authority, cannot share secret
references across tenants, and cannot activate real provider calls.

## Public Web Read-Only Adapter Pilot

`PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md` requires every pilot request to remain
workspace, tenant and user scoped. The pilot gate checks tenant/workspace/user
allowlists, prevents external content from changing tenant identity, keeps
public web output in the matching tenant and blocks production activation.

## Public Web Non-Production Canary Activation

`PUBLIC_WEB_NON_PRODUCTION_CANARY_ACTIVATION.md` limits each manual canary to
one tenant, one workspace and one user. Web content, target policies and
operator approvals cannot alter tenant or workspace bindings.
