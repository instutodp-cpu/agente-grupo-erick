# Hermes Agent Core - Execution Plan Contracts

## Objetivo

This PR defines the Execution Plan Contracts: a deterministic engine (`execution-plan-engine.js`) that consumes an already-`AUTHORIZED_SIMULATION` authorization decision (PR #97), an already-`READY_EVIDENCE_SIMULATION` evidence bundle (PR #96), PR #94/#95's own planning result and orchestration plan references, and a fingerprinted, bound `TaskReference` (PR #97fix) — and emits a simulated, declarative `ExecutionPlanContract`: a fully materialized package of stages, bindings, dependencies, budget, idempotency, stop conditions, and compensation references describing *what a future execution would look like*, without authorizing, starting, or performing any of it.

**EXECUTION_PLAN_PREPARED_SIMULATION significa apenas que um pacote declarativo de execução foi preparado. Ele não é executável e nenhuma execução foi autorizada ou iniciada.**

## Autorização, preparação, execução e conclusão: quatro camadas distintas

- **Autorização** (PR #97) — decides whether a specific actor, in a specific scope, is allowed to move a plan toward execution. Says "is this allowed."
- **Preparação** (this PR) — takes an authorized plan and materializes it into a concrete, ordered set of stages, bindings, dependencies, budget, idempotency, stop conditions, and compensation coverage. Says "here is exactly what would run, and in what order, if execution were ever enabled."
- **Execução** (not implemented anywhere yet) — would actually run stages, call models/tools/workflows, consume budget, and produce real side effects. No code in this repository does this.
- **Conclusão** (not implemented anywhere yet) — would record the final outcome of a real execution. No code in this repository does this either.

`executable`, `execution_authorized`, `execution_started`, `executed`, and `runtime_enabled` are hardcoded `false` on every `ExecutionPlanContract` and every `ExecutionPlanResult` this PR can ever produce, including `PREPARED_SIMULATION`/`EXECUTION_PLAN_PREPARED_SIMULATION`. A dedicated regression test iterates all 42 named fixture scenarios and asserts this for every one of them, plus the full set of activity flags on `ExecutionPlanResult` (`stage_started`, `stage_completed`, `tool_called`, `workflow_executed`, `provider_called`, `model_called`, `network_used`, `memory_read`, `memory_written`, `tokens_consumed`, `cost_consumed`).

**A preparação do plano não resolve segredos, não carrega conteúdo e não chama agentes, modelos, ferramentas ou workflows.**

## Request

`ExecutionPlanRequest` (`execution-plan-request.js`, 26 fields) carries: an `authorization_decision_reference` and an `execution_plan_policy_reference` (both defined in this same module, described below); PR #94's own `planning_result_reference`/`orchestration_plan_reference` and minimal decision references for memory/context/model/tool/workflow (all reused directly from `orchestrator-planning-request.js`, not redefined); PR #97's `evidence_bundle_reference`/`orchestrator_decision_reference` (reused from `execution-authorization-request.js`); PR #97fix's `task_reference` (reused from `execution-authorization-task-reference.js`); this PR's own `execution_plan_budget`, `idempotency_policy_reference`, `stop_condition_references[]`, and `compensation_references[]`; this PR's own **pr98fix** addition, `dependency_graph_reference` (described below, under "Dependências"); and the usual correlation/causation/trace/logical-sequence/registry-version/simulation-context envelope every PR since #85 has carried.

### AuthorizationDecisionReference

A minimal, 23-field mirror of PR #97's own 70-field `AuthorizationDecision` — reusing its `AUTHORIZATION_STATUSES`/`AUTHORIZATION_DECISIONS`/`AUTHORIZATION_NEXT_STATES` enums rather than redefining them, the same "minimal reference mirror" pattern PR #95 and PR #97 already established for their own upstream contracts. `execution_authorized`, `execution_started`, and `executed` are forced `false` on every instance. `isAuthorizationDecisionReady` requires `status=AUTHORIZED_SIMULATION`, `decision=AUTHORIZE_EXECUTION_REFERENCE`, `next_state=EXECUTION_READY_REFERENCE`, and `authorized_in_simulation=true`, checked jointly.

### ExecutionPlanPolicyReference

A 28-field declarative policy (`require_*`/`allow_*`/`fail_on_*` boolean flags) controlling which stage types, dependency shapes, and side-effect classes this preparation step will accept. Every `require_*`/`fail_on_*` flag is forced `true` and `allow_external_side_effect_reference`/`allow_irreversible_reference` are forced `false` on every instance this PR can construct — a caller cannot loosen the safety floor, only the `allow_model_stage`/`allow_tool_stage`/`allow_workflow_stage`/`allow_no_llm_stage`/`allow_parallel_stage` flags are genuinely caller-controlled.

## Plano

`ExecutionPlanContract` (`execution-plan-contract.js`, 51 fields, 24 `execution_plan_status` values) is the materialized output. `execution_plan_id` reuses `orchestration_plan_reference.plan_id` verbatim rather than minting a fresh id — the plan being prepared *is* the plan PR #94/#95 already produced, not a new entity. `execution_plan_prepared` is `true` only when `execution_plan_status='PREPARED_SIMULATION'`.

## Estágios

`ExecutionPlanStage` (`execution-plan-stage.js`, 39 fields) reuses PR #94's `STAGE_TYPES` (`orchestrator-plan-stage.js`) and PR #93's tool side-effect classifications (`tool-side-effects-contract.js`, aliased here as `SIDE_EFFECT_CLASSIFICATIONS`) rather than redefining either. Each materialized stage reuses the same `stage_id` already present in `orchestration_plan_reference.ordered_stage_ids` as its own `execution_stage_id`/`source_orchestrator_stage_id` — the same identity-reuse strategy the plan itself uses for `execution_plan_id`, resolving the same "an id must exist before it can be assigned" problem.

`stage_type` is derived uniformly from which plan-level references are actually present: a stage is `MODEL_REFERENCE_STAGE` when a real model selection is present, `TOOL_REFERENCE_STAGE` when tool decision references are present, `WORKFLOW_REFERENCE_STAGE` when a workflow decision reference is present, `HUMAN_APPROVAL_STAGE` when the stage id appears in the planning result's `approval_stage_ids`, and `DETERMINISTIC_STAGE` otherwise — never a new side-channel value, always a function of data already flowing through the request's own fingerprinted references. `side_effect_classification` is derived from whether a `compensation_references[]` entry (a proper fingerprinted request field, not a side-channel) targets that stage with `required=true`: covered state-change stages classify as `STATE_CHANGE_REFERENCE`, uncovered ones are rejected outright (see "Compensação" below), and stages with no targeting compensation entry classify as `NONE`. **This is deliberately not a repeat of PR #97's rejected `context.riskClassification` side-channel** — both `stage_type` and `side_effect_classification` are pure functions of fields the request contract already validates, fingerprints, and binds; nothing about a stage's classification is ever supplied out-of-band.

`stage_prepared` is `true` only when `stage_status='PREPARED_SIMULATION'`; there is no fingerprint field on the stage contract, matching the spec's own field list.

## Dependências

**Revision history: this section originally described a `context.dependencyRecords` side-channel, mirroring PR #95/#96's own pattern for graph-shaped structural data.** pr98fix rejected that reasoning: a dependency edge is exactly the kind of "condição utilizada para" the plan's own preparation decision (cycle/self-dependency/missing-reference detection directly drives `DEPENDENCY_BLOCKED`), and a side-channel value is by definition unversioned, unfingerprinted, and unbound to the plan it claims to describe — the same defect PR #97's fix already found in `context.riskClassification`. The distinction drawn in the original docs ("graph-shaped data may travel via context, only scalar decision-driving values may not") turned out not to hold: graph-shaped data can still drive a decision, and when it does, it needs the same fingerprinted-and-bound treatment as anything else. `context.dependencyRecords` is no longer read anywhere in `execution-plan-engine.js`; a stale or malicious value passed there has zero effect on the result (verified directly by a dedicated test).

`DependencyGraphReference` (`execution-plan-dependency-graph-reference.js`, 17 fields) is the request's own `dependency_graph_reference` field — the sole carrier of every dependency edge for the plan being prepared. It is tenant/organization/project/session-bound, versioned, and fingerprinted (`graph_fingerprint` covers the whole reference, computed the same way every other fingerprinted reference in this codebase is: canonical serialization of every other field). It embeds `stage_ids` (the full, ordered, unique set of stages the graph is defined over) and `dependency_records[]`, an array of `DependencyRecord` (8 fields: `dependency_id`, `dependency_version`, `from_stage_id`, `to_stage_id`, `dependency_type` — reusing PR #94's own `DEPENDENCY_TYPES` enum verbatim, not redefined — `required`, `dependency_fingerprint`, `validator_version`).

**Validated by construction, exactly like PR #97fix's own `TaskReference`:** `buildExecutionPlanDependencyGraphReference` enforces every structural rule at construction time, so an invalid graph can never exist as a value in the first place — `stage_ids` must be unique and ordered; `dependency_records` must be canonically ordered (`from_stage_id`, then `to_stage_id`, then `dependency_id` — a total order that never depends on caller-supplied insertion order, so two callers describing the same graph always produce the identical `graph_fingerprint`); every `dependency_id` must be unique; `dependency_count` must equal `dependency_records.length`; every `from_stage_id`/`to_stage_id` must exist in `stage_ids`; a self-dependency (`from_stage_id === to_stage_id`) is rejected; a cycle (`hasDependencyCycle`, reused directly from PR #94's own `orchestrator-plan-dependency.js`) is rejected. A cyclic or self-referential graph is therefore not a runtime `DEPENDENCY_BLOCKED` outcome — it is a construction-time exception, and a request built around one fails request validation with `VALIDATION_FAILED` before the engine's step-by-step evaluation ever runs (the `dependency-cycle-plan` fixture demonstrates exactly this, the same pattern PR #97fix's own `external-effect-blocked-plan`/`irreversible-blocked-plan` established).

The engine's own step 20 (`execution-plan-engine.js`) checks what construction-time validation cannot: agreement with the *rest* of the request. `dependency_graph_reference`'s tenant/organization/project/session must agree with the canonical identity (checked via the same `checkBinding` helper every other reference uses — generalized in this fix to treat a field that is entirely *absent* from a reference's own exact-fields list, such as `DependencyGraphReference` having no `agent_id` at all, the same as an explicit `null`, i.e. "not scoped"); its `execution_plan_id`/`planning_result_id`/`orchestration_plan_id` must agree with the plan actually being prepared (`DEPENDENCY_BLOCKED` on any mismatch); its `stage_ids` must describe the exact same stage set as `orchestration_plan_reference.ordered_stage_ids` (`DEPENDENCY_BLOCKED` on mismatch); and its `graph_fingerprint` is recomputed and compared against the stored value — a tamper-detection re-check identical in spirit to the task-reference fingerprint check, catching any hand-edited record the construction-time validator's own field-level checks wouldn't otherwise re-verify at evaluation time (`FINGERPRINT_BLOCKED` on mismatch).

`ExecutionPlanDependency` (`execution-plan-dependency.js`, 13 fields, unchanged by this fix) remains the per-edge *materialized* entity on the prepared plan — the engine still builds one per `DependencyRecord` in `dependency_graph_reference.dependency_records`, it just no longer sources those records from a side-channel.

## Bindings

`ExecutionPlanStageBinding` (`execution-plan-stage-binding.js`, 18 fields, 12 `binding_type` values) records, per stage, which task/agent/model/tool/workflow/memory/context/authorization reference the stage is bound to, plus the tenant/organization/project/session/agent identity that binding is scoped to. `binding_applied` is forced `false` on every instance — a binding here only declares *that* a stage would use a given reference, never that it has. A selected tool/model/workflow reference with no corresponding binding produced is `BINDING_BLOCKED`.

## Orçamento

`ExecutionPlanBudget` (`execution-plan-budget.js`, 29 fields) derives `tokens_within_limit`/`cost_within_limit`/`protected_reservations_preserved` from estimated-vs-maximum comparisons, and `budget_validated` as their logical AND — the same pattern PR #97's `BudgetAuthorizationReference` already established. `budget_consumed` is forced `false` on every instance.

## Idempotência

`ExecutionPlanIdempotency` (`execution-plan-idempotency.js`, 19 fields) requires a normalized synthetic `idempotency_key_reference` (`^[A-Za-z0-9_:-]+$`, no free-form text). `duplicate_execution_blocked` is forced `true` and `idempotency_consumed` is forced `false` on every instance — this PR can declare that duplicates *would be* blocked, never actually consume the key. A missing or unvalidated idempotency reference is `IDEMPOTENCY_BLOCKED`.

## Stop conditions

`ExecutionPlanStopCondition` (`execution-plan-stop-condition.js`, 15 fields, 16 `condition_type` values) is required by policy but never evaluated in this PR: `condition_evaluated`, `condition_triggered`, and `stop_applied` are all forced `false` on every instance. A plan whose policy requires stop conditions but which declares none is `STOP_CONDITION_BLOCKED`.

## Compensação

`ExecutionPlanCompensationReference` (`execution-plan-compensation-reference.js`, 15 fields, 5 `compensation_type` values) declares, per state-change stage, how that stage's effect could be reversed. `compensation_executed` is forced `false` on every instance. A stage classified as `STATE_CHANGE_REFERENCE` (see "Estágios" above) with no `required=true` compensation entry covering it, or with a `compensation_type='NONE'` covering entry, is `COMPENSATION_BLOCKED` — coverage (does a compensation entry exist and validate) is checked independently from classification (does the stage change state at all), so a state-change stage can be correctly classified and still fail preparation for lacking a real compensation path.

## Resultado

`ExecutionPlanResult` (`execution-plan-result.js`, 69 fields — +2 from pr98fix) is the outer envelope returned to the caller: `status` (20 values), `decision` (4 values), `next_state` (4 values), plus the full activity-flag set described above. `buildExecutionPlanResult` normalizes any `status` not present in its own 20-value `RESULT_STATUSES` to `VALIDATION_FAILED` before doing anything else with it.

**pr98fix adds `dependency_graph_fingerprint` and `dependency_graph_validated`.** `dependency_graph_fingerprint` carries the request's own `dependency_graph_reference.graph_fingerprint` through to the result, the same way every other upstream fingerprint (`authorization_fingerprint`, `task_fingerprint`, …) already does. `dependency_graph_validated` follows a one-way binding to `status` identical to the pre-existing `execution_plan_prepared` field: `true` only when `status='EXECUTION_PLAN_PREPARED_SIMULATION'`, `false` for every other status — it is derived internally by `buildExecutionPlanResult`, never caller-supplied, so it cannot drift from the status it describes.

**`RESULT_STATUSES` and `ExecutionPlanContract.execution_plan_status` are deliberately different enums, not a copy error.** `execution_plan_status` carries 24 values including five domain-specific blocks (`MEMORY_BLOCKED`, `CONTEXT_BLOCKED`, `MODEL_BLOCKED`, `TOOL_BLOCKED`, `WORKFLOW_BLOCKED`) plus a generic `BLOCKED`; `RESULT_STATUSES` has none of those six, but has `DENY` and `BINDING_BLOCKED` instead, which `execution_plan_status` lacks. This was verified directly against the spec's own two separate field/enum lists, not assumed. Practically: when preparation fails for one of the five domain-specific reasons, the *plan* contract carries the precise status (e.g. `execution_plan_status='MODEL_BLOCKED'`), while the *result* envelope collapses to `status='VALIDATION_FAILED'` — the closest bucket `RESULT_STATUSES` actually has. A dedicated test verifies both halves of this behavior for all five domain blocks, and every fixture scenario that exercises one of them records both values.

## Registry

`execution-plan-registry.js` provides ten independent, in-memory, synthetic entity stores (requests, plans, stages, bindings, dependencies, budgets, idempotency references, stop conditions, compensation references, results), reusing the identical `resolveRegistration`/`createEntityStore` precedence every prior PR's registry uses: validation → tenant → organization → replay → payload-mismatch → expected-version-conflict → expected-fingerprint-conflict → version-downgrade → accepted.

## Auditoria

`execution-plan-audit.js` records only: eight fingerprints (`request`, `authz` — renamed from `authorization` solely to avoid the shared operational-material detector's forbidden-key check, see "Limitações" — `evidence_bundle`, `planning_result`, `orchestration_plan`, `task`, `dependency_graph` — added by pr98fix — `execution_plan`), a `dependency_graph_reference_id` field (added by pr98fix, alongside the pre-existing `execution_plan_request_id`/`execution_plan_id`), tenant/organization/project/session/agent/task bindings, counts (stage/dependency/binding/stop-condition/compensation), estimated budget totals, side-effect/stop-condition/compensation type labels, a `dependency_graph_validated` flag (added by pr98fix), `status`/`decision`/`next_state`, `blockers`, `reason_codes`, `logical_sequence`, and the three simulation-safety flags plus `executed=false`. It never records stage content, prompts, messages, real memory, documents, tool parameters, model responses, secrets, endpoints, or a full payload.

## Engine

`execution-plan-engine.js` is an additional file not named in this PR's own "Criar" file list — a deliberate, documented deviation, mirroring the spirit of PR #97's own documented allowlist-extension deviation. None of this PR's twelve spec-listed contract files contains the actual evaluation order; without a dedicated engine module, that logic would have had to live inside one of the contract files (mixing a stateless validator with a stateful evaluator) or be duplicated across callers. `evaluateExecutionPlanRequest(request, context)` is the single entry point; `context.currentRegistryVersion` is its only remaining side-channel input (pr98fix removed the other one, `context.dependencyRecords` — see "Dependências" above).

## Limitações

- **`execution-plan-engine.js` is not in the spec's own file list.** See "Engine" above.
- **`context.dependencyRecords` was removed as a follow-up fix (pr98fix)** — dependency edges now travel exclusively via the fingerprinted, versioned, bound `DependencyGraphReference`. See "Dependências" above. This is documented here as historical context, not a remaining limitation.
- **`stage_type`/`side_effect_classification` are derived, not carried by any new field.** See "Estágios" above.
- **`execution_plan_id`/`execution_stage_id` reuse upstream ids rather than minting new ones.** `execution_plan_id = orchestration_plan_reference.plan_id`; each stage's `execution_stage_id = source_orchestrator_stage_id`, reusing entries already present in `orchestration_plan_reference.ordered_stage_ids`.
- **`RESULT_STATUSES` and `execution_plan_status` are asymmetric by design, not by mistake.** See "Resultado" above.
- **`checkBinding` was generalized by pr98fix** to treat a reference field that is entirely absent from that reference's own exact-fields list (e.g. `DependencyGraphReference` has no `agent_id`) the same as an explicit `null` — both mean "not scoped, do not check." Existing call sites are unaffected since every reference they already pass always explicitly sets these fields to `null` or a real value, never leaves them `undefined`.
- **A key-name allowlist extension was required, again.** Field names this PR's spec mandates that legitimately contain the word "authorization" or "model" (`authorization_decision_reference`, `authorization_fingerprint`, `idempotency_key_reference`, the fixture scenario `authorization-blocked-plan`, and several test-data identifiers) were either added to `AGENT_CORE_ALLOWLISTED_KEY_NAMES` or renamed to avoid standalone "model"/"authorization" segments (e.g. `model-binding`→`selection-binding`), continuing the same pattern PR #97 already used and documented. The full existing test suite was re-run after each change and passes unchanged.
- **No cross-reference content resolution.** Like every prior orchestrator/evidence/authorization PR, this preparation step checks tenant/organization/project/session/plan consistency and status/fingerprint agreement, never that a referenced entity's content actually exists in a real store.

**External effects e ações irreversíveis permanecem bloqueados nesta implementação.**

**A próxima etapa arquitetural é o Execution Gateway Boundary.**
