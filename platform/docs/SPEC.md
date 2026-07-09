# Hermes AI Platform v2 — SPEC (Especificação técnica)

## 1. Estrutura do repositório (platform/)

```text
platform/
  docker-compose.yml        # api + worker + redis + postgres + qdrant
  .env.example              # variáveis (defaults funcionam sem .env)
  README.md                 # instruções locais
  CLAUDE.md                 # regras para agentes de código
  docs/
    HERMES_AI_PLATFORM_V2_BLUEPRINT.md
    PRD.md
    SPEC.md
    SECURITY.md
    ROADMAP.md
  services/
    api/                    # Hermes Core — API/orquestrador (scaffold)
      Dockerfile
      package.json
      src/index.js
      src/core/intent-router.js  # classificação de intenção (sem I/O)
      src/core/ports/index.js    # contratos (ports) — stubs "not_implemented"
      src/capabilities/registry.js  # registro de capacidades por domínio (status "planned")
      test/
    worker/                 # Hermes Core — jobs/filas (scaffold)
      Dockerfile
      package.json
      src/index.js
```

Evolução prevista (não criada ainda, para não antecipar complexidade):

```text
services/api/src/
  adapters/        # postgres, redis, qdrant, mcp-gateway, model-providers —
                    # implementações reais dos ports (ainda nenhuma existe)
  http/            # ingress/BFF, rotas
packages/          # libs compartilhadas (contracts/tipos)
```

`core/ports/` e `capabilities/registry.js` já existem como **contrato puro**:
nenhum adapter real, nenhuma conexão externa, nenhuma execução — ver §5 e §5.1.
O processo oficial para novos domínios fica em `docs/DOMAIN_ONBOARDING.md` e
deve ser seguido junto com `docs/PERMISSION_MATRIX.md` e
`docs/GOLDEN_SCENARIOS.md`.
O catálogo de padrões de tarefa para evoluções futuras fica em
`docs/SKILL_CANDIDATE_REGISTRY.md`; ele documenta drafts, não execução real.
A política oficial de memória fica em `docs/MEMORY_POLICY.md`; ela documenta
camadas e thresholds sem criar storage real nesta PR.
O registry oficial de provedores externos fica em
`docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`; ele documenta provider types,
candidatos, riscos e bloqueios antes de qualquer integração real, sem chamar
APIs externas, sem criar adapter real e sem autorizar `executed:true`.

## 2. Serviços e portas

| Serviço  | Imagem/where           | Porta(s)        | Papel                          |
| -------- | ---------------------- | --------------- | ------------------------------ |
| api      | `services/api`         | 8080            | Hermes Core (orquestrador)     |
| worker   | `services/worker`      | —               | Jobs/filas (background)        |
| postgres | `postgres:16-alpine`   | 5432            | Fonte transacional             |
| redis    | `redis:7-alpine`       | 6379            | Fila / cache / sessões         |
| qdrant   | `qdrant/qdrant`        | 6333 / 6334     | RAG / memória vetorial         |

## 3. API (scaffold)

Sem dependências npm (usa `http` nativo). Endpoints:

- `GET /health` → `{ status:"ok", service:"hermes-api", version }` (liveness).
- `GET /ready` → `{ status:"ready", config:{ database, redis, qdrant, mcpGateway } }`
  (readiness; **apenas booleanos** de presença de config, nunca valores).
- `POST /message` → recebe uma mensagem, classifica a intenção, consulta o
  capability registry e passa pelo confirmation gate para planejar a resposta
  segura (ver §3.1).
- `POST /confirm` → recebe uma resposta de confirmação e classifica a decisão
  sem executar adapters (ver §3.2).
- `GET /confirm/:confirmation_id` → consulta o status público de uma
  confirmação no store em memória (ver §3.3).
- `GET /` → identidade do serviço e ponteiro para o blueprint.

### 3.1 `POST /message` — contrato

Request (`Content-Type: application/json`):

```json
{
  "message": "lançar campanha de marketing",
  "trace_id": "opcional — gerado pelo servidor se ausente"
}
```

- `message` (string, obrigatório, não-vazia): texto a classificar.
- `trace_id` (string, opcional): se enviado, é reaproveitado na resposta e nos
  logs; caso contrário o servidor gera um novo (`crypto.randomUUID()`).

