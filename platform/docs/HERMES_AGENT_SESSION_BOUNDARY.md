# Hermes Agent Core - Agent Session Boundary

## Objective

This document defines the declarative session boundary of the Hermes Agent Core: a deterministic, immutable, fail-closed evaluator that validates, normalizes and produces simulated decisions about agent sessions, with strict tenant and organization isolation.

## Architecture

The Session Boundary sits alongside the Agent Policy Boundary (PR #80), both built on the Agent Core Contracts (PR #79). It never creates an operational session, never persists history, never loads a conversation, never accesses memory, never executes an agent and never calls a model. It only defines contracts — identity, state, transitions, references, expiration, registry and audit — and evaluates requests against them in memory.

## Sessão Não É Memória

**Uma sessão não representa memória. Histórico, mensagens, memória curta, memória longa e RAG permanecem fora desta implementação.**

A session is a declarative envelope: who (agent, actor), where (tenant, organization, channel), what kind (session type), and what state it is logically in. `conversation_reference` only carries a *count* and a *fingerprint* of a conversation that might exist elsewhere — never the conversation itself. This distinction matters architecturally: the Agent Memory Contract (next PR) is a separate concern from session lifecycle.

## Session Contract

`agent-session-contract.js` defines the full session: identity (`session_id`, `session_version`, `session_fingerprint`), binding (`agent_id`/`agent_version`, `tenant_id`, `organization_id`, `actor_id`/`actor_type`/`actor_role`, `channel`), a `session_type` (7 reference-only values — no real workflow or task is ever started), a `session_status` (7 values — `ACTIVE`, `RUNNING`, `EXECUTING`, `LIVE`, `CONNECTED`, `STREAMING` and `PRODUCTION` are all rejected), a session scope, a conversation reference, a policy reference, sequence counters, an expiration policy, a simulation context and metadata. `organization_id` must be namespaced under `tenant_id` (`tenant_id:...`), and a session whose `risk_classification` is `RESTRICTED` can never be `OPEN_SIMULATION`.

## Session Request

`agent-session-request.js` defines 8 request types (`CREATE_SESSION_REFERENCE`, `VALIDATE_SESSION_REFERENCE`, `TRANSITION_SESSION_REFERENCE`, `READ_SESSION_REFERENCE`, `LIST_SESSION_REFERENCES`, `EVALUATE_EXPIRATION_REFERENCE`, `CLOSE_SESSION_REFERENCE`, `ARCHIVE_SESSION_REFERENCE`). None of them can cause a real operation. The request's `session_reference` is a fingerprint-only pointer (`session_present=false` for `CREATE_SESSION_REFERENCE`, `true` for every other type); its `agent_contract_reference` similarly carries only fingerprints and a couple of small facts (`contract_status`, `lifecycle_state`) — never the full Agent Core contract. **The boundary never fetches the session, the agent contract, or a policy decision on its own — every fact it needs is injected explicitly by the caller.**

## Session State

`agent-session-state.js` is a declarative snapshot of a session's status at a point in time. `state_mutated`, `runtime_connected`, `history_loaded`, `memory_loaded` and `agent_executed` are always `false`.

## Session Transitions

`agent-session-transition.js` defines 8 transition types and exactly 12 allowed `(from_status, transition_type) -> to_status` pairs — every other combination is blocked. `transition_allowed` reflects only whether the pair is legal *for simulation*; `transition_applied` is always `false`. `CREATE` is a special zero-prior-state transition (`DRAFT -> DRAFT`) representing the declaration of a brand-new session reference, not a real state change.

## Session Reference, Conversation Reference, Policy Reference

`agent-session-reference.js` hosts four small reference-only structs: the request's `session_reference` and `agent_contract_reference` (both fingerprint-only), the session's own `conversation_reference` (`history_loaded=false`, `history_mutated=false`; `message_count_reference` is a declarative non-negative integer, never a real message), and `policy_reference` (reused identically by both the session contract and the session request) — which carries a Policy Boundary (PR #80) decision's status and fingerprint, never the full decision. `policy_evaluated` must be `true`; `allowed_in_simulation=true` only reflects a permitted simulation, never a real authorization. A pending approval (`approval_required=true`) always blocks the `OPEN_SIMULATION` transition, regardless of anything else.

## Session Scope

`session_scope` is deny-by-default: every one of `allowed_agent_ids`, `allowed_actor_ids`, `allowed_actor_roles`, `allowed_channels` and `allowed_session_types` must explicitly list the request's corresponding value — an empty list matches nothing. There is no wildcard token and no regex. `cross_tenant_allowed` and `cross_organization_allowed` are always `false` in this PR.

## Logical Expiration

**A expiração é avaliada apenas por sequências lógicas determinísticas. Nenhum relógio, timer ou scheduler é utilizado.**

`agent-session-expiration.js` never calls `Date.now()`, never constructs `new Date()`, and never creates a timer. Expiration is computed purely from three integer sequence numbers the caller supplies (`created_sequence`, `last_activity_sequence`, `current_sequence`) compared against a declared policy (`INACTIVITY_SEQUENCE`, `TOTAL_SEQUENCE`, `EARLIEST_SEQUENCE_LIMIT`, or `NONE`). An inconsistent sequence (e.g. `current_sequence` behind `last_activity_sequence`) is rejected rather than silently treated as expired or not. `expired_logically` may be `true`, but no transition is ever applied as a side effect of evaluating it — a separate `EXPIRE_LOGICAL` transition request would be required, and even that only ever produces `transition_applied=false`.

## Session Registry

`agent-session-registry.js` is a private, in-memory, metadata-only registry (no persistence, no history, no messages, no memory, no exported mutable state, no functions/callbacks/handlers stored). It never queries the Agent Registry (PR #79) or the Policy Boundary (PR #80) automatically. Registration enforces replay protection, payload-mismatch detection, optimistic concurrency (`expected_version`) and an independent fingerprint check (`expected_fingerprint`, yielding `FINGERPRINT_CONFLICT` when it doesn't match) — plus `SESSION_CONFLICT` when a `session_id` is reused for a different `agent_id`, and `TENANT_BLOCKED`/`ORGANIZATION_BLOCKED` if a caller attempts to reassign a session's tenant or organization.

## Decision

`agent-session-decision.js` defines 17 statuses and 9 decision values. `session_created`, `session_loaded`, `session_mutated`, `history_loaded`, `history_mutated`, `memory_read`, `memory_written`, `agent_executed`, `llm_called`, `tool_called`, `network_used`, `runtime_connected`, `executed` and `runtime_enabled` are all forced `false`; `transition_applied` is always `false`. `allowed_in_simulation=true` only when the contract, tenant, organization, agent, actor, role, channel, scope and policy are all valid, no approval is pending, versions and fingerprints match, and the requested transition is permitted — and even then, nothing is actually created or changed.

## Fingerprints And Replay Protection

`stablePayload`/`stableCanonicalize` (reused from PR #79) make every fingerprint deterministic: the same request evaluated twice against the same context produces an identical `decision_fingerprint`; changing any part of the payload changes it. This is what backs the registry's replay/mismatch/conflict detection.

## Tenant Isolation And Organization Isolation

Every request is checked against an explicitly injected `session_scope` whose own `tenant_id`/`organization_id` must match the request's before anything else is evaluated — a request from a different tenant or organization is `TENANT_BLOCKED` / `ORGANIZATION_BLOCKED` immediately. The registry never lists or returns a session across tenants, and reassigning an existing session's tenant or organization is rejected outright.

## Audit

`agent-session-audit.js` records only fingerprints (request, session, state, transition, expiration, policy decision, agent contract), tenant/organization bindings, `agent_id`, actor type/role, channel, session type, previous/proposed status, decision status, blockers and reason codes — always with `simulation=true`, `production_blocked=true`, `executed=false`. It never records messages, history, prompts, responses, conversation content, user content, documents, secrets, tokens, credentials, URLs, endpoints, IPs, hostnames, a full user agent string, code, functions, callbacks, handlers, or the full session/policy/contract objects. Nothing is persisted.

## Fail-Closed

Every contract is exact-fields and deny-by-default. Absence of an applicable scope entry blocks; an unlisted transition blocks; a version or fingerprint mismatch blocks; a pending approval blocks opening; any validation failure degrades the decision to its safest status (`VALIDATION_FAILED` or a specific `*_BLOCKED`) rather than a silent default.

**Esta implementação define e avalia apenas referências declarativas de sessão. Nenhuma sessão real é criada, carregada, alterada, persistida ou conectada ao runtime.**

## Material Operacional Proibido

The detector (shared with PR #79/#80) was extended for this PR with `jwt`, `oauth`, `cookie` and `filesystem` as forbidden key/value tokens, plus shape-based checks for `private key`/`access key` phrasing — matching the wider surface a session boundary touches (client/device references, correlation identifiers). As in PR #80, a small allowlist (`runtime_connected`, alongside the previously-added `runtime_enabled`, `runtime_mutated`, `secret_material_present`, `maximum_model_calls`, `requested_model_calls`, `model_calls_within_limit`, `authorization_state`) exempts this codebase's own legitimate field names from the key-level check; the value-level check is untouched by the allowlist. `client_reference` and `device_reference` are synthetic identifiers by contract — the shape validators never accept a raw user-agent string or an IP address in their place, only opaque reference strings.

## Limitations

There is no database, no Supabase/PostgreSQL/Redis, no filesystem, no cookies/localStorage/sessionStorage, no operational cache, no memory, no RAG, no embeddings, no vector database, no LLM of any kind, no real model, no tool calling, no workflows, no HTTP/WebSocket, no endpoints, no real authentication, no real tokens/JWT/refresh tokens/OAuth, no queues/workers/cron, no real timers (`setTimeout`/`setInterval` are not used anywhere in these modules), no `process.env`, no `dynamic import`/`eval`/`Function`, and no executable callbacks or handlers.

## Next Steps

**A próxima etapa arquitetural é o Agent Memory Contract.**
