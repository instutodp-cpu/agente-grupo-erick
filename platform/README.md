# Hermes AI Platform v2

Orquestrador principal de um ecossistema de IA para negócios, apps internos,
automações, dados, WhatsApp, Base44, Supabase, GitHub, Claude Code, MCPs e
agentes especialistas.

> **Hermes é o núcleo.** Nenhuma ferramenta específica (runtime de agente, DB,
> fila, vetor, MCP) fica acoplada ao núcleo — tudo entra por adaptadores
> substituíveis. Ver `docs/HERMES_AI_PLATFORM_V2_BLUEPRINT.md`.

Esta pasta (`platform/`) é a **base v2**, independente do Hermes v1 na raiz do
repositório.

## Documentação (fonte da verdade)

- **Blueprint da arquitetura**: `docs/HERMES_AI_PLATFORM_V2_BLUEPRINT.md`
- **PRD**: `docs/PRD.md`
- **SPEC técnica**: `docs/SPEC.md`
- **Segurança**: `docs/SECURITY.md`
- **Roadmap**: `docs/ROADMAP.md`
- **Regras para agentes de código**: `CLAUDE.md`

## Pré-requisitos

- Docker + Docker Compose.

## Subir localmente

```bash
cd platform
docker compose up --build
```

Isso sobe cinco serviços:

| Serviço  | Porta local | Papel                       |
| -------- | ----------- | --------------------------- |
| api      | 8080        | Hermes Core (orquestrador)  |
| worker   | —           | Jobs/filas (heartbeat)      |
| postgres | 5432        | Fonte transacional          |
| redis    | 6379        | Fila / cache / sessões      |
| qdrant   | 6333/6334   | RAG / memória vetorial      |

Funciona **sem `.env`** (usa defaults). Para customizar:

```bash
cp .env.example .env
# edite .env
```

## Verificar

```bash
curl localhost:8080/health   # {"status":"ok","service":"hermes-api",...}
curl localhost:8080/ready    # presença de config (booleanos)
```

O `worker` emite `worker_heartbeat` no log a cada ~15s, com uma checagem de
readiness (TCP) de postgres/redis/qdrant.

## Enviar uma mensagem

`POST /message` recebe `{ "message": "..." }`, classifica **domínio + intenção**,
consulta o capability registry e passa pelo confirmation gate antes de qualquer
execução futura.
Domínios: `marketing`, `desenvolvimento`, `compras`, `financeiro`, `treinamento`
ou `desconhecido` (fallback). O `status` é sempre `"planned"` nesta etapa — o
core só planeja, ainda não executa a ação nem conecta serviços reais.

A resposta pública expõe apenas `trace_id`, `domain`, `intent`, `status`,
`message`, `confirmation_required` e, quando a confirmação for necessária,
`confirmation` com `id`, `status` e `expires_in_seconds`. Metadados internos do
registry, como adapters requeridos, ficam fora do contrato público.

```bash
curl -X POST localhost:8080/message \
  -H "Content-Type: application/json" \
  -d '{"message":"lançar campanha de marketing"}'
# {
#   "trace_id": "...",
#   "domain": "marketing",
#   "intent": "planejar_marketing",
#   "status": "planned",
#   "message": "Intencao identificada; execucao ainda nao implementada.",
#   "confirmation_required": true,
#   "confirmation": {
#     "id": "confirm_...",
#     "status": "pending",
#     "expires_in_seconds": 900
#   }
# }
```

Contrato completo (todos os domínios/intents) em `docs/SPEC.md` (§3.1).

## Responder confirmação

`POST /confirm` recebe uma resposta do usuário para uma confirmação pendente,
valida o `confirmation_id` no store em memória local e classifica a decisão como
`approved`, `rejected` ou `unknown`. O endpoint não executa adapters, não
persiste em banco e sempre retorna `executed: false`.

```bash
curl -X POST localhost:8080/confirm \
  -H "Content-Type: application/json" \
  -d '{"confirmation_id":"confirm_...","message":"sim"}'
# {
#   "confirmation_id": "confirm_...",
#   "decision": "approved",
#   "status": "received",
#   "confirmation_status": "approved",
#   "executed": false,
#   "message": "Confirmacao recebida; execucao real ainda nao esta habilitada."
# }
```

## Estrutura

```text
platform/
  docker-compose.yml
  .env.example
  README.md · CLAUDE.md
  docs/            # Blueprint, PRD, SPEC, SECURITY, ROADMAP
  services/
    api/           # Hermes Core — API (scaffold, http nativo)
    worker/        # Hermes Core — worker (scaffold, sem deps)
```

## Deploy (produção)

Primeiro ambiente 24/7: **Railway** — `api` e `worker` como serviços; Postgres via
**Supabase**; Redis e Qdrant gerenciados. Segredos só em variáveis de ambiente,
nunca no repositório. Ver `docs/ROADMAP.md` (Fase 8).

## Estado atual

Fundação (Fase 0): estrutura, documentação e núcleo mínimo. **Sem** funcionalidades
complexas ainda — a base é desacoplada e pronta para evoluir sem retrabalho.
