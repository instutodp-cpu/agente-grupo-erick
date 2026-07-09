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
- **Runbook operacional**: `docs/OPERATOR_RUNBOOK.md`
- **Roadmap**: `docs/ROADMAP.md`
- **Permission Matrix**: `docs/PERMISSION_MATRIX.md`
- **Golden Scenarios**: `docs/GOLDEN_SCENARIOS.md`
- **Domain Onboarding**: `docs/DOMAIN_ONBOARDING.md`
- **Skill Candidate Registry**: `docs/SKILL_CANDIDATE_REGISTRY.md`
- **Memory Policy**: `docs/MEMORY_POLICY.md`
- **Governance Check Report**: `docs/GOVERNANCE_CHECK_REPORT.md`
- **External Integration Provider Registry**: `docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`
- **Integration Security Boundary**: `docs/INTEGRATION_SECURITY_BOUNDARY.md`
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
persiste em banco e sempre retorna `executed: false`. Quando a confirmação é
aprovada e válida, o core pode registrar um mock adapter local ou manter a
execução bloqueada, sempre com `executed: false`; nada real é disparado. A
política de execução fica bloqueada por padrão:
`HERMES_EXECUTION_ENABLED=false` e `HERMES_EXECUTION_KILL_SWITCH=true` por
segurança; mesmo com a variável de execução habilitada, nenhum adapter real
executa nesta fase. Quando a policy permite planejamento, o core pode rodar um
mock adapter local para simulação controlada; `simulated: true` significa
apenas isso, nunca execução real.
Os mock adapters são por domínio e usam `adapter_id` público seguro como
`mock-compras`, `mock-financeiro`, `mock-treinamento`, `mock-marketing` e
`mock-desenvolvimento`.
O resultado público segue o Adapter Result Contract: `adapter_id`,
`adapter_mode`, `domain`, `status`, `simulated`, `executed` e `message`.
Campos como `requiredAdapters`, `payload`, `rawMessage`, `userMessage`,
`secret`, `token`, `env`, `internal` e `credentials` nunca aparecem na
resposta pública.
O fluxo também emite Adapter Audit Event Contract somente como logs seguros;
eventos auditáveis usam `event_type`, `trace_id`, `confirmation_id`, `domain`,
`intent`, `adapter_id`, `adapter_mode`, `status`, `executed`, `simulated` e
`timestamp`, sem persistência em banco.

```bash
curl -X POST localhost:8080/confirm \
  -H "Content-Type: application/json" \
  -d '{"confirmation_id":"confirm_...","message":"sim"}'
# {
#   "confirmation_id": "confirm_...",
#   "decision": "approved",
#   "status": "received",
#   "confirmation_status": "approved",
#   "execution_status": "simulated",
#   "execution_policy": "not_implemented",
#   "simulated": true,
#   "adapter_id": "mock-financeiro",
#   "adapter_mode": "mock",
#   "executed": false,
#   "message": "Confirmacao recebida; execucao real ainda nao esta habilitada."
# }
```

`GET /confirm/:confirmation_id` consulta o status atual no store em memória e
retorna `pending`, `approved`, `rejected`, `expired` ou `not_found`, sempre com
`executed: false`.

Para operação segura, veja `docs/OPERATOR_RUNBOOK.md`.

## Smoke test end-to-end

O `docker compose` local sobe a API com `HERMES_EXECUTION_ENABLED=true` para
permitir a validação da simulação mock sem execução real. Depois de subir o
stack, rode:

```bash
bash scripts/hermes-smoke-test.sh
```

O script usa `API_BASE_URL=http://localhost:8080` por padrão. Se a API estiver
em outra porta ou host, ajuste `API_BASE_URL`. Sucesso significa que `GET
/health`, `POST /message`, `GET /confirm/:id` e `POST /confirm` passaram sem
expor `requiredAdapters`, payload interno, `rawMessage`, `userMessage` ou
segredos. Falha significa que algum contrato seguro foi quebrado; o script sai
com código diferente de zero.

O mesmo fluxo roda automaticamente em GitHub Actions no workflow
`.github/workflows/hermes-core-smoke.yml`, em `pull_request` e `push` para
`main`. O job faz checkout, instala dependências em
`platform/services/api`, executa `node --check`, `npm test`,
`docker compose config`, sobe a stack local e roda o smoke test antes do
`docker compose down`.

## Permission Matrix e Golden Scenarios

Antes de adicionar um novo domínio, consulte `docs/PERMISSION_MATRIX.md`. Ela
define `can_read_context`, `can_plan`, `can_request_confirmation`,
`can_run_mock_adapter`, `can_execute_real_action`, `requires_confirmation`,
`requires_human_review`, `allowed_adapter_mode` e `risk_level` por domínio.

Antes de criar qualquer adapter real, valide `docs/GOLDEN_SCENARIOS.md` e a
fixture `services/api/test/fixtures/hermes-golden-scenarios.json`. Os cenários
servem como contrato de comportamento e mantêm `executed:false` como regra
obrigatória.

Para novos domínios, use `docs/DOMAIN_ONBOARDING.md` como guia oficial: ele
amarra `mock-first`, `executed:false`, revisão humana e os artefatos de
permissão/cenário antes de qualquer expansão.

Para padrões de tarefa que podem virar contratos futuros, consulte
`docs/SKILL_CANDIDATE_REGISTRY.md`. Skills candidatas continuam em draft,
ligadas a um domínio existente, com mock-first, revisão humana e
`executed:false` obrigatório.

Para memória futura, consulte `docs/MEMORY_POLICY.md`. A política define as
camadas oficiais, thresholds por domínio e campos proibidos, sem implementar
storage real nesta fase.

Para provedores externos futuros, consulte
`docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`. O registry classifica
provider types, candidatos, riscos, bloqueios, OAuth/secrets e revisão de
governança antes de qualquer integração real; ele não chama APIs externas, não
cria adapter real e não autoriza `executed:true`.

Para a fronteira de seguranca de qualquer integracao futura, consulte
`docs/INTEGRATION_SECURITY_BOUNDARY.md`. O boundary define camadas, campos
permitidos/proibidos, regras default e bloqueios antes de provider real,
adapter real, OAuth/secrets ou qualquer chamada externa.

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

