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
- External Provider Mock Adapter Harness documenta como provedores externos
  futuros devem ser simulados com fixtures seguras antes de qualquer sandbox,
  provider real ou adapter real.
- External Provider Audit, Cost and Rate Limit documenta campos de auditoria,
  riscos de custo/rate limit, budget scopes, fallback policies e stop
  conditions antes de qualquer provider real, rate limiter ou budget tracker.
- Tenant and Workspace Isolation documenta a separacao entre Hermes Pessoal,
  Grupo Erick e clientes externos antes de auth real, storage, RLS, Supabase,
  memoria real, RAG, MCP ou SaaS multiempresa.
- Public Web Data Read-Only Sandbox documenta leitura futura de dados publicos
  da web em modo mock/read-only, sem Firecrawl real, crawler, scraping,
  storage, provider real ou `executed:true`.
- Transcription Intake Sandbox documenta entrada futura de audio, video e
  transcripts sanitizados em modo mock/read-only, sem AssemblyAI/Whisper real,
  upload, processamento, storage, provider real, `real_provider_called:true` ou
  `executed:true`.
- Internal Business API Read-Only documenta consultas futuras de dados internos
  em modo mock/read-only, sem Supabase/Postgres/Base44/ERP real, query real,
  raw SQL, storage, write/action, `real_provider_called:true` ou
  `executed:true`.
- Personal Workspace Connector Policy documenta conectores pessoais futuros em
  modo mock/read-only/draft-only, sem Gmail/Calendar/Drive real, OAuth, token,
  storage, memoria, send/write/delete/share, `real_provider_called:true` ou
  `executed:true`.
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


## Social Media Draft-Only Approval

`docs/SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md` documents the contract-only policy
for future social media draft generation and approval. It keeps all output as
draft content, separates personal, Grupo Erick and external client brand scopes,
and does not implement real social providers, OAuth, tokens, publishing,
scheduling, comments, DMs, media storage, scheduler, adapters or runtime
changes. It keeps `simulated:true`, `executed:false`,
`real_provider_called:false`, `publish_allowed:false` and `send_allowed:false`
mandatory.

## External Client Workspace Connector Policy

`docs/EXTERNAL_CLIENT_WORKSPACE_CONNECTOR_POLICY.md` documents the contract-only
policy for future external client SaaS connectors. It keeps every connector
scoped to `workspace_type=external_client`, `tenant_id=client::<client_id>` and
`client_id`, blocks cross-client access, and does not implement real connectors,
OAuth, tokens, APIs, storage, cache, memory, providers, adapters or runtime
changes. It keeps mock-first, read-only first, human review, governance review,
`simulated:true`, `executed:false`, `real_provider_called:false`, `send_allowed:false` and `publish_allowed:false` mandatory.


## Corporate Workspace Connector Policy

`docs/CORPORATE_WORKSPACE_CONNECTOR_POLICY.md` documents the contract-only
policy for future Grupo Erick corporate connectors. It keeps corporate access
scoped to `workspace_type=corporate`, `tenant_id=grupo_erick` and
`organization_id=grupo_erick`, blocks personal and external-client context,
and does not implement real corporate connectors, OAuth, tokens, APIs, storage,
cache, memory, providers, adapters or runtime changes. It keeps mock-first,
read-only first, human review, governance review, `simulated:true`, `executed:false`, `real_provider_called:false`, `send_allowed:false` and
`publish_allowed:false` mandatory.

## Real Read-Only Adapter Readiness Gate

`docs/REAL_READ_ONLY_ADAPTER_READINESS_GATE.md` documents the first executable readiness gate for future real read-only adapters. This PR creates a deterministic, deny-by-default and fail-closed gate, fixture and tests only. It does not create a real adapter, call a provider, activate an integration, enable a feature flag, add OAuth or secrets, or change `/message` or `/confirm`. `READY` means only eligible for a future integration PR; `executed:false`, `real_provider_called:false` and `can_trigger_real_execution:false` remain mandatory in this PR.

## PR #59 Readiness Gate Delivery

The first real read-only adapter readiness gate is delivered as contract, fixture, pure evaluator and tests in this branch. The next step is a safe adapter interface/runtime boundary with feature flags default off, not unrestricted provider connection.

## PR #60 Read-Only Adapter Interface Delivery

The read-only adapter interface and runtime v1 is delivered as contract,
fixture, isolated registry, pure contract validators, mock-only runtime and
tests in this branch. It defines the safe boundary after readiness evaluation
and permits only local mock/test-double execution. It does not connect
providers, enable real feature flags, call external services or alter
`/message` or `/confirm`.

Next step: Connector Lifecycle and Runtime Registry.

## PR #61 Connector Lifecycle Runtime Registry Delivery

The connector lifecycle/runtime registry is delivered as contract, fixture,
state machine, private in-memory registry, optimistic concurrency and tests in
this branch. It controls lifecycle state and transition history only. It keeps
`mock_only` as the maximum reachable state, blocks canary and
`read_only_active`, requires feature flags default off and kill switches, and
does not call providers or alter `/message` or `/confirm`.

Next step: Real Provider Secrets and Configuration Boundary.

## PR #62 Real Provider Configuration Boundary Delivery

The real provider configuration boundary is delivered as contract, fixture,
pure validators, private in-memory registry and tests in this branch. It
defines secret references, configuration readiness, rotation and expiration
metadata, tenant/workspace policy and sanitized configuration audit candidates
without creating providers, OAuth, secrets, SDKs, external calls, persistent
storage or runtime integration.

Next step: Public Web Read-Only Adapter Pilot readiness/configuration, not
direct or unrestricted provider activation.

## PR #63 Public Web Read-Only Adapter Pilot Foundation

The Public Web Read-Only Adapter Pilot foundation is delivered as adapter,
transport contract, fixture/mock transports, real transport candidate with
injected dependencies, URL/DNS/IP/SSRF/redirect/content policies, content
sanitization, pilot gate, cost/rate metadata, audit candidates and tests. It
does not activate production, does not register the adapter in the main runtime,
does not call providers in CI, keeps feature flag default off and keeps rollout
at 0.

Next step: Public Web Non-Production Canary Activation or Transcription
Sanitized Adapter Pilot, not unrestricted public web integration.

## PR #64 Public Web Non-Production Canary Activation Foundation

The Public Web Non-Production Canary Activation foundation is delivered as
manual session contract, private in-memory session registry, scoped operator
approval, exact target allowlist, safe DNS/HTTPS helpers, explicit runner,
audit sink, post-canary report, fixture and tests. It keeps production blocked,
feature flag default off, rollout 0, no endpoint, no scheduler and no main
runtime integration.

Next step: Public Web Canary Operational Trial or Transcription Sanitized
Adapter Pilot, not production activation.
# Public Web Canary Operational Trial

Após o merge desta PR, marcar como entregue apenas a fundação de `Public Web Canary Operational Trial`. Próxima etapa: executar primeiro trial manual supervisionado ou iniciar `Transcription Sanitized Adapter Pilot`. Não declarar provider ativo, produção pronta ou trial executado apenas pelo merge.
