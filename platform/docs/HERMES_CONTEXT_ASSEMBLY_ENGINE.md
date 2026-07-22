# Hermes Agent Core - Context Assembly Engine

## Objetivo

This document defines the deterministic context assembly engine of the Hermes Agent Core: it consumes already-validated declarative references (agent contract, policy decision, session, memory contract, memory retrieval, task profile, model selection decision, source references, assembly policy, context budget) and produces a sanitized, immutable, multi-tenant context plan and result, with no real content fetched or generated.

**Esta implementação monta apenas um plano declarativo de contexto. Nenhum conteúdo real, memória, histórico, documento, resultado de ferramenta ou prompt é carregado ou gerado.**

## Referência De Contexto Versus Conteúdo Real

Every input and output of this engine is a *reference* — an id, a fingerprint, a token estimate, a classification, a boolean flag — never the underlying material. `context-assembly-source-reference.js` forces `content_present=false`, `content_loaded=false`, `content_included=false` on every source, structurally, regardless of what the caller supplies. A `SourceReference` never carries a message body, a document body, a memory entry, a tool result payload, or a prompt string. The engine reasons entirely about *whether a reference would be included* in a future assembly, never about the reference's real content.

## Fluxo De Montagem

`context-assembly-engine.js#evaluateContextAssemblyRequest` runs a fixed, ordered pipeline:

1. validate the full `ContextAssemblyRequest` shape (all nested references, exact fields, no operational material)
2. verify tenant/organization/agent/session binding consistency between the agent contract, the sources, and the session reference
3. verify the memory retrieval reference is bound to the same memory contract, agent and session as the rest of the request
4. block `RESTRICTED` classifications outright, and `CONFIDENTIAL` classifications unless `assembly_policy.allow_confidential=true`
5. verify the policy decision reference allows assembly (`policy_status !== DENY`, `allowed_in_simulation=true`)
6. verify the model selection decision reference is in an acceptable status (`NO_LLM_SELECTED_SIMULATION` or `MODEL_SELECTED_SIMULATION`)
7. verify an optional caller-supplied `expected_task_profile_reference_version` still matches
8. detect an irreconcilable conflict between two `required=true` sources sharing a content slot
9. exclude sources the assembly policy does not allow by type or trust level, blocking the whole request when a `required` source is excluded this way and `fail_on_required_source_exclusion=true`
10. verify every policy-required section (`require_policy_reference`, `require_session_reference`, `require_task_reference`, `require_model_selection_reference`) has at least one eligible source
11. group eligible sources by section type, deduplicate by fingerprint, allocate each section's reserved token budget, and build a `ContextAssemblySection` per type
12. sort sections canonically and build the `ContextAssemblyPlan`
13. build the `ContextAssemblyResult`

Any failure at steps 1–10 short-circuits to a specific `BLOCKED` result status — the plan is never built for a blocked request.

## Fontes

`context-assembly-source-reference.js` declares 14 `source_type` values (`SYSTEM_INSTRUCTION_REFERENCE`, `AGENT_IDENTITY_REFERENCE`, `AGENT_METADATA_REFERENCE`, `POLICY_REFERENCE`, `SESSION_REFERENCE`, `CONVERSATION_REFERENCE`, `MEMORY_REFERENCE`, `TASK_REFERENCE`, `USER_INPUT_REFERENCE`, `DOCUMENT_REFERENCE`, `TOOL_RESULT_REFERENCE`, `WORKFLOW_REFERENCE`, `MODEL_SELECTION_REFERENCE`, `AUDIT_REFERENCE`) and 9 `source_origin` values. Each source carries `tenant_id`/`organization_id`/`agent_id`/`session_reference_id` bindings, a `classification`/`risk_classification` pair, a `priority`, `estimated_tokens`/`maximum_tokens`, and `required`/`shareable`/`trusted_reference` flags. A source referencing a different tenant, organization, or a non-shareable different agent/session, blocks the *whole* request rather than being silently dropped.

## Política