Response `200 OK`:

```json
{
  "trace_id": "a1b2c3d4-...",
  "domain": "marketing",
  "intent": "planejar_marketing",
  "status": "planned",
  "message": "Intencao identificada; execucao ainda nao implementada.",
  "confirmation_required": true,
  "confirmation": {
    "id": "confirm_0123456789abcdef0123456789abcdef",
    "status": "pending",
    "expires_in_seconds": 900
  }
}
```

- `domain` / `intent`: par classificado pelo roteador (ver tabela abaixo).
- `status`: vem do plano da capability registrada para o domínio. Nesta etapa é
  sempre `"planned"`; nenhuma ação real é executada.
- `message`: mensagem pública segura definida pelo plano da capability. Não é
  eco do texto enviado.
- `confirmation_required`: decisão do confirmation gate para execução futura.
  `compras`, `financeiro`, `treinamento`, `marketing` e `desenvolvimento`
  retornam `true`; `desconhecido` retorna `false` e mantém fallback seguro.
- `confirmation`: presente somente quando `confirmation_required` é `true`.
  Contém apenas `id`, `status: "pending"` e `expires_in_seconds`; não persiste
  nada em banco nesta etapa e não inclui payload interno nem mensagem crua.
- Campos internos do registry, como `requiredAdapters`, não fazem parte da
  resposta pública.

Classificação por palavras-chave (case/acento-insensitive), implementada em
`src/core/intent-router.js` — lógica de domínio pura, sem I/O, pronta para
evoluir para um resolver mais sofisticado sem mudar o contrato de
`classifyIntent` (`{ domain, intent }`).

| Domínio         | Intent                                          | Palavras-chave (exemplos)                                                              |
| --------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `marketing`      | `planejar_marketing`                              | marketing, campanha, anúncio, propaganda, publicidade, venda, promoção, divulgação      |
| `desenvolvimento`| `desenvolvimento`                                 | bug, deploy, código, api, erro, feature, commit, merge, build, release, refactor         |
| `compras`        | `consultar_compras` ou `consultar_vencimentos`\*  | compra, comprar, pedido, fornecedor, cotação, orçamento, fatura, invoice, purchase order |
| `financeiro`     | `consultar_financeiro`                            | financeiro, caixa, faturamento, lucro, despesa(s), dre, sangria, contas, pagamento       |
| `treinamento`    | `consultar_treinamento`                           | treinamento, curso(s), módulo(s), certificado, quiz, capacitai, colaborador              |
| `desconhecido`   | `desconhecido`                                    | fallback — nenhuma palavra-chave dos domínios acima encontrada                          |

\* `compras` retorna `consultar_vencimentos` quando a mensagem menciona
`vencimento`, `duplicata`, `prazo`, `boleto` ou `nota fiscal`; caso contrário
retorna `consultar_compras`.

Response `400 Bad Request` (quando `message` está ausente, vazio, não é string,
ou o corpo não é JSON válido):

```json
{ "error": "invalid_request", "message": "'message' é obrigatório" }
```

### 3.2 `POST /confirm` — contrato

Request (`Content-Type: application/json`):

```json
{
  "confirmation_id": "confirm_0123456789abcdef0123456789abcdef",
  "message": "sim"
}
```

- `confirmation_id` (string, obrigatório): identificador público recebido em
  `POST /message`.
- `message` (string): resposta do usuário. O conteúdo não é logado.

Response `200 OK`:

```json
{
  "confirmation_id": "confirm_0123456789abcdef0123456789abcdef",
  "decision": "approved",
  "status": "received",
  "confirmation_status": "approved",
  "execution_status": "simulated",
  "execution_policy": "not_implemented",
  "simulated": true,
  "adapter_id": "mock-financeiro",
  "adapter_mode": "mock",
  "executed": false,
  "message": "Confirmacao recebida; execucao real ainda nao esta habilitada."
}
```

- `decision`: `approved`, `rejected` ou `unknown`, classificado por
  `src/core/confirmation-response.js`.
- `status`: `received` quando o `confirmation_id` existe e ainda não expirou;
  `not_found` quando não existe; `expired` quando já expirou.
