# Hermes Core Operator Runbook

Este guia descreve o fluxo atual do Hermes Core, os limites de segurança e o
que validar antes de qualquer alteração futura em adapters.

## Fluxo atual

1. `POST /message` classifica `domain` e `intent`.
2. O capability registry monta o plano público seguro.
3. O confirmation gate decide se a ação futura exigirá confirmação.
4. Quando necessário, o core cria uma confirmation pública mínima.
5. `POST /confirm` recebe `sim`, `não` ou resposta ambígua.
6. O sistema responde com `executed: false` sempre.
7. `GET /confirm/:id` consulta o status atual da confirmation.

Estado atual: nenhum adapter real executa. Esta fase existe apenas para
planejamento seguro e contratos públicos estáveis.

Quando a policy permite, o core pode acionar um mock adapter local para
simulação controlada. `simulated: true` significa apenas que a simulação rodou;
não há execução real, side effect ou integração externa.
Os mock adapters são por domínio e expõem `adapter_id` público seguro como
`mock-compras`, `mock-financeiro`, `mock-treinamento`, `mock-marketing` e
`mock-desenvolvimento`.
O Adapter Result Contract público mantém apenas `adapter_id`, `adapter_mode`,
`domain`, `status`, `simulated`, `executed` e `message`; campos internos como
`requiredAdapters`, `payload`, `rawMessage`, `userMessage`, `secret`, `token`,
`env`, `internal` e `credentials` devem ser removidos antes de qualquer
resposta pública.
O Adapter Audit Event Contract segue o mesmo princípio: eventos são apenas logs
seguros, com `event_type`, `trace_id`, `confirmation_id`, `domain`, `intent`,
`adapter_id`, `adapter_mode`, `status`, `executed`, `simulated` e
`timestamp`. Nenhum audit event é persistido em banco nesta PR.

## Regras invariantes

- `executed: false` é obrigatório nesta fase.
- Nenhum serviço real é conectado.
- Nenhum adapter real é chamado.
- Nenhuma persistência durável é usada.
- O kill switch bloqueia qualquer evolução de execução futura.
- `simulated: true` nunca equivale a execução real.
- `adapter_id` público só pode apontar para um mock seguro de domínio.

## Como testar localmente

### 1. Verificar saúde

```bash
curl localhost:8080/health
```

Resposta esperada: `{"status":"ok","service":"hermes-api",...}`.

### 2. Enviar uma mensagem

```bash
curl -X POST localhost:8080/message \
  -H "Content-Type: application/json" \
  -d '{"message":"ver caixa e faturamento do mes"}'
```

O retorno deve incluir `trace_id`, `domain`, `intent`, `status`, `message`,
`confirmation_required` e, quando aplicável, `confirmation`.

### 3. Capturar `confirmation_id`

Quando `confirmation_required=true`, o campo `confirmation.id` é o identificador
público da confirmação pendente.

### 4. Confirmar com `sim`

```bash
curl -X POST localhost:8080/confirm \
  -H "Content-Type: application/json" \
  -d '{"confirmation_id":"confirm_...","message":"sim"}'
```

O retorno precisa manter `executed:false`.

### 5. Confirmar com `não`

```bash
curl -X POST localhost:8080/confirm \
  -H "Content-Type: application/json" \
  -d '{"confirmation_id":"confirm_...","message":"nao"}'
```

O retorno precisa manter `executed:false` e registrar a decisão como rejeitada.

### 6. Consultar status

```bash
curl localhost:8080/confirm/confirm_...
```

O retorno pode ser `pending`, `approved`, `rejected`, `expired` ou `not_found`.

### 7. Provar `not_found`

```bash
curl localhost:8080/confirm/confirm_inexistente
```

O retorno deve ser seguro e continuar com `executed:false`.

### 8. Rodar o smoke test end-to-end

```bash
cd platform
docker compose up --build -d
bash scripts/hermes-smoke-test.sh
```

O `docker compose` local sobe a API com `HERMES_EXECUTION_ENABLED=true` para
permitir a validação do caminho `simulated:true` sem execução real. O script usa
`API_BASE_URL=http://localhost:8080` por padrão e cobre:

- `GET /health`
- `POST /message` para compras, financeiro, treinamento, marketing e
  desenvolvimento
- `GET /confirm/:confirmation_id`
- `POST /confirm` com `sim`
- `POST /confirm` com `confirmation_id` inexistente

Sucesso significa que o fluxo completo respondeu sem expor `requiredAdapters`,
payload interno, `rawMessage`, `userMessage`, tokens ou segredos. Falha no
script significa que algum contrato seguro foi quebrado e a PR deve ser
ajustada antes de seguir.

