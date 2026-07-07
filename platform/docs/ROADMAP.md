# Hermes AI Platform v2 — ROADMAP

Roadmap evolutivo. Cada fase entra em **PRs pequenas**, com documentação, testes
e reversibilidade. A regra permanente: **não acoplar o core** a ferramentas
específicas.

## Fase 0 — Fundação desacoplada (esta etapa) ✅

- Estrutura de repositório limpa (`platform/`) e documentação fonte da verdade
  (Blueprint, PRD, SPEC, SECURITY, ROADMAP, CLAUDE.md).
- `docker compose up` com `api`, `worker`, `redis`, `postgres`, `qdrant`.
- Núcleo mínimo (health/readiness), sem acoplar ferramentas.
- `POST /message` classifica domain/intent, consulta o capability registry e
  retorna apenas um plano público seguro, sem executar adapters reais.
- Confirmation gate puro indica quando confirmação será necessária antes de
  qualquer execução futura por adapter.

Critério de saída: sobe local com um comando; nada específico acoplado ao core.

## Fase 1 — Contratos e adaptadores

- Definir ports (`DataStore`, `Queue`, `SessionStore`, `VectorMemory`,
  `McpGateway`, `AgentRuntime`, `ModelProvider`).
- Adaptadores: Postgres/Supabase, Redis, Qdrant (implementações injetáveis).
- Composition root; configuração por ambiente.

Critério: trocar uma implementação = trocar um adapter, sem tocar o core.

## Fase 2 — AuthN/AuthZ e Policy Engine

- Autenticação de usuários/serviços; autorização por papel/departamento/loja/
  dado/ação; fluxo completo de aprovação humana para ações sensíveis; auditoria
  com `trace_id`. O confirmation gate inicial já existe como contrato seguro,
  ainda sem execução real.

## Fase 3 — Orquestração

- Ingress/BFF multicanal; Resolver + Executor; caminhos determinísticos e cache
  antes de LLM. Intent Router e Capability Registry já existem como fundação
  planejada, sem execução real; qualquer executor futuro deve respeitar o
  confirmation gate antes de chamar adapters.

## Fase 4 — Memória

- Sessão (Redis) com TTL; memória semântica (Qdrant) para RAG; classificação de
  sensibilidade, expiração e curadoria.

## Fase 5 — MCP Gateway

- Gateway com policy layer, injeção de credenciais, rate limit, redaction e
  auditoria; catálogo de MCPs habilitável por política.

## Fase 6 — Agentes especialistas

- Financeiro, Compras, RH, Marketing, Diretoria, Auditoria como capacidades
  pluggables, com permissões e métricas próprias. Runtimes (MaxClaw/OpenClaw/
  SDKs) atrás da porta `AgentRuntime`.

## Fase 7 — Canais

- WhatsApp (Evolution API), Base44 Apps e API externa reusando os mesmos use
  cases, políticas e auditoria.

## Fase 8 — Deploy 24/7 e operação

- Railway como primeiro ambiente 24/7 (`api` + `worker`), Postgres via Supabase,
  Redis e Qdrant gerenciados; observabilidade, custos e alertas.

## Fase 9 — Escala

- Filas e workers robustos, dead-letter, circuit breakers, read replicas/
  materializações, SLOs por canal, continuidade e resposta a incidentes.