- `confirmation_status`: estado seguro no store em memória (`pending`,
  `approved`, `rejected`, `expired` ou `not_found`). `unknown` mantém a
  confirmação como `pending`.
- `execution_status`: `simulated` quando a confirmação aprovada passa pelo
  mock adapter local; `not_available` quando o domínio não possui mock;
  `disabled` quando a policy bloqueia; `not_requested` nos demais casos.
- `execution_policy`: `disabled`, `kill_switch_active` ou `not_implemented`
  quando uma confirmação aprovada passa pela policy de execução; ausente nos
  demais casos.
- `simulated`: `true` somente quando o mock adapter roda localmente; não
  significa execução real.
- `adapter_id` / `adapter_mode`: identificadores públicos seguros do mock
  selecionado, presentes apenas quando o domínio possui mock e a simulação
  local roda.
- `executed`: sempre `false` nesta etapa. O endpoint não chama adapters, não
  persiste em banco e não conecta serviços reais.
- `message`: mensagem pública segura. Não ecoa a resposta enviada.

Exemplos de classificação:

| Decision | Exemplos |
| -------- | -------- |
| `approved` | sim, confirmar, confirma, pode executar, aprovado, ok, yes |
| `rejected` | não, cancelar, cancela, rejeitar, rejeitado, não executar, no |
| `unknown` | qualquer texto ambíguo |

Response `400 Bad Request` (quando `confirmation_id` está ausente, vazio, não é
string, ou o corpo não é JSON válido):

```json
{ "error": "invalid_request", "message": "'confirmation_id' e obrigatorio" }
```

### 3.3 `GET /confirm/:confirmation_id` — contrato

Response `200 OK`:

```json
{
  "confirmation_id": "confirm_0123456789abcdef0123456789abcdef",
  "status": "pending",
  "executed": false,
  "message": "Confirmacao pendente; nenhuma execucao foi realizada.",
  "domain": "financeiro",
  "intent": "consultar_financeiro",
  "expires_at": "2026-01-01T00:15:00.000Z"
}
```

- `status`: `pending`, `approved`, `rejected`, `expired` ou `not_found`.
- `executed`: sempre `false`.
- `message`: mensagem pública segura baseada no status.
- `domain`, `intent` e `expires_at`: metadados seguros opcionais quando a
  confirmação existe no store.
- `requiredAdapters`, payload interno, mensagem crua e segredos não aparecem.

Para `not_found`, a resposta pública retorna apenas:

```json
{
  "confirmation_id": "confirm_missing",
  "status": "not_found",
  "executed": false,
  "message": "Confirmacao nao encontrada; nenhuma execucao foi realizada."
}
```

### 3.4 Referências de expansão por domínio

- `docs/DOMAIN_ONBOARDING.md` descreve o processo oficial para novos domínios.
- `docs/PERMISSION_MATRIX.md` descreve permissões, risco e modo de adapter por
  domínio.
- `docs/GOLDEN_SCENARIOS.md` descreve os cenários oficiais de validação antes
  de qualquer adapter real.
- `docs/SKILL_CANDIDATE_REGISTRY.md` descreve o contrato oficial de skills
  candidatas em draft, sempre mock-first.
- Qualquer domínio novo deve preservar `executed:false`, `mock first` e
  confirmação humana quando aplicável.

## 4. Worker (scaffold)

Sem dependências npm (usa `net`/`url`). Emite `worker_heartbeat` a cada
`WORKER_HEARTBEAT_MS` com uma checagem TCP de readiness de postgres/redis/qdrant.
O consumo real de filas (Redis) será um **adapter** em etapa futura.

## 5. Contratos (ports) — direção

O core define interfaces; adapters implementam. Os ports abaixo já existem em
`src/core/ports/index.js` como **stubs**: cada método lança
`Error('not_implemented')` até que um adapter real seja injetado. Nenhuma
conexão externa acontece nesses stubs.

- `DataStore` (Postgres/Supabase): `query(sql, params)`, `transaction(fn)`.
- `Queue` (Redis): `enqueue(job)`, `consume(handler)`.
- `SessionStore` (Redis): `get(sessionId)`, `set(sessionId, data, ttlSeconds)`.
- `VectorMemory` (Qdrant): `upsert(vectors)`, `search(query, topK)`.
- `McpGateway`: `listTools()`, `callTool(name, args)` (sempre sob policy).
- `AgentRuntime`: `run(task, context)` — runtimes substituíveis.
- `ModelProvider`: `generate(prompt, options)`, `embed(text)`.

