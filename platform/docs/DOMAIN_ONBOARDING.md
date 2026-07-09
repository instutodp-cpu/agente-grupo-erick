# Hermes Core Domain Onboarding Guide

Guia oficial para adicionar novos domínios ao Hermes Core sem quebrar a
arquitetura atual. Esta fase é `mock-first`, mantém `executed:false` como regra
obrigatória e não habilita execução real.

## Princípios obrigatórios

- Todo domínio novo começa em modo mock.
- Todo domínio novo deve manter `executed:false`.
- Nenhum domínio novo pode executar ação real nesta fase.
- Todo domínio novo precisa aparecer na Permission Matrix.
- Todo domínio novo precisa ter Golden Scenarios.
- Todo domínio novo precisa ter `adapter_id` `mock-*`.
- Todo domínio novo precisa passar nos testes contratuais.
- Todo domínio novo precisa passar no smoke/CI quando aplicável.
- Todo domínio novo precisa de revisão humana antes de qualquer promoção.

## Checklist de onboarding

- Escolher nome canônico do domínio.
- Definir escopo do domínio.
- Definir intents principais.
- Definir `risk_level`.
- Definir capabilities.
- Atualizar `platform/docs/PERMISSION_MATRIX.md`.
- Atualizar `platform/docs/GOLDEN_SCENARIOS.md`.
- Criar/registrar mock adapter.
- Criar fixture contratual.
- Atualizar testes.
- Atualizar smoke test se o domínio entrar no fluxo end-to-end.
- Atualizar docs.
- Confirmar que `executed:false` continua obrigatório.
- Confirmar que nenhum segredo/token/env/header/cookie aparece em resposta/log.

## Template de novo domínio

```text
Nome do domínio:
Descrição:
Owner humano:
Risk level:
Intents permitidas:
Capabilities:
Requer confirmação:
Requer revisão humana:
Adapter mode permitido:
Adapter id mock:
Pode executar real:
Golden scenarios obrigatórios:
Forbidden fields:
Critérios de aceite:
Plano de rollback:
```

## Exemplo fictício: estoque

Domínio: `estoque`

- Risk level: `medium`
- Adapter id mock: `mock-estoque`
- Pode executar real: `false`
- Adapter mode permitido: `mock`
- `executed:false` obrigatório

### Cenários exemplo

- consultar produto parado
- sugerir reposição
- identificar divergência de estoque

Resultado esperado em todos os casos:

- `simulated: true`
- `executed: false`
- nenhum dado sensível exposto

Esse exemplo é apenas documental. Nenhum runtime real é criado nesta PR.

## Como usar este guia

Antes de criar qualquer PR de domínio novo:

1. preencher o template
2. atualizar a Permission Matrix
3. atualizar os Golden Scenarios
4. registrar mock adapter e fixture
5. rodar os testes contratuais
6. rodar smoke/CI quando o domínio entrar no fluxo end-to-end
7. revisar por humano

## Regras finais

- `executed:false` permanece obrigatório.
- mock first.
- human review obrigatório.
- execução real proibida nesta fase.
- forbidden fields incluem `requiredAdapters`, `payload`, `rawMessage`,
  `userMessage`, `segredos`, `tokens`, `env`, `headers`, `cookies` e
  `credentials`.

## Skill Candidate Registry

Para padrões de tarefa recorrentes, consulte
`docs/SKILL_CANDIDATE_REGISTRY.md`. O processo continua em draft e
mock-first; nenhuma skill candidata pode virar execução real nesta fase.

## Memory Policy

Para memória futura, consulte `docs/MEMORY_POLICY.md`. A política define
camadas, thresholds e campos proibidos sem criar storage real, RAG ou segundo
cérebro real nesta PR.

## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` can block domain expansion when onboarding is
missing, incomplete or unsafe. It does not replace onboarding and does not
permit execution real.

## External Integration Provider Registry

New domains that need a future external provider must reference
`docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`. Provider registry review is
required before any provider-specific mock, sandbox or adapter work, and it
does not allow real execution.

## Integration Security Boundary

New domains that involve future integrations must also reference
`docs/INTEGRATION_SECURITY_BOUNDARY.md`. Domain onboarding cannot bypass the
security boundary, cannot allow raw payload logging and cannot permit
`executed:true`.

## External Provider Permission Overlay

New domains that use future external providers must also update
`docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`. The overlay does not replace
Domain Onboarding and does not allow real execution.

## External Provider Mock Adapter Harness

New domains that need future external providers must start with
`docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`. Mock harness coverage does not
replace onboarding and does not permit real providers.

## External Provider Audit, Cost and Rate Limit

New domains that depend on future external providers must account for
`docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`. Cost, rate limit, fallback
and stop conditions are required before sandbox or provider work.

## Tenant and Workspace Isolation

New domains that touch memory, providers, MCP, inbox, cache or business data
must account for `docs/TENANT_WORKSPACE_ISOLATION.md`. Domain onboarding cannot
create cross-workspace access.

## Public Web Data Read-Only Sandbox

New domains that need public web research must account for
`docs/PUBLIC_WEB_READ_ONLY_SANDBOX.md`. Domain onboarding cannot add real
scraping, crawler, provider calls or raw web storage in this phase.

## Transcription Intake Sandbox

New domains that need audio, video or transcript intake must account for
`docs/TRANSCRIPTION_INTAKE_SANDBOX.md`. Domain onboarding cannot add real
transcription providers, uploads, raw audio storage or raw transcript storage
in this phase.