`context-assembly-policy.js` declares one `allow_*_reference` flag per source type, `allow_confidential`, `allow_untrusted_reference`, four `require_*_reference` flags, `maximum_sources`/`maximum_sections` ceilings, `deduplicate_sources`, `trim_optional_sources`, and `fail_on_required_source_exclusion`. `allow_cross_session` and `allow_cross_agent` are structurally forced `false` — this PR never assembles context across sessions or agents. `simulation=true` and `production_blocked=true` are forced on every policy.

## Orçamento

`context-assembly-budget.js` declares `maximum_total_tokens` and 12 `reserved_*_tokens` pools, one per section family (system, agent, policy, session, memory, task, user input, document, tool result, workflow, audit, output) — plus an `overflow_strategy`. The 11 non-output reserved pools must sum to at most `maximum_total_tokens`. `MODEL_SELECTION_SECTION` has no dedicated reserved pool in the Context Budget contract — its content is a small reference, never real content, so it shares `reserved_system_tokens` by design; this is called out explicitly as a known limitation below.

## Seções

`context-assembly-section.js` groups sources by section type (14 source types collapse onto 12 section types — `AGENT_IDENTITY_REFERENCE`/`AGENT_METADATA_REFERENCE` both feed `AGENT_SECTION`, `SESSION_REFERENCE`/`CONVERSATION_REFERENCE` both feed `SESSION_SECTION`). Exactly one section is produced per section type present in a request. `included`, `trimmed` and `excluded` are mutually exclusive; `source_count` must equal `source_reference_ids.length`; `exclusion_reason_codes` is required when `excluded=true` and forbidden otherwise.

## Deduplicação

`context-assembly-plan.js#deduplicateSourceReferences` groups sources sharing the same `source_fingerprint` and keeps only the highest-priority one (canonical `source_reference_id` as the tie-break) whenever `assembly_policy.deduplicate_sources=true`. Independently, two or more `required=true` sources that share a `content_reference_id` but declare *different* fingerprints are an irreconcilable conflict — the whole assembly is blocked (`CONFLICT_BLOCKED`) rather than silently picking one.

## Ordenação

`context-assembly-plan.js#compareSections` orders sections by: `required` (required first), `priority` (descending), `section_type` (by its declaration rank in `SECTION_TYPES`), then `section_id` (canonical lexicographic tie-break). `section_id` is derived purely from the section type (`section-<type>`), never from source insertion order or a counter, so the ordering — and every id in it — is fully independent of the order sources appear in the request.

## Overflow

`context-assembly-engine.js#allocateSectionBudget` implements all 4 `overflow_strategy` values declaratively:

- **BLOCK**: excludes every source in the overflowing section; blocks the whole assembly only if a `required` source was among them.
- **DROP_LOWEST_PRIORITY_OPTIONAL**: iteratively drops the lowest-priority non-required sources until the section fits; required sources are never dropped.
- **TRIM_OPTIONAL_REFERENCES**: keeps every source id but caps `allocated_tokens` at the reserved budget, marking the section `trimmed`.
- **REQUIRE_REASSEMBLY**: excludes every source in the section; blocks the whole assembly only if a `required` source was among them.

Independently of strategy, a section whose `required` sources *alone* already exceed the reserved budget always hard-blocks the assembly (`BUDGET_BLOCKED`) — no strategy can silently drop a mandatory source.

## Integração Com NO_LLM

`model_selection_decision_reference.decision_status=NO_LLM_SELECTED_SIMULATION` is accepted exactly like a model selection: the resulting plan and result carry `selected_model_reference_id=null`/`selected_provider_reference_id=null`, and assembly proceeds deterministically on the declarative references alone.

## Integração Com Seleção De Modelo

**O Context Assembly Engine não seleciona modelos. Ele consome apenas uma referência de decisão produzida pelo Model Selection Engine.**