Regra: o core importa **apenas** ports; `adapters/` provê implementações e são
injetadas na composição (composition root) — ainda não criada.

### 5.1 Capabilities registry

`src/capabilities/registry.js` mapeia cada domínio já classificado pelo
intent-router para metadados de execução futura — nenhuma capacidade está
implementada ainda:

```json
{
  "domain": "compras",
  "description": "Consultas de compras e vencimentos (pedidos, fornecedores, duplicatas).",
  "status": "planned",
  "publicMessage": "Intencao identificada; execucao ainda nao implementada.",
  "requiredAdapters": ["DataStore"]
}
```

Todos os 6 domínios (`compras`, `financeiro`, `treinamento`, `marketing`,
`desenvolvimento`, `desconhecido`) estão registrados com `status: "planned"` e
uma `publicMessage` segura. `requiredAdapters` só documenta qual port cada
domínio usará quando a execução real for implementada — não importa nem
instancia o adapter.

`POST /message` consulta este registro depois do intent-router e usa o plano da
capability para montar `status` e `message`. A resposta pública nunca inclui
`requiredAdapters` nem qualquer campo de confirmação interna.

### 5.2 Confirmation gate

`src/core/confirmation-gate.js` é um módulo puro, sem I/O, que decide se uma
capability exigirá confirmação antes de qualquer execução futura por adapter.
Nesta etapa, todos os domínios com capacidade planejada (`compras`,
`financeiro`, `treinamento`, `marketing`, `desenvolvimento`) exigem confirmação.
`desconhecido` não exige confirmação porque não há execução possível e continua
no fallback seguro.

O gate não chama adapters, não conecta serviços reais e não autoriza execução;
ele apenas expõe `confirmation_required` no contrato público de `POST /message`.

### 5.3 Pending confirmation

`src/core/pending-confirmation.js` é um módulo puro que monta o objeto público
mínimo de confirmação pendente quando `confirmation_required` é `true`:

```json
{
  "id": "confirm_0123456789abcdef0123456789abcdef",
  "status": "pending",
  "expires_in_seconds": 900
}
```

O `id` é derivado de forma segura a partir de `trace_id` e um UUID aleatório,
sem expor o `trace_id` bruto. Nada é persistido, enfileirado ou executado nesta
etapa. Para `desconhecido`, `confirmation_required` é `false` e o campo
`confirmation` não é retornado.

### 5.4 In-memory confirmation store

`src/core/confirmation-store.js` mantém confirmações pendentes em memória para o
MVP local. O store não usa banco, Redis, filas nem serviços externos. Ele guarda
somente metadados seguros:

```json
{
  "confirmation_id": "confirm_0123456789abcdef0123456789abcdef",
  "trace_id": "a1b2c3d4-...",
  "domain": "financeiro",
  "intent": "consultar_financeiro",
  "status": "pending",
  "expires_at": "2026-01-01T00:15:00.000Z"
}
```

Não salva mensagem crua, `requiredAdapters`, payload interno ou segredos.
`POST /message` cria registro somente quando `confirmation_required` é `true`.
`POST /confirm` consulta esse store; se o id não existir ou estiver expirado,
responde de forma segura com `executed: false`.

### 5.5 Confirmation response

`src/core/confirmation-response.js` é um módulo puro que normaliza a resposta do
usuário e classifica a decisão como `approved`, `rejected` ou `unknown`. O
endpoint `POST /confirm` usa essa decisão apenas para registrar recebimento e
retornar um contrato público seguro. `approved` e `rejected` resolvem o registro
em memória; `unknown` mantém `pending`. Nenhuma execução real é habilitada.

Operação manual, limites e checklist de segurança ficam documentados em
`docs/OPERATOR_RUNBOOK.md`.

### 5.6 Adapter execution placeholder

