# Hermes Agent Core - Agent Policy Boundary

## Objective

This document defines the central policy boundary of the Hermes Agent Core: a deterministic, immutable, multi-tenant, fail-closed evaluator that decides, in simulation only, whether a declarative request involving an agent would be permitted by policy.

## Architectural View

The Policy Boundary sits conceptually after the Agent Core Contracts (PR #79) and before any future execution surface. It consumes the same identity/metadata/context/lifecycle/capability contracts by reference — never by re-deriving them, never by looking them up on its own. The caller (who already holds the full agent contract, e.g. from `agent-registry.js`) must inject the minimal validated facts explicitly. The boundary itself never queries `agent-registry.js`. This keeps policy evaluation testable, replayable and side-effect-free.

## Threat Model

Policy requests, policies, and rules are untrusted input. Every scope, budget, limit and rule contract is exact-fields and deny-by-default: an empty scope array never means unrestricted access, there is no wildcard token, no regex, and no executable operand. The shared operational-material detector (extended from PR #79's `agent-identity-contract.js`) rejects secrets, tokens, endpoints, callbacks, handlers, prompts, model/provider/SDK references and executable-shaped code anywhere in a policy, rule or request.

## Deny-By-Default

Absence of an applicable policy is `POLICY_BLOCKED` / `DENY` — not a silent allow. A policy whose scope doesn't fully match the request (subject, resource, action, risk, data and channel all evaluated) is not applicable. `RESTRICTED` risk and `RESTRICTED` data are hard-denied before any policy is even consulted.

## Effect Precedence

When multiple policies apply:

1. `DENY` prevails over everything.
2. `REQUIRE_APPROVAL_SIMULATION` prevails over `ALLOW_SIMULATION`.
3. Absence of an applicable policy results in `DENY`.
4. A structural scope conflict results in `DENY`.
5. An incompatible policy version results in `DENY`.

Priority is an explicit, bounded integer used only to select which matched policy's budget/limit policy governs the decision (the highest-priority matched policy) — it can never let a lower-severity effect override a `DENY`. Two policies sharing the same `policy_id` with different content among the matched set is a `CONFLICT_BLOCKED` decision, not a silent pick.

`HIGH` risk can never resolve to plain `ALLOW_SIMULATION` — it is always upgraded to at least `REQUIRE_APPROVAL_SIMULATION`, even if a matched policy said `ALLOW_SIMULATION`.

## Policy Contract

`agent-policy-contract.js` defines the full policy: type (11 values), status (4 values — never `ACTIVE`/`ENABLED`/`LIVE`/`PRODUCTION`/`EXECUTING`), a bounded explicit `priority`, an `effect` (`DENY` / `ALLOW_SIMULATION` / `REQUIRE_APPROVAL_SIMULATION` — no effect ever authorizes real execution), six scopes, a budget policy, a limit policy, an approval policy, and ordered/deduplicated rule and dependency references. `organization_id` must be namespaced under `tenant_id` (`tenant_id:...`), relaxed only for a `SYSTEM_POLICY` whose `tenant_id` is the literal `SYSTEM` sentinel.

## Rule Contract

`agent-policy-rule-contract.js` defines 22 rule types and 11 fixed operators (`EQUALS`, `IN`, `LESS_THAN`, `BOOLEAN_IS`, `VERSION_COMPATIBLE`, …). Operand references are validated as purely symbolic, uppercase dot-paths (e.g. `REQUEST.TENANT_ID`) — never a real expression, regex or function. `evaluateAgentPolicyRule` applies a fixed operator to two values the *boundary* resolves and compares the result against `expected_result`; there is no `eval`, no dynamic `Function`, no regex engine. In this PR the boundary uses rules concretely for `SIMULATION_REQUIRED` and `PRODUCTION_BLOCKED_REQUIRED` checks against the request's own simulation context; the primary allow/deny path is driven by the six deterministic scope comparisons, with matched rules recorded for audit.

## Request Contract

`agent-policy-request.js` defines the request, including an `agent_contract_reference` that carries only fingerprints and a couple of small facts (`lifecycle_state`, `contract_status`) — never the full agent contract. `capability_reference`, `resource_reference` and `approval_context` are similarly reference-only, with `enabled`, `execution_allowed`, `resource_loaded`, `resource_mutated`, `approval_granted` and `approval_applied` all forced `false`.

## Subject / Resource / Action / Risk / Data / Channel Scope

`agent-policy-scope.js` normalizes and validates all six scopes: arrays are sorted, deduplicated, wildcard- and regex-free, and length-bounded. An empty scope array is valid but matches nothing (deny-by-default) — `matchesSubjectScope` and `matchesChannelScope` require every dimension to explicitly list the request's value. `resource_ids` and `resource_domains` are the one exception: an empty list means "not narrowed by id/domain," since resource references are open-ended and cannot be pre-enumerated the way tenants and actors can; this is a deliberate, documented relaxation. Risk and data classifications reuse the exact `LOW/MODERATE/HIGH/RESTRICTED` and `PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED` enums from PR #79's metadata contract. `DataScope`'s four presence flags (`restricted_fields_present`, `personal_data_present`, `sensitive_data_present`, `secret_material_present`) are safety assertions on the *scope object itself* — always required `false`, exactly like `session_loaded=false` elsewhere in this codebase — not a description of the live request.

## Approval Policy

`approval_required`, `approval_type` (6 values) and `required_roles` are declarative. `approval_granted` and `approval_applied` are always `false` in this PR — even when a decision's effect is `REQUIRE_APPROVAL_SIMULATION`, no approval is ever recorded as granted or applied.

## Budget Policy

`agent-policy-budget.js` prepares — but does not implement — request-level, tenant-level, organization-level, agent-level and workflow-level cost control, and future economical model selection and controlled escalation. `maximum_model_calls`, `maximum_tool_calls`, `maximum_memory_reads`, `maximum_memory_writes`, `maximum_network_calls` and `maximum_escalations` are forced to `0` in this PR — nothing beyond a declarative cost/token ceiling exists yet. `budget_enforced=true` and `budget_consumed=false` always; no budget is ever actually consumed. Currency uses an explicit ISO-4217-shaped code and minor units (integers) — never floating point.

## Limit Policy

`agent-policy-limits.js` declares request/concurrency/duration/payload/reference/evaluation ceilings. Duration is a declared integer millisecond ceiling only — no timer is ever created, and the contract code never calls `Date.now()` or `new Date()`. `limit_enforced=true` and `limit_consumed=false` always.

## Policy Registry

`agent-policy-registry.js` is a private, in-memory, metadata-only registry for policies and rules (no persistence, no exported mutable state, no functions/classes/callbacks/handlers stored). It never accesses the Agent Registry (PR #79) automatically. Registration enforces replay protection, payload-mismatch detection, and optimistic concurrency, identically to the pattern established by `agent-registry.js`. A rule that references an unregistered `policy_id` is rejected as `POLICY_CONFLICT`, never silently linked.

## Decision

`agent-policy-decision.js` defines the outcome: 17 possible statuses, all fixed. `policy_evaluated=true` always; `capability_activated`, `agent_executed`, `llm_called`, `tool_called`, `memory_read`, `memory_written`, `network_used`, `runtime_mutated`, `budget_consumed`, `limit_consumed`, `executed` and `runtime_enabled` are all forced `false`. `allowed_in_simulation=true` only when status and effect both equal `ALLOW_SIMULATION` and every gate (tenant, organization, capability, lifecycle, channel, risk, data, budget, limit, simulation) passed.

**Uma decisão ALLOW_SIMULATION não representa autorização para execução real.**

## Fingerprints And Replay Protection

`stablePayload`/`stableCanonicalize` (reused from PR #79) produce the same deterministic, key-sorted JSON string for the same input every time, and a different one whenever the payload changes. Policies and rules registered with identical content are `REPLAY_ACCEPTED`; identical `policy_id`/`rule_id` with different content is `PAYLOAD_MISMATCH`; a stale or downgraded version is `VERSION_CONFLICT`.

## Tenant And Organization Isolation

A policy only becomes eligible for evaluation when its `tenant_id` exactly matches the request's `tenant_id`. The registry never lists or returns a policy across tenants. `organization_id` must be namespaced under `tenant_id`, checked both on the policy and (indirectly, via the actor context) on the request.

## Audit

`agent-policy-audit.js` records only fingerprints (request, decision, agent contract, matched policies, evaluated rules), tenant/organization bindings, actor type/role, the capability reference, requested action, channel, risk/data classification, and boolean-only budget/limit summaries (never a real amount) — always with `simulation=true`, `production_blocked=true`, `executed=false`. It never records user payload, request text, prompts, responses, documents, unnecessary personal data, secrets, tokens, credentials, endpoints, URLs, hostnames, code, functions, callbacks, handlers, or the full contract/policy/rule objects. Nothing is persisted.

## Reason Codes

Every blocker and reason code is a short, sanitized, machine-readable string (e.g. `budget_cost_exceeded`, `risk_restricted_always_denied`, `policy_conflict::policy_x`) — never the raw value that triggered it.

## Detecção De Material Operacional

The detector (shared with PR #79) works in three layers:

1. **By key** — an object key is split on any non-alphanumeric character into segments; if any whole segment exactly matches a forbidden token (`secret`, `token`, `endpoint`, `runtime`, `model`, …), the key is rejected. This avoids the classic substring trap (`transport` no longer matches `port`) while still catching real hazards. A small, explicit allowlist (`runtime_enabled`, `runtime_mutated`, `secret_material_present`, `maximum_model_calls`, `requested_model_calls`, `model_calls_within_limit`, `authorization_state`) exempts this contract's own legitimate field names.
2. **By value** — string leaves are checked against a word-boundary pattern for the same forbidden vocabulary, plus shape-based checks for URLs, IPs, host:port pairs, connection strings, `process.env`, dynamic `import(`/`require(`, arrow functions and executable file extensions.
3. **By context** — validators call the detector on exactly the sub-object that can carry free text (a policy, a request, a rule, a scope) rather than the whole tree indiscriminately, so a legitimate kebab-case fixture slug like `finance-require-approval-policy` is never flagged (the bare English words `require`/`import` were deliberately removed from the key-token list once this exact collision was found in testing; the call-shaped `require(`/`import(` detection still exists at the value layer).

Detected values are never logged — only a sanitized reason code is returned.

## Limitations

**Esta implementação avalia apenas políticas declarativas em modo de simulação. Nenhum agente, capability, modelo, ferramenta, memória, workflow ou recurso externo é executado ou ativado.**

There is no OpenAI/Claude/Gemini/any-LLM SDK, no real model selection or catalog, no real provider, no prompts, no tool calling or execution, no memory, no RAG, no embeddings, no vector database, no Supabase/PostgreSQL/Redis, no filesystem or `process.env` access, no HTTP/WebSocket/DNS, no queues/workers/cron/scheduler/webhooks, no endpoints, no real authentication or external authorization, no real billing or balance consumption, and no `dynamic import`/`eval`/`Function`/`vm`/`child_process`/`worker_threads`.

**A estrutura de orçamento prepara o Hermes para selecionar futuramente modelos gratuitos, locais, econômicos ou avançados de acordo com custo, complexidade, risco e disponibilidade, mas nenhum modelo é selecionado nesta implementação.**

## Next Steps

**A próxima etapa arquitetural é o Agent Session Boundary.**
