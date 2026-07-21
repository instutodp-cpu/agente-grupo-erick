# Hermes Agent Core - Foundational Contracts

## Objective

This document defines the official foundation of the Hermes Agent Core: a set of deterministic, immutable, multi-tenant, fail-closed contracts that describe what an agent *is* — identity, metadata, context, lifecycle and declarative capabilities — before any agent can be connected to a model, a tool, memory or a network.

## Architectural View

The Agent Core is deliberately decoupled from the transcription module and from any runtime. It has no dependency on Claude, OpenAI, Gemini or any LLM SDK, no tool execution, no memory, no RAG, no vector database, no database driver, no HTTP/WebSocket/DNS client, no queue, no worker, no scheduler and no webhook. It only defines and validates plain, canonicalizable JavaScript objects. Everything is exact-fields, deny-by-default and simulation-only.

## Threat Model

Every identity, metadata, context, lifecycle, capability and contract object is treated as untrusted input. Free-form string values (`display_name`, `description`, `declared_purpose`, capability `description`, context `metadata`) and object keys are scanned by a shared operational-material detector for anything that looks like a secret, token, password, authorization header, bearer value, endpoint, hostname, IP, port, `process.env` access, dynamic `import(`/`require(`, arrow function, callback, handler, `execute`/`invoke`, `runtime`, `bootstrap`/`startup`, plugin, `tool_call`, prompt/`system_prompt`, model, provider or SDK reference. Detected values are never logged — only a sanitized reason code (e.g. `forbidden_word_value::path`) is returned.

### Avoiding false positives on our own contract fields

Several of the forbidden tokens above (`runtime`, `authorization`) also appear inside legitimate field names this same contract requires (`runtime_enabled`, `authorization_state`). The detector splits key names on non-alphanumeric characters and matches whole segments, not substrings — so `transport_binding_valid`-style collisions (a known trap from the Runtime Registration Boundary) do not happen here for words like `supported_locales` (segments `supported`, `locales`, neither of which is a forbidden token) — and the two remaining exact collisions (`runtime_enabled`, `authorization_state`) are explicitly allowlisted by full key name. The allowlist only silences the *key name* check; the corresponding *value* is still scanned normally.

## Identity

`agent-identity-contract.js` defines the exact-fields identity of an agent: a stable `agent_id`, a normalized `agent_slug`, explicit `agent_version`/`identity_version`, tenant and organization binding, an `agent_type` drawn from a fixed ten-value enum, an owner (`TENANT`/`ORGANIZATION`/`SYSTEM`), a `visibility` that can never be `PUBLIC`, and a `status` that can never represent real execution (`ACTIVE`, `RUNNING`, `EXECUTING`, `PRODUCTION`, `ENABLED`, `LIVE` are all rejected). `organization_id` must be namespaced under `tenant_id` (`tenant_id:...`); a `SYSTEM_AGENT` owned by `SYSTEM` is exempt from this binding since it has no real tenant. `created_at_logical` is a caller-supplied logical marker — the contract code never calls `Date.now()` or `new Date()`.

## Metadata

`agent-metadata-contract.js` defines category (12 allowed values), risk classification (`LOW`/`MODERATE`/`HIGH`/`RESTRICTED` — none of which authorize execution), data classification, and normalized lists (`tags`, `supported_locales`, `compliance_labels`): deterministically sorted, deduplicated, length-bounded, string-only.

## Context

`agent-context-contract.js` defines a purely declarative context with no memory and no execution: a logical `session_reference` (`session_loaded=false`, `session_mutated=false` always) and `conversation_reference` (`history_loaded=false`, `history_mutated=false` always), an `actor_context` (`authorization_state` can never be `APPROVED_REAL`), a `request_context` (`input_loaded=false`, `input_processed=false` always — no real payload is ever retained), a fixed `channel` enum, and a `simulation_context` that forces `simulation=true`, `production_blocked=true` and every capability flag (`runtime_enabled`, `execution_enabled`, `network_enabled`, `tools_enabled`, `memory_enabled`, `llm_enabled`) to `false` with `rollout_percentage=0`.

## Lifecycle

`agent-lifecycle-contract.js` defines five states (`DRAFT`, `VALIDATED`, `REGISTERED_SIMULATION`, `SUSPENDED`, `ARCHIVED`) and a fixed transition table. `transition_allowed` reflects only whether the pair is legal *for simulation*; `transition_applied` is always `false` — no lifecycle record produced by this PR ever actually changes an agent's real state. `evaluateAgentLifecycleTransition` is a pure decision function: same input, same output, no side effects.