`src/core/adapter-execution.js` expõe um contrato interno puro para planejar a
execução futura de adapters. Nesta etapa ele sempre retorna
`execution_allowed: false` e `executed: false`, com `reason:
"execution_disabled_by_policy"`, `execution_kill_switch_active`,
`adapter_execution_simulated` ou `adapter_execution_not_available`, conforme a
política e a presença de mock por domínio. Quando a policy permite
planejamento, ele chama `src/core/mock-adapter-runner.js`, que usa o registry
de domínio para simular localmente sem qualquer efeito real. O `POST /confirm`
só chama esse fluxo quando a confirmação existe e a decisão é `approved`.

`src/core/domain-mock-adapter-registry.js` mapeia os domínios conhecidos para
mocks públicos seguros: `mock-compras`, `mock-financeiro`,
`mock-treinamento`, `mock-marketing` e `mock-desenvolvimento`. Domínio sem
mock retorna um status seguro e não simula nada.

`src/core/mock-adapter-runner.js` é um mock puro que retorna um resultado
simulado com `adapter_id`, `adapter_mode: "mock"`, `simulated: true`,
`executed: false` e `status: "simulated"`. Quando não há mock para o domínio,
ele retorna `status: "not_available"` sem efeito real.

### 5.7 Adapter Result Contract

`src/core/adapter-result-contract.js` define o contrato público seguro para
resultados de adapters nesta fase. O formato permitido é restrito a:

```json
{
  "adapter_id": "mock-compras",
  "adapter_mode": "mock",
  "domain": "compras",
  "status": "simulated",
  "simulated": true,
  "executed": false,
  "message": "Mock adapter simulation completed without real execution."
}
```

- `adapter_mode` é sempre `"mock"` nesta etapa.
- `executed` é sempre `false`.
- `simulated` só pode ser `true` quando o resultado é de mock.
- `status` aceita apenas `simulated`, `disabled`, `not_available` ou `failed`.
- `sanitizeAdapterResult` remove `requiredAdapters`, `payload`, `rawMessage`,
  `userMessage`, `secret`, `token`, `env`, `internal` e `credentials` de
  qualquer objeto de entrada antes de produzir o resultado público.
- `validateAdapterResult` rejeita qualquer resultado com `executed: true`.
- `buildAdapterResult` compõe um resultado público seguro e cai para
  `status: "failed"` se a validação não passar.

### 5.8 Adapter Audit Event Contract

`src/core/adapter-audit-event.js` define o contrato seguro de eventos de
auditoria para o fluxo de adapter/mock execution. Os campos públicos permitidos
nesta fase são:

```json
{
  "event_type": "adapter_simulation_started",
  "trace_id": "trace-123",
  "confirmation_id": "confirm-123",
  "domain": "compras",
  "intent": "registrar_compra",
  "adapter_id": "mock-compras",
  "adapter_mode": "mock",
  "status": "simulated",
  "executed": false,
  "simulated": true,
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

- `event_type` aceita apenas `adapter_simulation_started`,
  `adapter_simulation_completed`, `adapter_execution_blocked`,
  `adapter_result_sanitized` e `adapter_result_validated`.
- `adapter_mode` é sempre `"mock"`.
- `executed` é sempre `false`.
- `sanitizeAdapterAuditEvent` remove campos proibidos como `rawMessage`,
  `userMessage`, `requiredAdapters`, `payload`, `internal`, `env`, `token`,
  `secret`, `credentials`, `headers`, `authorization`, `cookie`, `stack` e o
  corpo completo da requisição.
- `validateAdapterAuditEvent` rejeita `executed: true`, `adapter_mode` diferente
  de `mock` e eventos sem `event_type`, `trace_id` ou `confirmation_id`.
- Estes eventos são somente logs seguros nesta fase; nenhum audit event é
  persistido em banco.

### 5.9 Memory Policy

`docs/MEMORY_POLICY.md` define o contrato oficial de memória do Hermes Core
sem implementar storage real. As camadas documentadas são `session`,
`user_peer`, `domain_company` e `audit_learning`; todas devem respeitar
isolamento, campos proibidos e `executed:false` como regra operacional. A
política existe para orientar a evolução futura de memória, não para habilitar
RAG, banco, vector DB ou segundo cérebro real nesta PR.

### 5.10 Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` define o contrato oficial do relatório de
governança do Hermes Core. O documento lista áreas de checagem, status,
severidades, achados e bloqueios, mas não implementa scanner real, CI gate
novo, auditoria automatica real ou qualquer mudanca de runtime. O reporte
continua sem autorizar `executed:true` ou execucao real.

