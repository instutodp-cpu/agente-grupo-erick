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
      test/
    worker/                 # Hermes Core — jobs/filas (scaffold)
      Dockerfile
      package.json
      src/index.js
```

Evolução prevista (não criada ainda, para não antecipar complexidade):

```text
services/api/src/
  core/            # orquestração: resolver, policy, runtime (ports) — intent-router.js já existe
  adapters/        # postgres, redis, qdrant, mcp-gateway, model-providers
  capabilities/    # registro e capacidades por domínio
  http/            # ingress/BFF, rotas
packages/          # libs compartilhadas (contracts/tipos)
```

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
- `POST /message` → recebe uma mensagem e classifica a intenção (ver §3.1).
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
  "intent": "marketing",
  "service": "hermes-api",
  "version": "2.0.0-scaffold"
}
```

`intent` é um de: `marketing`, `desenvolvimento`, `compras`, `desconhecido`
(fallback). Classificação por palavras-chave (case/acento-insensitive),
implementada em `src/core/intent-router.js` — lógica de domínio pura, sem I/O,
pronta para evoluir para um resolver mais sofisticado sem mudar o contrato.

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

O core define interfaces; adapters implementam. Exemplos de ports previstos:

- `DataStore` (Postgres/Supabase): consultas parametrizadas, transações RO.
- `Queue` (Redis): enfileirar/consumir jobs.
- `SessionStore` (Redis): estado de sessão com TTL.
- `VectorMemory` (Qdrant): upsert/search de embeddings.
- `McpGateway`: `listTools`, `callTool` (sempre sob policy).
- `AgentRuntime`: `run(task, context)` — runtimes substituíveis.
- `ModelProvider`: geração/embeddings, com budget e timeouts.

Regra: o core importa **apenas** ports; `adapters/` provê implementações e são
injetadas na composição (composition root).

## 6. Configuração

Via variáveis de ambiente (ver `.env.example`). O `docker-compose` injeta
`DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, `MCP_GATEWAY_URL` apontando para os
serviços internos. Segredos reais só em `.env`/Railway, nunca no repo.

## 7. Observabilidade

Logs estruturados em JSON (evento + campos). Eventos iniciais: `api_started`,
`api_shutdown`, `worker_started`, `worker_heartbeat`, `worker_shutdown`,
`message_received` (`trace_id`, `intent`, `message_length` — nunca o conteúdo da
mensagem), `message_invalid` (`trace_id`). Métricas e tracing entram junto com o
pipeline de orquestração.

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
