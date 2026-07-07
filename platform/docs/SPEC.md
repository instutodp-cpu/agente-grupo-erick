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
  "confirmation_required": true
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

## 6. Configuração

Via variáveis de ambiente (ver `.env.example`). O `docker-compose` injeta
`DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, `MCP_GATEWAY_URL` apontando para os
serviços internos. Segredos reais só em `.env`/Railway, nunca no repo.

## 7. Observabilidade

Logs estruturados em JSON (evento + campos). Eventos iniciais: `api_started`,
`api_shutdown`, `worker_started`, `worker_heartbeat`, `worker_shutdown`,
`message_received` (`trace_id`, `domain`, `intent`, `message_length` — nunca o
conteúdo da mensagem), `capability_planned` (`trace_id`, `domain`, `intent`,
`status`, `required_adapters_count`), `confirmation_gate_evaluated` (`trace_id`,
`domain`, `intent`, `confirmation_required`), `message_invalid` (`trace_id`).
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
