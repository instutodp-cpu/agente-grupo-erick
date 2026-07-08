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

## User Peer Memory Scopes

`docs/USER_PEER_MEMORY_SCOPES.md` detalha a camada `user_peer` para papéis,
escopo de acesso, isolamento e campos permitidos, sem alterar runtime.

## Second Brain Inbox Contract

`docs/SECOND_BRAIN_INBOX_CONTRACT.md` define o contrato do inbox do futuro
segundo cérebro sem storage real, RAG real ou execução real.
