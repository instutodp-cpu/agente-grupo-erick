# Hermes Core Permission Matrix

Matriz oficial de permissões por domínio e capability. Esta etapa existe para
manter o core previsível, seguro e pronto para expandir sem habilitar execução
real.

Estado obrigatório para todos os domínios atuais:

- `can_execute_real_action = false`
- `allowed_adapter_mode = mock`
- `executed:false` continua obrigatório
- qualquer execução real permanece proibida nesta fase

## Matriz atual

| Domain | can_read_context | can_plan | can_request_confirmation | can_run_mock_adapter | can_execute_real_action | requires_confirmation | requires_human_review | allowed_adapter_mode | risk_level |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compras | true | true | true | true | false | true | true | mock | high |
| financeiro | true | true | true | true | false | true | true | mock | high |
| treinamento | true | true | true | true | false | true | true | mock | medium |
| marketing | true | true | true | true | false | true | true | mock | medium |
| desenvolvimento | true | true | true | true | false | true | true | mock | medium |

## Regras de uso

- `can_read_context` e `can_plan` indicam leitura e planejamento seguro.
- `can_request_confirmation` existe quando o fluxo pode exigir aprovação humana.
- `can_run_mock_adapter` indica apenas simulação local, sem efeito real.
- `can_execute_real_action` permanece `false` até uma PR futura explícita.
- `requires_confirmation` e `requires_human_review` permanecem `true` para os
  domínios atuais.
- `allowed_adapter_mode` fica `mock` em todos os domínios desta fase.
- `risk_level` deve ser revisado antes de adicionar novo domínio.

## Domain Onboarding Preview

Uma PR futura pode introduzir um guia formal para novos domínios. Checklist
mínimo antes de ampliar o core:

- declarar o domínio na matriz
- definir `risk_level`
- definir capabilities
- criar mock adapter
- criar golden scenarios
- adicionar testes
- atualizar smoke/CI se necessário
- manter `executed:false`
- revisar por humano

O processo oficial já foi documentado em `docs/DOMAIN_ONBOARDING.md`; use esse
guia antes de qualquer expansão.

Quando a expansão estiver ligada a padrões de tarefa, consulte também
`docs/SKILL_CANDIDATE_REGISTRY.md` para manter o contrato em draft e
mock-first.

Para política de memória futura, consulte `docs/MEMORY_POLICY.md`; ela não
autoriza storage real nem execução real nesta fase.

## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` uses this matrix as one of its primary
checks. The governance report does not replace this matrix and cannot loosen
`executed:false`, mock-first or human review requirements.

## External Integration Provider Registry

`docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md` must be checked before any
future external provider is connected to a domain. A provider entry does not
expand domain permissions, does not replace this matrix and cannot authorize
real writes, real actions or `executed:true`.

## Integration Security Boundary

`docs/INTEGRATION_SECURITY_BOUNDARY.md` defines the safety boundary that every
future integration must respect. The boundary cannot loosen this matrix, cannot
grant cross-domain access and cannot authorize real execution.

## External Provider Permission Overlay

`docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md` overlays provider-specific rules
on top of this matrix. It does not replace this matrix, cannot expand domain
capabilities and cannot authorize writes, actions or `executed:true`.

## External Provider Mock Adapter Harness

`docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md` can simulate provider behavior
only after this matrix and the provider overlay keep the domain/capability safe.
Mock simulation does not expand permissions and does not authorize real calls.

## External Provider Audit, Cost and Rate Limit

`docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md` must be satisfied before any
future provider sandbox. Cost, rate limit, fallback and stop conditions cannot
expand this matrix or authorize real provider calls.

## Tenant and Workspace Isolation

`docs/TENANT_WORKSPACE_ISOLATION.md` scopes this matrix by workspace and tenant.
Workspace isolation cannot expand domain permissions and domain permissions
cannot override tenant isolation.

## Public Web Data Read-Only Sandbox

`docs/PUBLIC_WEB_READ_ONLY_SANDBOX.md` defines future public web reads as
read-only candidates. Public web read permissions cannot override this matrix,
tenant isolation or `executed:false`.

## Transcription Intake Sandbox

`docs/TRANSCRIPTION_INTAKE_SANDBOX.md` defines future transcription intake as a
sanitized read-only candidate. Audio, video and transcript intake cannot expand
domain permissions, bypass tenant isolation or authorize `executed:true`.

## Internal Business API Read-Only

`docs/INTERNAL_BUSINESS_API_READ_ONLY.md` defines future internal business data
queries as read-only candidates. Internal data access cannot expand domain
permissions, bypass tenant isolation, enable write/action or authorize
`executed:true`.

## Personal Workspace Connector Policy

`docs/PERSONAL_WORKSPACE_CONNECTOR_POLICY.md` defines future personal connector
access as personal-workspace-only read/draft candidates. Personal connectors
cannot expand domain permissions, bypass tenant isolation, enable send/write/
delete/share/action or authorize `executed:true`.

## Social Media Draft-Only Approval

`docs/SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md` documents the contract-only policy
for future social media draft generation and approval. It keeps all output as
draft content, separates personal, Grupo Erick and external client brand scopes,
and does not implement real social providers, OAuth, tokens, publishing,
scheduling, comments, DMs, media storage, scheduler, adapters or runtime
changes. It keeps `simulated:true`, `executed:false`,
`real_provider_called:false`, `publish_allowed:false` and `send_allowed:false`
mandatory.