## 9. CI smoke workflow

O workflow `.github/workflows/hermes-core-smoke.yml` roda em `pull_request` e
`push` para `main`. Ele executa as mesmas validações básicas do fluxo local:

- checkout do repositório
- setup de Node compatível
- `npm install` em `platform/services/api`
- `node --check` nos JS de `platform/services/api`
- `npm test` em `platform/services/api`
- `docker compose config`
- `docker compose up --build -d`
- `bash scripts/hermes-smoke-test.sh`
- `docker compose down` no final, mesmo se houver falha

Esse workflow não usa segredos, não chama serviços externos e não altera o
contrato de `executed:false`.

## 10. Permission Matrix e Golden Scenarios

Antes de criar um domínio novo, consulte `docs/PERMISSION_MATRIX.md` e
`docs/GOLDEN_SCENARIOS.md`. Eles funcionam como contrato prévio para decidir:

- se o domínio pode ler contexto
- se pode planejar
- se pode solicitar confirmação
- se pode rodar mock adapter
- se continua proibido de executar ação real

Checklist mínimo para domínio novo:

- declarar domínio na matriz
- definir `risk_level`
- definir capabilities
- criar mock adapter
- criar golden scenarios
- adicionar testes
- atualizar smoke/CI se necessário
- manter `executed:false`
- revisar por humano

Esses documentos devem ser atualizados antes de qualquer PR futura de adapter
real.

## 11. Domain Onboarding Guide

`docs/DOMAIN_ONBOARDING.md` é o guia oficial para qualquer domínio novo. Ele
exige `mock-first`, `executed:false`, revisão humana, `mock-*` adapter id,
Permission Matrix e Golden Scenarios atualizados antes de qualquer promoção.

O checklist mínimo cobre:

- nome canônico do domínio
- escopo e intents
- `risk_level`
- capabilities
- fixture e testes contratuais
- smoke/CI quando o domínio entrar no fluxo end-to-end
- verificação de forbidden fields e segredos

Sem esse guia aprovado, o domínio não deve avançar para adapter real.

## 12. Skill Candidate Registry

`docs/SKILL_CANDIDATE_REGISTRY.md` é o contrato oficial para skills candidatas.
Ele existe só como base documental nesta fase:

- começa em `draft`
- permanece mock-first
- exige revisão humana
- exige `executed:false`
- não cria skill executável real

Antes de promover uma skill candidata, valide o domínio, a Permission Matrix,
os Golden Scenarios e o rollback plan.

## 13. Memory Policy

`docs/MEMORY_POLICY.md` documenta as camadas oficiais de memória sem criar
storage real nesta PR. Ela cobre session, user/peer, domain/company e
audit/learning memory, thresholds por domínio e forbidden fields.

Regras centrais:

- memória não autoriza `executed:true`
- memória não substitui confirmação humana
- memória não pode misturar usuários, empresas ou domínios
- memória não pode guardar `token`, `secret`, `env`, `headers`, `cookies`,
  `credentials`, `payload`, `rawMessage`, `userMessage` ou `requiredAdapters`
- memória não cria segundo cérebro real nesta fase
- `docs/USER_PEER_MEMORY_SCOPES.md` detalha a camada `user_peer` sem alterar o
  contrato de runtime.
- `docs/SECOND_BRAIN_INBOX_CONTRACT.md` define o inbox futuro do segundo
  cérebro sem storage real, RAG real ou execução real.
## Kill switch

- `HERMES_EXECUTION_KILL_SWITCH=true` bloqueia qualquer execução futura.
- `HERMES_EXECUTION_ENABLED=true` não habilita adapter real nesta fase.
- Mesmo com `HERMES_EXECUTION_ENABLED=true`, o sistema continua sem executar
  nada real.

## Logs permitidos

- `message_received`
- `capability_planned`
- `confirmation_gate_evaluated`
- `confirmation_created`
- `confirmation_store_created`
- `confirmation_response_received`
- `confirmation_store_resolved`
- `confirmation_store_miss`
- `confirmation_status_checked`
- `execution_policy_evaluated`
- `adapter_execution_planned`
- `mock_adapter_simulated`
- `domain_mock_adapter_selected`
- `domain_mock_adapter_missing`
- `adapter_result_sanitized`
- `adapter_result_validated`
- `adapter_audit_event_created`
- `adapter_audit_event_sanitized`
- `adapter_audit_event_validated`

## Logs proibidos

- Mensagem crua do usuário.
- `requiredAdapters` como lista.
- Payload interno.
- Segredos.
- `env` completo.

## Dados que nunca devem aparecer