`context-assembly-request.js#validateModelSelectionDecisionReference` accepts a minimal reference (`decision_status`, `decision_value`, `selected_provider_id`, `selected_model_id`, `decision_fingerprint`) validated against the full `DECISION_STATUSES` enum from PR #84's `model-selection-decision.js`, but only `NO_LLM_SELECTED_SIMULATION` and `MODEL_SELECTED_SIMULATION` are acceptable to proceed with assembly — every other status (`POLICY_BLOCKED`, `BUDGET_BLOCKED`, `NO_ELIGIBLE_CANDIDATE`, etc.) blocks the whole assembly (`MODEL_SELECTION_BLOCKED`). No selection is ever repeated, re-evaluated, or looked up automatically.

## Registry

`context-assembly-registry.js` is a private, in-memory, synthetic registry for requests, source references, policies, budgets, sections, plans and results, built on the same replay/payload-mismatch/optimistic-concurrency/fingerprint-conflict/organization-rebinding pattern established in PR #83 and hardened in PR #86. Entities without their own tenant/organization/agent field (policies, budgets, sections, requests) simply do not expose the corresponding `listBy*` filter. Every stored and returned record is defensively cloned and deep-frozen; nothing is persisted.

## Fingerprints

`stablePayload`/`stableCanonicalize` (reused from PR #79) make every fingerprint a deterministic, key-sorted canonical JSON serialization — not a cryptographic hash. Identical input always produces an identical fingerprint; any change to the payload changes it. This backs the registry's replay/conflict detection, the plan's `plan_fingerprint`, and the result's `request_fingerprint`/`policy_fingerprint`/`budget_fingerprint`/`section_fingerprints`/`source_fingerprints`/`model_selection_decision_fingerprint`.

## Isolamento Multi-Tenant

`organization_id` is namespaced as `${tenant_id}:...` and validated at the contract level. A source referencing a different tenant or organization than the agent contract blocks the whole request (`TENANT_BLOCKED`/`ORGANIZATION_BLOCKED`) rather than being silently excluded. The registry independently rejects any attempt to re-register an existing id under a different `tenant_id`/`organization_id` (`TENANT_BLOCKED`/`ORGANIZATION_BLOCKED` at the registry layer).

## Auditoria

`context-assembly-audit.js` records only fingerprints (request, sources, policy, budget, sections, plan, result, model selection decision), tenant/organization bindings, `agent_id`, section/source counts, token estimates, overflow status, decision status, blockers, reason codes and a logical sequence — always with `simulation=true`, `production_blocked=true`, `executed=false`. It never records content, a prompt, a message, history, a document, memory, a response, a secret, an endpoint, or real personal data.

**Nenhum provider ou modelo é chamado, e nenhum token ou custo é consumido nesta implementação.**

## Fail-Closed

Every contract is exact-fields and deny-by-default. `context_assembled`, `content_loaded`, `history_loaded`, `memory_loaded`, `document_loaded`, `tool_result_loaded`, `prompt_generated`, `provider_called`, `model_called`, `network_used`, `tokens_consumed`, `cost_consumed`, `executed` and `runtime_enabled` are forced `false` on every result, regardless of status. `assembly_planned` can only be `true` when `status=ASSEMBLY_PLANNED_SIMULATION`. An invalid request, an unrecognized enum, or any detected operational material degrades the result to `VALIDATION_FAILED`/`BLOCKED` rather than defaulting permissively.

## Limitações

`MODEL_SELECTION_SECTION` has no dedicated reserved token pool in the Context Budget contract and shares `reserved_system_tokens`. There is no OpenAI/Anthropic/Gemini/Ollama/OpenRouter/Groq/Together/Hugging Face SDK or any other real provider client, no HTTP call, no real endpoint, no secret, no API key, no `process.env`, no real tokenization, no real prompt construction, no model execution, no text generation, no streaming, no tool calling, no embeddings, no RAG, no database, no filesystem, no operational cache, no queues, no workers, no cron, no real timers, no executable callback or handler, no `dynamic import`, no `eval`, and no `Function` constructor anywhere in these modules.

## Next Steps

**A próxima etapa arquitetural é o Tool Contract.**