### 5.12 External Integration Provider Registry

`docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md` define o contrato oficial para
catalogar provedores externos futuros antes de qualquer integração real. O
registry cobre provider types, candidatos, status, campos obrigatórios,
bloqueios, regras por domínio, custo, compliance, OAuth/secrets, tenant
isolation e review de governança.

Nesta fase o registry não chama Firecrawl, Bright Data, Scrapeless, Composio,
AssemblyAI, Google, redes sociais, GitHub, Supabase, Base44, MCP ou qualquer
API real. Também não cria scanner, adapter, storage, OAuth, secrets ou runtime
novo. `write_allowed`, `action_allowed`, `can_trigger_real_execution` e
`executed` continuam `false`.

### 5.13 Integration Security Boundary

`docs/INTEGRATION_SECURITY_BOUNDARY.md` define a fronteira de seguranca para
qualquer integracao externa futura. O boundary cobre identity, secrets,
payloads, actions, providers, dominios, custos, compliance, audit e sandbox.

Nesta fase o boundary nao implementa provider real, adapter real, OAuth,
secrets, storage, MCP ou chamadas externas. Ele apenas documenta campos
permitidos/proibidos, regras default, blocking rules e provider type rules. A
fronteira nao substitui Permission Matrix, confirmacao humana ou governance
review, e nao autoriza `executed:true`.

### 5.14 External Provider Permission Overlay

`docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md` define o overlay oficial entre a
Permission Matrix e provedores externos futuros. Ele cruza `provider_id`,
`provider_type`, dominio, capability, risco, permissoes, human review,
governance review e security boundary.

Nesta fase o overlay nao implementa provider real, adapter real, OAuth,
secrets, storage, MCP ou chamadas externas. Ele nao substitui Permission
Matrix, Integration Security Boundary, confirmacao humana ou governance review,
e nao autoriza escrita real, acao real ou `executed:true`.

### 5.15 External Provider Mock Adapter Harness

`docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md` define o contrato oficial para
simular provedores externos futuros antes de qualquer integracao real. O harness
cobre adapter modes, mock scopes, response statuses, request/response fields,
result contracts, blocking rules e exemplos seguros.

Nesta fase o harness usa apenas fixtures e dados sinteticos. Ele nao implementa
provider real, adapter real, OAuth, secrets, storage, MCP ou chamadas externas.
Todo exemplo deve manter `simulated:true`, `executed:false`,
`real_provider_called:false`, `write_allowed:false` e `action_allowed:false`.

### 5.16 External Provider Audit, Cost and Rate Limit

`docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md` define o contrato oficial para
auditoria, custo, rate limit, fallback e stop conditions de provedores externos
futuros. O contrato cobre audit fields, event types, cost risk, rate limit risk,
budget scopes, fallback policies, stop conditions, provider type rules e
blocking rules.

Nesta fase o contrato nao implementa provider real, adapter real, OAuth,
secrets, storage, scheduler, rate limiter, budget tracker, MCP ou chamadas
externas. Todo exemplo deve manter `simulated:true`, `executed:false`,
`real_provider_called:false`, `write_allowed:false` e `action_allowed:false`.

## 6. Configuração

