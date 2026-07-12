# Hermes Core Golden Scenarios

Lista oficial de cenários dourados para validar comportamento esperado por
domínio antes de criar adapters reais. Os cenários abaixo são contratuais e
não habilitam execução real.

## Cenários por domínio

### Compras

- Usuário pede para registrar compra de fornecedor com valor e prazos.
- Esperado:
  - `domain = compras`
  - `intent` relacionada a compra
  - `confirmation_required = true`
  - `adapter_id = mock-compras` após confirmação positiva
  - `simulated = true`
  - `executed = false`

### Financeiro

- Usuário pede análise ou consulta financeira.
- Esperado:
  - `domain = financeiro`
  - `confirmation_required = true` quando envolver ação sensível
  - `adapter_id = mock-financeiro` se aprovado
  - `simulated = true`
  - `executed = false`
  - dados sensíveis não são expostos

### Treinamento

- Usuário pede criação ou sugestão de módulo de treinamento.
- Esperado:
  - `domain = treinamento`
  - `adapter_id = mock-treinamento`
  - `simulated = true`
  - `executed = false`

### Marketing

- Usuário pede ideia, campanha ou conteúdo.
- Esperado:
  - `domain = marketing`
  - `adapter_id = mock-marketing`
  - `simulated = true`
  - `executed = false`

### Desenvolvimento

- Usuário pede tarefa técnica, PR ou plano de código.
- Esperado:
  - `domain = desenvolvimento`
  - `adapter_id = mock-desenvolvimento`
  - `simulated = true`
  - `executed = false`

## Cenários negativos

- Mensagem ambígua não deve executar.
- Confirmação com "não" não deve rodar mock adapter.
- Confirmação ambígua não deve rodar mock adapter.
- `confirmation_id` inexistente deve retornar `not_found` seguro.
- Domínio desconhecido não deve executar.
- Qualquer response não deve conter:
  - `requiredAdapters`
  - `payload` interno
  - `rawMessage`
  - `userMessage`
  - `secrets`
  - `tokens`
  - `env`
  - `headers`
  - `cookies`
  - `credentials`

## Regras obrigatórias

- `executed:false` continua obrigatório.
- mock first.
- human confirmation.
- no secrets.
- no raw payload.
- CI/smoke obrigatório.

Antes de registrar novos cenários, siga `docs/DOMAIN_ONBOARDING.md` para
garantir consistência com Permission Matrix, mock adapter e review humana.

Se o cenário representar um padrão reutilizável de tarefa, registre também o
alvo em `docs/SKILL_CANDIDATE_REGISTRY.md` sem alterar runtime.

Se o cenário exigir contexto persistido no futuro, consulte
`docs/MEMORY_POLICY.md` para manter isolamento, thresholds e campos proibidos
sem implementar memória real nesta PR.

## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` treats these scenarios as a critical check
area. Governance can flag missing or regressed scenarios, but it does not
substitute for them and does not authorize real execution.

## External Integration Provider Registry

If a golden scenario depends on a future external provider, the provider must be
documented in `docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md` first. Provider
registry entries do not call APIs, do not create adapters and do not authorize
real execution.

## Integration Security Boundary

Provider-related scenarios must also respect
`docs/INTEGRATION_SECURITY_BOUNDARY.md`. A scenario cannot include raw payloads,
secrets, cross-tenant leakage, real writes or `executed:true`.

## External Provider Permission Overlay

Provider-related scenarios must also respect
`docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`. The overlay keeps provider
usage mock/read-only/draft only and does not authorize real API calls.

## External Provider Mock Adapter Harness

Provider-related golden scenarios can use
`docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md` as the safe fixture contract.
Mock examples remain synthetic and cannot call real providers.

## External Provider Audit, Cost and Rate Limit

Provider-related scenarios should reference
`docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md` when future cost, rate limit,
fallback or stop-condition behavior is relevant. The contract does not permit
real provider calls.

## Tenant and Workspace Isolation

Tenant-related scenarios should reference `docs/TENANT_WORKSPACE_ISOLATION.md`.
Future scenarios that use memory, inbox, providers, MCP or business data must
declare workspace and tenant scope.

## Public Web Data Read-Only Sandbox

Public web scenarios should reference `docs/PUBLIC_WEB_READ_ONLY_SANDBOX.md`.
Scenarios may use only synthetic public web examples in this phase and cannot
expect real provider calls.

## Transcription Intake Sandbox

Transcription scenarios should reference `docs/TRANSCRIPTION_INTAKE_SANDBOX.md`.
Scenarios may use only synthetic or sanitized transcript examples in this phase
and cannot expect real provider calls, real audio processing or raw transcript
storage.

## Internal Business API Read-Only

Internal business data scenarios should reference
`docs/INTERNAL_BUSINESS_API_READ_ONLY.md`. Scenarios may use only synthetic
read-only examples in this phase and cannot expect real database queries,
writeback, raw SQL or full data dumps.

## Personal Workspace Connector Policy

Personal connector scenarios should reference
`docs/PERSONAL_WORKSPACE_CONNECTOR_POLICY.md`. Scenarios may use only synthetic
read-only or draft-only examples in this phase and cannot expect real Gmail,
Calendar, Drive, OAuth, send/write/delete/share or token storage.

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
