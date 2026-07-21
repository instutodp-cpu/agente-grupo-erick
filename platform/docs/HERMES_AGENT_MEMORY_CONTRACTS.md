# Hermes Agent Core - Agent Memory Contracts

## Objective

This document defines the declarative memory contracts of the Hermes Agent Core: structures, validation, fingerprints, classifications, references, simulated decisions, a synthetic registry and audit for agent memory — with no real storage, retrieval, RAG, embeddings, vector database, LLM, tool or execution of any kind.

## Sessão, Memória E Histórico

A **session** (PR #81) is a declarative envelope describing who, where, and what logical state a conversation-adjacent interaction is in. A **memory** (this PR) is a declarative envelope describing a reference to something an agent might recall — working context, an episode, a semantic fact, a procedure, a profile trait, or an audit note. **History** (raw messages, transcripts) is neither: it is explicitly out of scope everywhere in this codebase. `conversation_reference` (reused from PR #81) only carries a session pointer and a fingerprint; `memory_item_reference` and `content_reference_id` are opaque identifiers, never the content itself.

**RAG, embeddings, busca vetorial, ranking semântico e persistência permanecem fora desta implementação.**

## Memory Types

Six declarative types: `WORKING_MEMORY_REFERENCE`, `EPISODIC_MEMORY_REFERENCE`, `SEMANTIC_MEMORY_REFERENCE`, `PROCEDURAL_MEMORY_REFERENCE`, `PROFILE_MEMORY_REFERENCE`, `AUDIT_MEMORY_REFERENCE`. No real memory of any type is ever created, loaded, queried or altered by this PR.

## Agent Memory Contract

`agent-memory-contract.js` aggregates identity (`memory_contract_id`, `agent_id`/`agent_version`, `tenant_id`, `organization_id`), a `session_reference` (reused directly from PR #81's `agent-session-reference.js`), a set of `memory_types`, a `memory_scope`, a `policy_reference`, a `retention_policy`, `classification`/`risk_classification`, a `retrieval_policy`, a simulation context and a `contract_status` drawn from an 8-value enum — `ACTIVE`, `ENABLED`, `CONNECTED`, `PERSISTED`, `INDEXED` and `EXECUTABLE` are all rejected outright, since none of them can ever legitimately describe a purely declarative contract. `organization_id` must be namespaced under `tenant_id`. `retention_policy` and `retrieval_policy` are small inline declarative sub-contracts (this PR's file list has no dedicated file for either): `retention_policy` always has `retention_enforced=true` and can never declare `retention_class=PERMANENT_REFERENCE_BLOCKED`; `retrieval_policy` always has `retrieval_allowed=false`, `ranking_allowed=false` and `similarity_allowed=false`.

## Memory Item Contract

`agent-memory-item-contract.js` is the atomic reference: an item id/version, its `memory_type`, tenant/organization/agent binding, a `session_reference_id`, and three more opaque pointers (`subject_reference_id`, `source_reference_id`, `content_reference_id`). `content_present`, `content_loaded`, `content_stored` and `content_indexed` are always `false` — no real text, message, prompt, response, document or personal data is ever stored here, only the fact that a reference to one *could* exist elsewhere. `retention_class` (`EPHEMERAL_REFERENCE`, `SESSION_REFERENCE`, `SHORT_TERM_REFERENCE`, `LONG_TERM_REFERENCE`, `PERMANENT_REFERENCE_BLOCKED`) is purely declarative and never drives a real deletion or persistence job; `PERMANENT_REFERENCE_BLOCKED` is a member of the enum for completeness but is always rejected wherever it's checked. `importance_level=CRITICAL_REFERENCE` requires the accompanying policy reference to explicitly flag `approval_required=true` — and even then, never authorizes persistence.

## Memory Scope

Deny-by-default, identical in spirit to PR #80/#81's scopes: `allowed_agent_ids`, `allowed_session_reference_ids`, `allowed_actor_roles`, `allowed_memory_types` and `allowed_classifications` are all sorted, deduplicated, wildcard- and regex-free arrays — an empty array matches nothing. `cross_tenant_allowed` and `cross_organization_allowed` are always `false`. `shared_between_agents` and `shared_between_sessions` are explicit booleans (never inferred) declaring sharing intent, but sharing itself is never executed in this PR (`SHARE_MEMORY_REFERENCE` is always blocked — see below).

## Classification

Reuses PR #79's `PUBLIC`/`INTERNAL`/`CONFIDENTIAL`/`RESTRICTED` enum exactly. `RESTRICTED` is always blocked in this PR (`CLASSIFICATION_BLOCKED`). `CONFIDENTIAL` requires an explicit policy: because scope matching requires `memory_scope.allowed_classifications` to *explicitly* list the classification being requested, a `CONFIDENTIAL` request against a scope that only allows `INTERNAL` is naturally `SCOPE_BLOCKED` rather than silently passing through — there is no implicit or wildcard allowance possible. Detected secret material anywhere in a request is `CLASSIFICATION_BLOCKED` too (the shared operational-material detector runs inside every sub-contract's own validator, so a request carrying anything secret-shaped fails request validation before a decision is even attempted). No real content ever appears in a decision or an audit record — only fingerprints and classification labels.

## Retention

Purely declarative, purely sequence-based. `PERMANENT_REFERENCE_BLOCKED` can never be permitted. No clock is used anywhere in these modules; retention math (where it exists, e.g. sequence-window checks in the aggregate contract's `retention_policy`) is bounded-integer comparison only.

## Memory Policy Reference

Reused shape across the session and the request (`agent-memory-policy-reference.js`), pointing at a Policy Boundary (PR #80) decision by id and fingerprint only. `memory_read_allowed`, `memory_write_allowed`, `memory_delete_allowed` and `memory_share_allowed` are always `false` in this PR — **even a permitted policy never authorizes a real operation.**

## Retrieval Reference

`agent-memory-retrieval-reference.js` declares an intent to retrieve, never an execution: `query_present=false`, `query_loaded=false` (no query text is ever stored), `retrieval_requested=true` but `retrieval_executed=false`, `results_loaded=false`, `result_count_reference=0`, `ranking_executed=false`, `similarity_executed=false`. A `RETRIEVE_MEMORY_REFERENCE` request always resolves to `RETRIEVAL_REFERENCE_VALIDATED`, never to an actual search.

## Memory Request And Decision

`agent-memory-request.js` defines 9 request types. `agent-memory-decision.js` hosts both the decision contract *and* the evaluator (`evaluateAgentMemoryRequest`) — this PR has no separate boundary file, matching its file list exactly. `UPDATE_MEMORY_REFERENCE`, `DELETE_MEMORY_REFERENCE` and `SHARE_MEMORY_REFERENCE` always resolve to `status=DENY`, `decision=BLOCKED`, regardless of any other input — those operations are reserved for a future PR. Every other request type is evaluated against an explicitly injected `memory_scope` and, for anything but `REGISTER_MEMORY_REFERENCE`, an explicitly injected `current_memory` fact set (id, version, fingerprint, agent/tenant/organization binding) — **the evaluator never looks up the memory contract, the memory item, or a policy decision on its own.** Every invariant field (`memory_registered`, `memory_loaded`, `memory_read`, `memory_written`, `memory_updated`, `memory_deleted`, `memory_shared`, `retrieval_executed`, `ranking_executed`, `similarity_executed`, `embedding_generated`, `vector_store_used`, `llm_called`, `tool_called`, `network_used`, `runtime_mutated`, `executed`, `runtime_enabled`) is forced `false`; `simulation=true`, `production_blocked=true`, `rollout_percentage=0` always.

## Registry

`agent-memory-registry.js` is a private, in-memory, metadata-only registry keyed by `memory_item_id` (no persistence, no content, no message, no prompt, no response, no document, no embedding, no vector, no secret, no endpoint, no function/callback/handler, no real payload). It supports lookup by id and by tenant+id, tenant-scoped listing filtered by organization/agent/session reference/memory type/classification, replay protection, payload-mismatch detection, optimistic concurrency (`expected_version`) and an independent fingerprint check (`expected_fingerprint`), plus `ITEM_CONFLICT` when a `memory_item_id` is reused for a different `agent_id` and `TENANT_BLOCKED`/`ORGANIZATION_BLOCKED` on an attempted reassignment.

## Fingerprints

`stablePayload`/`stableCanonicalize` (reused from PR #79) make every fingerprint deterministic and payload-sensitive — the same request evaluated twice produces an identical `decision_fingerprint`; changing anything changes it. This backs both the registry's conflict detection and the decision's own reproducibility.

## Isolamento Multi-Tenant

Every request is checked against an explicitly injected `memory_scope` whose own `tenant_id`/`organization_id` must match before anything else is evaluated. The registry never lists or returns an item across tenants, and an attempted tenant or organization reassignment of an existing item is rejected outright.

## Auditoria

`agent-memory-audit.js` records only fingerprints (contract, item, request, retrieval, policy decision), tenant/organization bindings, `agent_id`, the session reference id, memory type, classification, retention class, decision status, blockers and reason codes — always with `simulation=true`, `production_blocked=true`, `executed=false`. It never records real content of any kind. Nothing is persisted.

## Fail-Closed

Every contract is exact-fields and deny-by-default: an empty scope grants nothing, an unlisted classification blocks, `RESTRICTED` and `PERMANENT_REFERENCE_BLOCKED` are hard-denied before anything else is consulted, and any validation failure degrades the decision to its safest status rather than a silent default.

**Esta implementação define apenas contratos e referências declarativas de memória. Nenhuma memória real é criada, armazenada, carregada, pesquisada, atualizada, removida ou compartilhada.**

## Limitações

There is no Supabase, PostgreSQL, Redis, filesystem, vector database, embeddings, RAG, real semantic search, real storage or real retrieval, no OpenAI/Claude/Gemini/any LLM, no model provider, no tool calling, no workflow, no HTTP, no endpoints, no queues/workers/cron/timers, no `process.env`, no `dynamic import`/`eval`/`Function`, and no executable callbacks or handlers anywhere in these modules.

## Next Steps

**A próxima etapa arquitetural é o Model Provider Contract.**
