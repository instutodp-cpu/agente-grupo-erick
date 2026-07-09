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
- Pending confirmation contract público (`id`, `status`, `expires_in_seconds`)
  preparado sem persistência, fila ou execução real.
- Confirmation response contract classifica respostas (`approved`, `rejected`,
  `unknown`) sem executar adapters.
- Store em memória local valida confirmações pendentes/expiradas sem Redis,
  banco ou execução real.
- Adapter execution placeholder planeja execução futura de adapters sem ligar
  qualquer integração real e mantendo `executed: false`.
- Execution policy com kill switch mantém a execução bloqueada por padrão,
  mesmo quando `HERMES_EXECUTION_ENABLED=true`, até que adaptadores reais
  existam.
- Mock adapter harness e registry por domínio só simulam localmente;
  `simulated: true` nunca significa execução real e `adapter_id` segue seguro e
  público.
- Adapter Result Contract padroniza `adapter_id`, `adapter_mode`, `domain`,
  `status`, `simulated`, `executed` e `message`; `executed:false` continua
  obrigatório e campos proibidos são removidos antes de qualquer resposta
  pública.
- Adapter Audit Event Contract padroniza os eventos seguros do fluxo de
  adapter/mock execution; audit events ficam somente em log nesta fase, sem
  persistência em banco e sem campos sensíveis.
- Smoke test end-to-end local (`scripts/hermes-smoke-test.sh`) valida o fluxo
  completo sem curl manual e mantém `executed:false` como regra permanente.
- Workflow de CI (`.github/workflows/hermes-core-smoke.yml`) roda as validações
  e o smoke test automaticamente em `pull_request` e `push` para `main`, sem
  execução real.
- Governance Check Report documenta as checagens de governanca que podem
  bloquear evolucoes sensiveis antes de qualquer scanner real.
- External Integration Provider Registry documenta provider types, candidatos,
  riscos, bloqueios, OAuth/secrets, compliance e review de governanca antes de
  qualquer integracao externa real.
- Integration Security Boundary documenta as camadas de seguranca para qualquer
  integracao futura, bloqueando secrets, raw payload, cross-tenant leakage,
  escrita real e `executed:true`.
- External Provider Permission Overlay cruza provider_id/provider_type com
  dominio, capability, risco e permissoes sem habilitar provider real,
  adapter real, escrita real ou `executed:true`.
- Permission Matrix e Golden Scenarios formalizam o contrato de expansão por
  domínio antes de qualquer adapter real.
- Domain Onboarding Guide formaliza o fluxo oficial para novos domínios como
  estoque, rh, juridico, atendimento, vendas, logistica, agente_pessoal,
  viagens, saude_fitness e apps_projetos.
- Domain Onboarding Preview fica documentado como checklist para uma PR futura
  específica de onboarding de novos domínios.
- Skill Candidate Registry formaliza padrões de tarefa em draft, sempre
  ligados a domínio existente e `executed:false`.
- `docs/SKILL_CANDIDATE_REGISTRY.md` é o contrato oficial para esses padrões
  e não habilita execução real.
- `executed:false` continua obrigatório em qualquer expansão.
- `docs/MEMORY_POLICY.md` formaliza camadas e thresholds de memória sem criar
  storage real, RAG ou segundo cérebro nesta fase.
- Runbook operacional de segurança documenta o fluxo atual, validação manual e
  regras para PRs futuras de adapter.

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
  com `trace_id`. O confirmation gate inicial, a confirmação pendente, a
  resposta de confirmação e o store em memória já existem como base segura,
  ainda sem execução real ou persistência durável.

## Fase 3 — Orquestração

- Ingress/BFF multicanal; Resolver + Executor; caminhos determinísticos e cache
  antes de LLM. Intent Router e Capability Registry já existem como fundação
  planejada, sem execução real; qualquer executor futuro deve respeitar o
  confirmation gate e consumir uma confirmação pendente válida antes de chamar
  adapters. A decisão `approved` em `POST /confirm` atualiza apenas o store em
  memória e ainda não executa nada.

## Fase 4 — Memória

- Sessão (Redis) com TTL; memória semântica (Qdrant) para RAG; classificação de
  sensibilidade, expiração e curadoria.
- `docs/MEMORY_POLICY.md` formaliza a política de memória sem storage real.
- `docs/USER_PEER_MEMORY_SCOPES.md` detalha a camada `user_peer` por papel e
  isolamento.
- `docs/SECOND_BRAIN_INBOX_CONTRACT.md` define o inbox futuro do segundo
  cérebro, sem storage real, RAG real ou execução real.

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