Via variáveis de ambiente (ver `.env.example`). O `docker-compose` injeta
`DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, `MCP_GATEWAY_URL` apontando para os
serviços internos. Segredos reais só em `.env`/Railway, nunca no repo.

- `HERMES_EXECUTION_ENABLED=false` por padrão.
- `HERMES_EXECUTION_KILL_SWITCH=true` bloqueia qualquer execução futura.
- Mesmo com `HERMES_EXECUTION_ENABLED=true`, nenhum adapter real executa nesta
  fase; o máximo que acontece é uma simulação local via mock adapter por
  domínio.
- Consulte `docs/OPERATOR_RUNBOOK.md` para o procedimento operacional
  detalhado, incluindo validação manual, rollback e regras para PRs futuras de
  adapter.

## 7. Observabilidade

Logs estruturados em JSON (evento + campos). Eventos iniciais: `api_started`,
`api_shutdown`, `worker_started`, `worker_heartbeat`, `worker_shutdown`,
`message_received` (`trace_id`, `domain`, `intent`, `message_length` — nunca o
conteúdo da mensagem), `capability_planned` (`trace_id`, `domain`, `intent`,
`status`, `required_adapters_count`), `confirmation_gate_evaluated` (`trace_id`,
`domain`, `intent`, `confirmation_required`), `confirmation_created`
(`trace_id`, `domain`, `intent`, `confirmation_id`, `expires_in_seconds`),
`confirmation_store_created` (`trace_id`, `domain`, `intent`,
`confirmation_id`, `expires_at`), `confirmation_response_received`
(`confirmation_id`, `decision`, `message_length`), `confirmation_store_resolved`
(`confirmation_id`, `decision`, `confirmation_status`), `adapter_execution_planned`
(`confirmation_id`, `decision`, `execution_allowed`, `executed`, `reason`,
`required_adapters_count`, `execution_status`, `simulated`, `adapter_id`,
`adapter_mode`), `domain_mock_adapter_selected` (`confirmation_id`, `domain`,
`adapter_id`, `adapter_mode`), `domain_mock_adapter_missing` (`confirmation_id`,
`domain`),
`mock_adapter_simulated` (`confirmation_id`, `domain`, `intent`,
`adapter_mode`, `simulated`, `executed`), `adapter_result_sanitized`
(`adapter_id`, `domain`, `removed_fields_count`), `adapter_result_validated`
(`adapter_id`, `domain`, `status`, `executed`), `execution_policy_evaluated`
(`execution_enabled`, `kill_switch_active`, `reason`), `adapter_audit_event_created`
(`event_type`, `trace_id`, `confirmation_id`, `domain`, `intent`, `adapter_id`,
`adapter_mode`, `status`, `executed`, `simulated`, `timestamp`),
`adapter_audit_event_sanitized` (`event_type`, `trace_id`, `confirmation_id`,
`domain`, `intent`, `adapter_id`, `adapter_mode`, `status`, `executed`,
`simulated`, `removed_fields_count`), `adapter_audit_event_validated`
(`event_type`, `trace_id`, `confirmation_id`, `domain`, `intent`, `adapter_id`,
`adapter_mode`, `status`, `executed`, `simulated`, `valid`),
`confirmation_store_miss` (`confirmation_id`), `message_invalid` (`trace_id`).
Métricas e tracing entram junto com o pipeline de orquestração.

## 8. Testes e qualidade

- Núcleo em Node; testes com o runner nativo (`node --test`) quando houver lógica.
- `node --check` em arquivos JS.
- Cada PR pequena, com docs atualizadas e sem acoplar o core.

## 9. Critérios de aceite (fundação)

- `cd platform && docker compose up --build` sobe os 5 serviços.
- `GET /health` responde 200; `worker` emite heartbeat.
- Nenhuma ferramenta específica acoplada ao core.
- Documentação explica Core, agentes, MCP Gateway, memória, permissões, deploy,
  roadmap.
- O smoke test end-to-end local fica em `scripts/hermes-smoke-test.sh`; ele usa
  `API_BASE_URL=http://localhost:8080` por padrão e valida `GET /health`,
  `POST /message`, `GET /confirm/:id` e `POST /confirm` sem expor campos
  proibidos. Para observar `simulated:true`, a API local sobe com
  `HERMES_EXECUTION_ENABLED=true` apenas no ambiente de desenvolvimento.
- O contrato de governança futura fica em `docs/GOVERNANCE_CHECK_REPORT.md`;
  ele serve para revisar a saude dos contratos e bloquear regressões
  sensiveis, sem virar scanner real.
- O contrato de fronteira de integracao fica em
  `docs/INTEGRATION_SECURITY_BOUNDARY.md`; ele define limites para qualquer
  provider futuro sem alterar runtime ou permitir `executed:true`.
- O overlay de permissao para providers externos fica em
  `docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`; ele cruza provider, dominio e
  capability sem habilitar provider real ou `executed:true`.
- O harness de mock para providers externos fica em
  `docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`; ele simula providers apenas
  com fixtures seguras e dados sinteticos.
- O contrato de auditoria, custo e rate limit para providers externos fica em
  `docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`; ele documenta limites,
  fallback e stop conditions sem criar provider real, rate limiter ou budget
  tracker.