## Capabilities

`agent-capability-contract.js` defines fourteen declarative capability types. Every capability in this PR is `declared=true` and forced `enabled=false`, `execution_allowed=false`, `network_required=false`, `tools_required=false`, `memory_required=false`, `llm_required=false`, `simulation=true`, `production_blocked=true`, `rollout_percentage=0`. No capability may require network, tools, memory or an LLM at this stage.

## Aggregate Contract

`agent-core-contract.js` assembles identity, metadata, context, lifecycle and capabilities into one contract, cross-validates tenant/organization/agent-id binding across every sub-object, and computes a `validation_summary` plus a `contract_status` drawn from a fixed six-value enum (`VALIDATED_SIMULATION`, `INVALID`, `POLICY_BLOCKED`, `TENANT_BLOCKED`, `VERSION_BLOCKED`, `DEPENDENCY_BLOCKED`) — `ACTIVE` and `EXECUTABLE` are not members of that enum and can never be produced.

## Response Contract

`agent-response-contract.js` defines a sanitized response: `response_generated=true` but `response_content_present=false` and `response_content_generated=false` always, and `llm_called`, `tool_called`, `memory_read`, `memory_written`, `network_used`, `executed`, `runtime_enabled` are all forced `false`.

## Registry

`agent-registry.js` is a private, in-memory, metadata-only registry (no persistence, no exported mutable state, no functions/classes stored). It supports lookup by `agent_id`, by `agent_slug` scoped to `tenant_id`, and tenant-scoped listing with safe data filters (`agent_type`, `status` — never a predicate function). Registration enforces replay protection (identical resubmission is `REPLAY_ACCEPTED`), payload-mismatch detection (same declared version, different content, is `PAYLOAD_MISMATCH`), and optimistic concurrency (`VERSION_CONFLICT` on a stale `expected_version` or a version downgrade). Every value returned is a canonically re-frozen defensive clone; mutating a returned record throws.

## Fingerprints

`stablePayload`/`stableCanonicalize` (shared from `agent-identity-contract.js`) produce a deterministic, key-sorted JSON string for any contract object. The same input always produces the same fingerprint; any change to the payload changes it. Fingerprints are canonical serializations, not secrets — they are safe to log because every object they cover has already passed the operational-material detector.

## Tenant Isolation

Multi-tenancy is enforced structurally: the aggregate contract requires `identity.tenant_id` to equal `metadata.tenant_id`, `context.tenant_id`, `lifecycle.tenant_id` and every `capability.tenant_id` (mismatches yield `TENANT_BLOCKED`), and the registry never returns or lists a record across tenants.

## Audit

`agent-core-audit.js` records only fingerprints (contract, identity, metadata, context, lifecycle, capabilities), tenant/organization/version bindings, lifecycle state, registry decision, sanitized blockers and a logical sequence number — always with `simulation=true`, `production_blocked=true`, `executed=false`. It never records user input, prompts, textual responses, secrets, tokens, endpoints, code, functions, callbacks, handlers or full payloads, and nothing is persisted.

## Fail-Closed

Every contract in this PR is deny-by-default: exact-fields validation rejects any missing or unexpected key, every enum is a fixed allowlist, every "must never be true" flag is checked explicitly, and any validation failure degrades the object to its safest possible status (`VALIDATION_FAILED` / `INVALID` / `TENANT_BLOCKED`) rather than a silent default.

**Esta implementação define apenas contratos e validações do Hermes Agent Core. Nenhum agente é executado, ativado ou conectado a modelos, ferramentas, memória ou rede.**

## Limitations

There is no LLM integration, no tool execution, no tool registry, no memory, no RAG, no embeddings, no vector database, no Supabase/PostgreSQL access, no filesystem access, no `process.env` access, no HTTP/WebSocket/DNS client, no queue, no worker, no scheduler, no cron, no webhook, no endpoint and no runtime hook. `dynamic import`, `eval`, `Function`, `vm`, `child_process` and `worker_threads` are not used anywhere in these modules. Nothing in this PR is reachable from `/message` or `/confirm`.

## Next Steps

**A próxima etapa arquitetural é o Agent Policy Boundary.**