- Mensagem crua do usuário em response ou log.
- `requiredAdapters`.
- Payload interno de confirmação.
- Segredos.
- Variáveis de ambiente completas.
- Qualquer dado que revele execução real ou integração externa.
- `adapter_id` fora da lista de mocks seguros por domínio.

## Checklist antes de qualquer PR futura de adapter real

- Confirmar que a PR é pequena e por domínio.
- Confirmar que existe teste de confirmação para o fluxo afetado.
- Confirmar que o kill switch foi testado.
- Confirmar que `executed:false` continua obrigatório.
- Confirmar que o mock adapter continua local e não chama serviço real.
- Confirmar que o `adapter_id` público segue o domínio mock correto.
- Confirmar que nenhum serviço real foi conectado.
- Confirmar que o adapter inicial pode ser mock/fake.
- Confirmar que a documentação foi atualizada.

## Checklist de rollback

- Reverter a PR atual.
- Verificar que `executed:false` voltou ao comportamento anterior.
- Confirmar que o kill switch continua bloqueando.
- Validar `/health`, `POST /message`, `POST /confirm` e `GET /confirm/:id`.
- Validar que `simulated:true` aparece apenas em simulação local.
- Validar que `adapter_id` aparece apenas em simulação local e por domínio.

## Checklist de validação local

- `node --check` nos JS de `platform/services/api`.
- `npm test` em `platform/services/api`.
- `curl /health`.
- `curl POST /message`.
- `curl POST /confirm`.
- `curl GET /confirm/:id`.
- Validar `executed:false` em todos os caminhos.
- Validar que `simulated:true` só aparece quando o mock roda localmente.
- Validar que `adapter_id` público corresponde ao domínio.

## Rules for future adapter PRs

- Adapter real só pode entrar em PR pequena por domínio.
- Começar por um adapter fake/mock.
- Requer testes de confirmação do fluxo.
- Requer kill switch testado.
- Requer `executed:false` até liberação explícita em PR separada.
- Requer mock adapter inicial antes de qualquer adapter real.
- Requer registry por domínio aprovado antes de ampliar o escopo.
- Nunca conectar serviço real sem variável de ambiente e documentação.
- Nunca logar payload sensível.
- Nunca expor `requiredAdapters` ou segredos em response público.

## User Peer Memory Scopes

`docs/USER_PEER_MEMORY_SCOPES.md` detalha a camada `user_peer`, cobrindo
escopos por papel, campos permitidos, campos proibidos, isolamento por usuário
e relação com Permission Matrix, Skill Candidate Registry e segundo cérebro
futuro.

## Second Brain Inbox Contract

`docs/SECOND_BRAIN_INBOX_CONTRACT.md` define o contrato oficial do inbox do
futuro segundo cérebro, sem storage real, RAG real ou execução real.
## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` documenta o relatório de governança que pode
bloquear evoluções sensíveis no futuro. Ele cobre permission matrix, golden
scenarios, domain onboarding, capability registry, kill switch, mock adapters,
memory, inbox, quality score, forbidden fields e runtime safety sem virar
scanner real, sem alterar runtime e sem autorizar `executed:true`.

## External Integration Provider Registry

`docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md` documenta como provedores
externos futuros devem ser classificados antes de qualquer integração real. Ele
cobre provider types, candidatos, domínios permitidos/bloqueados, riscos,
OAuth/secrets, custo, compliance, fallback, audit requirements e bloqueios.

Nesta fase o registry não chama API externa, não cria adapter real, não cria
OAuth/secrets, não altera runtime, não persiste dados e não autoriza
`executed:true`. Qualquer provider futuro precisa manter `write_allowed:false`,
`action_allowed:false`, `can_trigger_real_execution:false`, human review e
governance review antes de avançar.

## Integration Security Boundary

`docs/INTEGRATION_SECURITY_BOUNDARY.md` define a fronteira de seguranca para
qualquer integracao externa futura. Ele cobre identity, secrets, payloads,
actions, providers, dominios, custos, compliance, audit e sandbox.

Nesta fase o boundary nao implementa provider real, nao implementa adapter
real, nao chama API externa, nao cria OAuth/secrets, nao altera runtime e nao
autoriza `executed:true`. Ele preserva `mock-first`, human review, governance
review, kill switch, rollback e logs sanitizados como requisitos para qualquer
evolucao futura.

## External Provider Permission Overlay

`docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md` cruza provider externo, dominio,
capability, risco e permissao antes de qualquer uso futuro. Ele complementa a
Permission Matrix, o Provider Registry e o Integration Security Boundary.

