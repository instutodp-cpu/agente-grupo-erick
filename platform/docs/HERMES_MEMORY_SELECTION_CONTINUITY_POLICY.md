# Hermes Agent Core - Memory Selection and Continuity Policy

## Objetivo

This document defines the Hermes Memory Selection and Continuity Policy: a declarative engine (`memory-selection-engine.js`) that classifies, preserves, deduplicates, budgets, and canonically orders **references** to user preferences, project state, continuity summaries, pending tasks, applicable decisions, and memories — never their content.

**Esta implementação seleciona apenas referências declarativas. Nenhuma memória ou preferência é carregada, lida ou enviada a um modelo.**

## Armazenar, recuperar e enviar memória: três operações distintas

This PR touches none of the first two and only prepares the shape of the third:

- **Armazenar** (store) — writing memory content somewhere durable. Out of scope for every PR in the Hermes Agent Core to date, including this one.
- **Recuperar** (retrieve) — reading memory content back out of storage, or performing semantic search over it (RAG, embeddings, vector search). `agent-memory-retrieval-reference.js` (PR #82) models the *reference* to a retrieval, not retrieval itself, and this PR does not perform retrieval either.
- **Enviar** (send) — deciding which of the *already-referenced* items are worth including in a future prompt/context assembly, under a token budget, and in what order. This is exactly what `memory-selection-engine.js` decides — declaratively, over references, with `content_present=false` and `content_loaded=false` enforced everywhere.

## Princípio: "lembrar mais do que enviar"

Hermes is designed to track (reference) substantially more memory than any single interaction could ever afford to include. The selection policy's job is not to decide what to forget — nothing is ever deleted or marked unavailable by this PR — but to decide, for one specific request, which subset of everything already tracked is worth spending token budget on right now. Everything not selected remains referenced and eligible for a future request.

**Economia de tokens não autoriza esquecimento silencioso de preferências, restrições, estado do projeto, continuidade ou memórias obrigatórias.** This is enforced structurally, not just documented: `memory-selection-engine.js` treats REQUIRED-class items and explicitly declared preferences as protected — they are never candidates for budget-driven exclusion. If a protected item cannot fit even after every non-protected item has been dropped, the engine blocks the entire request (`REQUIRED_MEMORY_BLOCKED`/`BUDGET_BLOCKED`) rather than silently omitting it.

## Classes: REQUIRED, RELEVANT, OPTIONAL

Every `MemorySelectionItemReference` carries one `item_class`:

- **REQUIRED** — never a candidate for budget-driven exclusion. Includes safety restrictions, explicitly required preferences, and any pending task or applicable decision the caller has flagged as `required=true` (the contract requires `required=true` to imply `item_class=REQUIRED`, so there is exactly one way to mark something non-droppable).
- **RELEVANT** — droppable only when `selection_policy.allow_relevant_omission=true` *and* `selection_budget.overflow_strategy` is one of `DROP_LOWEST_PRIORITY_RELEVANT`, `REQUIRE_HIERARCHICAL_SUMMARY`, or `REQUIRE_REASSEMBLY`. Under `BLOCK`/`DROP_OPTIONAL`, RELEVANT overflow always blocks instead.
- **OPTIONAL** — the first and cheapest thing dropped for budget economy, gated only by `selection_policy.allow_optional_omission`.

Regardless of class, an item with `omission_risk` of `HIGH` or `CRITICAL` can never be silently dropped: the engine blocks the request (`BUDGET_BLOCKED`) instead of excluding it.

## Preferências explícitas

`isExplicitPreference(item)` — `explicitly_declared=true` and `confidence_level` in `EXPLICIT`/`CONFIRMED` — is a **second**, independent protection path alongside `item_class=REQUIRED`. An explicit preference is always preserved even if its `item_class` is `RELEVANT`, because a user directly stating a preference is stronger evidence than any priority/score heuristic could produce.

## Estado do projeto, continuidade, tarefas e decisões aplicáveis

`ProjectStateReference` and `ContinuitySummaryReference` are separate, minimal contracts (not `MemorySelectionItemReference`) — both fix `required=true`, `content_present=false`, `content_loaded=false` at the contract level, so they are always preserved by construction, never subject to the budget-drop cascade. Pending tasks and applicable project decisions are modeled as ordinary `MemorySelectionItemReference` items (`PENDING_TASK_REFERENCE`/`PROJECT_DECISION_REFERENCE`) — when a caller marks one `required=true`, it inherits the same REQUIRED-class protection as everything else; nothing separate needed to be invented for these two categories.

## Supersessão e conflitos

`superseded=true` items are excluded from selection unconditionally, before classification or scoring ever runs — a superseded item cannot be "relevant enough" to survive. `conflicted=true` items **block the entire request** (`CONFLICT_BLOCKED`) unless `conflict_resolution_reference_id` is a non-empty string declaring how the conflict was resolved; an unresolved conflict is never silently dropped or silently included. Both superseded and conflicted exclusion happen in canonical (`item_reference_id`-sorted) order, so the outcome never depends on the order items arrived in the request.

`confidence_level=UNKNOWN_BLOCKED` behaves the same way as an unresolved conflict: it always blocks the request (`VALIDATION_FAILED`) rather than being scored as low-confidence and quietly excluded.

## Orçamento protegido e overflow

`SelectionBudget` reserves separate token pools for preferences, project state, continuity, REQUIRED memory, RELEVANT memory, OPTIONAL memory, and model output. The four reservations backing protected categories (`reserved_preference_tokens`, `reserved_project_state_tokens`, `reserved_continuity_tokens`, `reserved_required_memory_tokens`) can never be raided to make room for RELEVANT/OPTIONAL candidates — if the actual token cost of every protected item exceeds the sum of those four reservations, the request blocks (`REQUIRED_MEMORY_BLOCKED`) rather than shrinking a protected reservation.

When the remaining budget is insufficient for every RELEVANT/OPTIONAL candidate, the engine follows this fixed cascade: (1) drop OPTIONAL items, lowest score first; (2) fingerprint deduplication (already applied earlier, so this step is a no-op in practice — listed for parity with the specification's ordering); (3) drop RELEVANT items, lowest score first, only when `allow_relevant_omission=true` and `overflow_strategy` permits it; (4)/(5) `REQUIRE_HIERARCHICAL_SUMMARY`/`REQUIRE_REASSEMBLY` behave like step 3 for the purpose of fitting the budget in this simulation — they additionally record a declarative reason code (`hierarchical_summary_required_declarative`/`reassembly_required_declarative`) so a future component knows a real summarization/reassembly pass is expected — but **no summary is ever generated by this PR**; (6) if protected items alone do not fit, the request blocks.

`policy.maximum_references`/`maximum_relevant_references`/`maximum_optional_references` are enforced in the same single pass as the token budget — an item needs both remaining tokens and remaining count headroom in its class to be included.

## Score

`memory-selection-score.js` computes an eleven-component, all-integer, floatless, randomness-free score per item: `required_score`, `preference_score`, `project_scope_score`, `continuity_score`, `task_relevance_score`, `decision_relevance_score`, `semantic_relevance_reference` (a caller-supplied declarative integer — **never computed, no embeddings, no ML**), `recency_score`, `frequency_score`, `confidence_score` (EXPLICIT always outranks INFERRED), `omission_risk_score`, minus `token_cost_penalty`. The score never gates REQUIRED-class inclusion — REQUIRED items are included regardless of score, and policy-driven protection always takes precedence over score-driven ranking. The score exists purely to order RELEVANT/OPTIONAL candidates for the overflow cascade above; the final plan's `ordered_reference_ids` is a plain alphabetical union of everything included, giving a deterministic tie-break by `item_reference_id` and guaranteeing input order never changes the output.

## Registry

`memory-selection-registry.js` provides seven independent, in-memory, synthetic entity stores — requests, item references, policies, budgets, scores, plans, decisions — reusing the exact `resolveRegistration` precedence established in PR #91/#92: replay acceptance, payload mismatch, optimistic-concurrency version conflict, fingerprint conflict, version downgrade, tenant/organization rebinding protection, deep freeze, and defensive clone on every read. Only the request store carries a version field (`selection_request_version`), matching the precedent set by `orchestrator-registry.js` (PR #92), where only the top-level request entity supports optimistic concurrency.

## Auditoria

`memory-selection-audit.js` records only: fingerprints (request, each item, policy, budget, each score, plan, and the decision itself), tenant/organization/project bindings, per-class reference counts, an omission-risk summary, the six preservation flags, exclusion reason codes, blockers, logical sequence, the decision status, and the three simulation-safety flags (`simulation=true`, `production_blocked=true`, `executed=false`). It never records item content, preference text, or any other free-form value.

## Limitações

- **No real memory retrieval.** Nothing in this PR queries a database, a vector store, or performs RAG. `agent-memory-retrieval-reference.js` (PR #82) remains the only retrieval-adjacent contract, and it is a reference, not a retrieval.
- **No summarization.** `REQUIRE_HIERARCHICAL_SUMMARY`/`REQUIRE_REASSEMBLY` are declarative signals only; no summary or reassembled content is ever produced by this PR.
- **Reference-level tenant/organization/project/session cross-checks only.** The engine checks that every item, the project state, and every continuity summary agree with the request's own tenant/organization/project (and session, for session-scoped items) — it does not resolve any reference against a real upstream store to confirm the referenced entity actually exists.
- **`memory_selection_policy_reference`/`required_memory_references` on `OrchestratorRequest` (PR #92 addendum) are not consumed here.** This PR implements the policy itself; wiring the Agent Orchestrator's reference fields to an actual `MemorySelectionRequest`/`MemorySelectionDecision` is future work.

**A próxima etapa arquitetural é o Agent Orchestrator Planner.**
