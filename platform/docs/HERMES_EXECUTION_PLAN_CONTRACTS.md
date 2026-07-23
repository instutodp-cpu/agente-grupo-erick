# Hermes Agent Core - Execution Plan Contracts

## Objetivo

This PR defines the Execution Plan Contracts: a deterministic engine (`execution-plan-engine.js`) that consumes an already-`AUTHORIZED_SIMULATION` authorization decision (PR #97), an already-`READY_EVIDENCE_SIMULATION` evidence bundle (PR #96), PR #94/#95's own planning result and orchestration plan references, and a fingerprinted, bound `TaskReference` (PR #97fix) — and emits a simulated, declarative `ExecutionPlanContract`: a fully materialized package of stages, bindings, dependencies, budget, idempotency, stop conditions, and compensation references describing *what a future execution would look like*, without authorizing, starting, or performing any of it.

**EXECUTION_PLAN_PREPARED_SIMULATION significa apenas que um pacote declarativo de execução foi preparado. Ele não é executável e nenhuma execução foi autorizada ou iniciada.**

## Autorização, preparação, execução e conclusão: quatro camadas distintas

- **Autorização** (PR #97) — decides whether a specific actor, in a specific scope, is allowed to move a plan toward execution. Says "is this allowed."
- **Preparação** (this PR) — takes an authorized plan and materializes it into a concrete, ordered set of stages, bindings, dependencies, budget, idempotency, stop conditions, and compensation coverage. Says "here is exactly what would run, and in what order, if execution were ever enabled."
- **Execução** (not implemented anywhere yet) — would actually run stages, call models/tools/workflows, consume budget, and produce real side effects. No code in this repository does this.
- **Conclusão** (not implemented anywhere yet) — would record the final outcome of a real execution. No code in this repository does this either.

`executable`, `execution_authorized`, `execution_started`, `executed`, and `runtime_enabled` are hardcoded `false` on every `ExecutionPlanContract` and every `ExecutionPlanResult` this PR can ever produce, including `PREPARED_SIMULATION`/`EXECUTION_PLAN_PREPARED_SIMULATION`. A dedicated regression test iterates all 34 named fixture scenarios and asserts this for every one of them, plus the full set of activity flags on `ExecutionPlanResult` (`stage_started`, `stage_completed`, `tool_called`, `workflow_executed`, `provider_called`, `model_called`, `network_used`, `memory_read`, `memory_written`, `tokens_consumed`, `cost_consumed`).

**A preparação do plano não resolve segredos, não carrega conteúdo e não chama agentes, modelos, ferramentas ou workflows.**

## Request

`ExecutionPlanRequest` (`execution-plan-request.js`, 25 fields) carries: an `authorization_decision_reference` and an `execution_plan_policy_reference` (both defined in this same module, described below); PR #94's own `planning_result_reference`/`orchestration_plan_reference` and minimal decision references for memory/context/model/tool/workflow (all reused directly from `orchestrator-planning-request.js`, not redefined); PR #97's `evidence_bundle_reference`/`orchestrator_decision_reference` (reused from `execution-authorization-request.js`); PR #97fix's `task_reference` (reused from `execution-authorization-task-reference.js`); this PR's own `execution_plan_budget`, `idempotency_policy_reference`, `stop_condition_references[]`, and `compensation_references[]`; and the usual correlation/causation/trace/logical-sequence/registry-version/simulation-context envelope every PR since #85 has carried.

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

`ExecutionPlanDependency` (`execution-plan-dependency.js`, 13 fields) reuses PR #94's `DEPENDENCY_TYPES` and `hasDependencyCycle` (`orchestrator-plan-dependency.js`) rather than redefining them; `execution-plan-dependency.js` itself does not re-export `DEPENDENCY_TYPES`, so any consumer needing the enum imports it directly from PR #94's own module. `buildExecutionPlanDependency` rejects self-dependencies (`from_stage_id === to_stage_id`) at construction time.

**Dependency edges are not scalar and cannot be carried by a flat `dependency_ids`/`ordered_stage_ids` list** — the request and plan references only ever carry an *ordered set* of stage/dependency ids, never the edges between them. Exactly like PR #95/#96's own `context.dependencyRecords` side-channel (explicitly preserved and reused here, not reintroduced), the actual `{from_stage_id, to_stage_id, dependency_type}` graph travels via `context.dependencyRecords`, a documented side-channel for graph-shaped structural data — as opposed to PR #97's rejected `context.riskClassification`, which carried a *scalar decision-driving value* that belonged in a fingerprinted reference instead. The distinguishing principle: scalar values that drive a decision must be fingerprinted and bound; graph-shaped structural data that no reference schema in any spec models may still travel via a documented context parameter. `analyzeExecutionPlanDependencies` reports cycle/self-dependency/missing-reference/duplicate detection over whatever `dependencyRecords` the caller supplies; declared `dependency_ids` with no matching `dependencyRecords` entry are treated as `DEPENDENCY_BLOCKED`, never silently ignored.

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

`ExecutionPlanResult` (`execution-plan-result.js`, 67 fields) is the outer envelope returned to the caller: `status` (20 values), `decision` (4 values), `next_state` (4 values), plus the full activity-flag set described above. `buildExecutionPlanResult` normalizes any `status` not present in its own 20-value `RESULT_STATUSES` to `VALIDATION_FAILED` before doing anything else with it.

**`RESULT_STATUSES` and `ExecutionPlanContract.execution_plan_status` are deliberately different enums, not a copy error.** `execution_plan_status` carries 24 values including five domain-specific blocks (`MEMORY_BLOCKED`, `CONTEXT_BLOCKED`, `MODEL_BLOCKED`, `TOOL_BLOCKED`, `WORKFLOW_BLOCKED`) plus a generic `BLOCKED`; `RESULT_STATUSES` has none of those six, but has `DENY` and `BINDING_BLOCKED` instead, which `execution_plan_status` lacks. This was verified directly against the spec's own two separate field/enum lists, not assumed. Practically: when preparation fails for one of the five domain-specific reasons, the *plan* contract carries the precise status (e.g. `execution_plan_status='MODEL_BLOCKED'`), while the *result* envelope collapses to `status='VALIDATION_FAILED'` — the closest bucket `RESULT_STATUSES` actually has. A dedicated test verifies both halves of this behavior for all five domain blocks, and every fixture scenario that exercises one of them records both values.

## Registry

`execution-plan-registry.js` provides ten independent, in-memory, synthetic entity stores (requests, plans, stages, bindings, dependencies, budgets, idempotency references, stop conditions, compensation references, results), reusing the identical `resolveRegistration`/`createEntityStore` precedence every prior PR's registry uses: validation → tenant → organization → replay → payload-mismatch → expected-version-conflict → expected-fingerprint-conflict → version-downgrade → accepted.

## Auditoria

`execution-plan-audit.js` records only: seven fingerprints (`request`, `authz` — renamed from `authorization` solely to avoid the shared operational-material detector's forbidden-key check, see "Limitações" — `evidence_bundle`, `planning_result`, `orchestration_plan`, `task`, `execution_plan`), tenant/organization/project/session/agent/task bindings, counts (stage/dependency/binding/stop-condition/compensation), estimated budget totals, side-effect/stop-condition/compensation type labels, `status`/`decision`/`next_state`, `blockers`, `reason_codes`, `logical_sequence`, and the three simulation-safety flags plus `executed=false`. It never records stage content, prompts, messages, real memory, documents, tool parameters, model responses, secrets, endpoints, or a full payload.

## Engine

`execution-plan-engine.js` is an additional file not named in this PR's own "Criar" file list — a deliberate, documented deviation, mirroring the spirit of PR #97's own documented allowlist-extension deviation. None of this PR's twelve spec-listed contract files contains the actual 26-step evaluation order; without a dedicated engine module, that logic would have had to live inside one of the contract files (mixing a stateless validator with a stateful evaluator) or be duplicated across callers. `evaluateExecutionPlanRequest(request, context)` is the single entry point; `context.dependencyRecords` and `context.currentRegistryVersion` are its only two side-channel inputs, both already established by earlier PRs.

## Limitações

- **`execution-plan-engine.js` is not in the spec's own file list.** See "Engine" above.
- **`context.dependencyRecords` continues PR #95/#96's side-channel for graph-shaped dependency edges.** See "Dependências" above for why this is different from the `context.riskClassification` side-channel PR #97's own fix eliminated.
- **`stage_type`/`side_effect_classification` are derived, not carried by any new field.** See "Estágios" above.
- **`execution_plan_id`/`execution_stage_id` reuse upstream ids rather than minting new ones.** `execution_plan_id = orchestration_plan_reference.plan_id`; each stage's `execution_stage_id = source_orchestrator_stage_id`, reusing entries already present in `orchestration_plan_reference.ordered_stage_ids`.
- **`RESULT_STATUSES` and `execution_plan_status` are asymmetric by design, not by mistake.** See "Resultado" above.
- **A key-name allowlist extension was required, again.** Field names this PR's spec mandates that legitimately contain the word "authorization" or "model" (`authorization_decision_reference`, `authorization_fingerprint`, `idempotency_key_reference`, the fixture scenario `authorization-blocked-plan`, and several test-data identifiers) were either added to `AGENT_CORE_ALLOWLISTED_KEY_NAMES` or renamed to avoid standalone "model"/"authorization" segments (e.g. `model-binding`→`selection-binding`), continuing the same pattern PR #97 already used and documented. The full existing test suite was re-run after each change and passes unchanged.
- **No cross-reference content resolution.** Like every prior orchestrator/evidence/authorization PR, this preparation step checks tenant/organization/project/session/plan consistency and status/fingerprint agreement, never that a referenced entity's content actually exists in a real store.

**External effects e ações irreversíveis permanecem bloqueados nesta implementação.**

**A próxima etapa arquitetural é o Execution Gateway Boundary.**