Nesta fase o overlay nao implementa provider real, nao implementa adapter real,
nao chama API externa, nao cria OAuth/secrets, nao altera runtime e nao
autoriza `executed:true`. Qualquer regra de overlay deve manter
`write_allowed:false`, `action_allowed:false`, mock-first, human review e
governance review.

## External Provider Mock Adapter Harness

`docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md` documenta como provedores
externos futuros devem ser simulados antes de qualquer integracao real. Ele
define adapter modes, mock scopes, response statuses, request/response fields,
result contracts e exemplos seguros.

Nesta fase o harness usa apenas fixtures e dados sinteticos. Ele nao chama API
externa, nao cria adapter real, nao cria OAuth/secrets, nao grava storage, nao
altera runtime e nao autoriza `executed:true`. Todo exemplo deve manter
`simulated:true`, `executed:false`, `real_provider_called:false`,
`write_allowed:false` e `action_allowed:false`.

## External Provider Audit, Cost and Rate Limit

`docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md` documenta auditoria, custo,
rate limit, fallback e stop conditions para provedores externos futuros.

Nesta fase o contrato nao implementa provider real, adapter real, OAuth,
secrets, rate limiter, budget tracker, scheduler, storage, MCP ou chamadas
externas. Ele nao autoriza `executed:true` nem `real_provider_called:true`; todo
fluxo futuro continua mock-first, human-review e governance-review.

## Tenant and Workspace Isolation

`docs/TENANT_WORKSPACE_ISOLATION.md` documenta a separacao entre Hermes Pessoal,
Grupo Erick e clientes externos SaaS antes de qualquer auth real, tenant
resolver, storage, RLS, Supabase, memoria real, cache, RAG, MCP ou runtime.

Nesta fase o contrato e apenas documentacao, fixture e teste. Ele nao autoriza
`executed:true`, nao permite dados cross-tenant e nao substitui Permission
Matrix, Memory Policy, Integration Security Boundary ou governance review.

## Public Web Data Read-Only Sandbox

`docs/PUBLIC_WEB_READ_ONLY_SANDBOX.md` documenta leitura futura de dados
publicos da web em modo read-only sandbox para pesquisa, resumo e comparacao.

Nesta fase o contrato nao implementa Firecrawl, Bright Data, Scrapeless,
crawler, scraping, provider real, adapter real, OAuth/secrets, storage,
RAG/vector DB, scheduler, cron ou runtime. Ele nao autoriza
`real_provider_called:true`, `executed:true`, escrita, checkout, formulario,
compra, reserva ou pagamento.

## Transcription Intake Sandbox

`docs/TRANSCRIPTION_INTAKE_SANDBOX.md` documenta entrada futura de audio, video
e transcripts em modo sandbox sanitizado para treinamento, atendimento,
marketing, desenvolvimento, Hermes Pessoal e clientes externos.

Nesta fase o contrato nao implementa AssemblyAI, Whisper, provider real,
adapter real, API externa, upload, download, processamento de audio,
transcricao real, storage, fila, scheduler, cron ou runtime. Ele nao autoriza
`real_provider_called:true`, `executed:true`, escrita, action, audio bruto ou
transcript bruto.

## Internal Business API Read-Only

`docs/INTERNAL_BUSINESS_API_READ_ONLY.md` documenta consultas futuras de dados
internos de negocio em modo read-only para Grupo Erick e clientes externos,
sempre com tenant/workspace isolation.

Nesta fase o contrato nao implementa Supabase, Postgres, Base44, ERP/Linx,
Internal Business API real, banco, migration, RLS, query real, raw SQL,
provider real, adapter real, storage ou runtime. Ele nao autoriza write,
action, `real_provider_called:true` ou `executed:true`.

## Personal Workspace Connector Policy

`docs/PERSONAL_WORKSPACE_CONNECTOR_POLICY.md` documenta conectores pessoais
futuros no workspace personal, separados de Grupo Erick e clientes externos.

Nesta fase o contrato nao implementa Gmail, Calendar, Drive, Contacts, OAuth,
tokens, provider real, adapter real, API externa, storage, memoria ou runtime.
Ele nao autoriza send, write, delete, share, action,
`real_provider_called:true` ou `executed:true`.

## Social Media Draft-Only Approval

`docs/SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md` documents the contract-only policy
for future social media draft generation and approval. It keeps all output as
draft content, separates personal, Grupo Erick and external client brand scopes,
and does not implement real social providers, OAuth, tokens, publishing,
scheduling, comments, DMs, media storage, scheduler, adapters or runtime
changes. It keeps `simulated:true`, `executed:false`,
`real_provider_called:false`, `publish_allowed:false` and `send_allowed:false`
mandatory.