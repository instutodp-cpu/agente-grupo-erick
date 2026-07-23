# Hermes Agent Core - Agent Orchestrator Planner

## Objetivo

This document defines the Agent Orchestrator Planner: a deterministic engine (`orchestrator-planner.js`) that consumes already-validated references and decisions from every prior domain (Agent Core, Agent Policy, Agent Session, Memory Selection and Continuity Policy, Model Selection, Context Assembly, Tool Contracts, Workflow Contracts, Agent Orchestrator Contracts) and produces a declarative orchestration plan — an ordered set of stages, dependencies, a budget, an approval context, and success criteria.

**O Agent Orchestrator Planner produz apenas um plano declarativo. Nenhum agente, modelo, ferramenta, workflow ou estágio é executado.**

## Contrato, planejamento e execução: três camadas distintas

- **Contrato** (PRs #79–93) — defines what a valid request/decision/reference *looks like* for one domain (Agent Core, Policy, Session, Memory Selection, Model Selection, Context Assembly, Tool, Workflow, Orchestrator Contracts). Each domain's engine (when one exists) evaluates that domain's own request into that domain's own decision.
- **Planejamento** (this PR) — takes the *already-produced* decisions from every domain above and arranges them into stages with dependencies, budget, and approval gating. It re-derives nothing: no policy re-evaluation, no memory reclassification, no model re-selection, no context re-assembly, no tool-eligibility re-check, no workflow re-validation. It only consumes references.
- **Execução** (not yet built) — would actually run a stage: call a model, invoke a tool, execute a workflow step. Nothing in this PR, or any PR before it, performs execution. Every safe flag on `OrchestratorPlanningResult` forces this to `false`.

## Ordem de avaliação

`evaluateOrchestratorPlanningRequest` follows a fixed, fail-closed sequence — any inconsistency at any step blocks immediately with the most specific status available, and nothing downstream runs:

1. validate the request's own contract shape;
2. cross-check tenant/organization across every reference against the canonical identity taken from `agent_contract_reference`;
3. cross-check agent/project/session bindings (project id from `memory_selection_decision_reference`, session id from `session_decision_reference`);
4. check the policy reference isn't `DENY`/disallowed;
5–6. check the memory selection reference isn't `BLOCKED`, and that all six preservation flags (required memory, preferences, project state, continuity, pending tasks, applicable decisions) are `true`;
7. when the task requires context, check the context reference is planned (`assembly_planned=true`) and not blocked;
8. when the task requires a model, check the model selection reference isn't `BLOCKED` — never selects one itself;
9. check every required tool decision reference is present and not `BLOCKED`;
10. when the task names a required workflow, check that reference isn't `BLOCKED`;
11. check the task's token/cost estimate fits inside `plan_budget`;
12. check approval is declared when the task or its complexity tier requires it;
13–18. decompose the task into stages (only when decomposition is allowed), order them, build dependencies, mark declarative parallelism, and associate every reference onto the stage that needs it;
19. assemble the plan index (stage ids + dependency ids, fingerprinted);
20. produce the `OrchestratorPlanningResult` and `OrchestratorPlanningAudit`.

## Task Definition

`OrchestratorTaskDefinition` (`orchestrator-task-definition.js`) is the only place complexity, risk, and requirements are declared — 14 `task_type` values, 6 `task_complexity` tiers (reusing `model-selection-task-profile.js`'s `COMPLEXITY_TIERS`), risk/data classification reused from `agent-metadata-contract.js`. `TIER_0_DETERMINISTIC` structurally forces `requires_model=false` (NO_LLM only); `TIER_5_CRITICAL` structurally forces `requires_human_approval=true`. Complexity is never inferred — a caller must state it explicitly, and an invalid combination fails contract validation before the Planner ever runs.

## Decomposição

Decomposition is template-based and deterministic — never LLM-driven. Four fixed templates key off `task_type`:

- **`DETERMINISTIC_REFERENCE`**: validation → deterministic → audit → finalization.
- **`TOOL_COORDINATION_REFERENCE`**: validation → memory reference → context reference → tool reference → audit → finalization.
- **`WORKFLOW_COORDINATION_REFERENCE`**: the same shape with a workflow reference stage instead of a tool stage.
- Every other type (`CLASSIFICATION_REFERENCE`, `ANALYSIS_REFERENCE`, `PLANNING_REFERENCE`, etc.): validation → memory reference → context reference → model reference → audit → finalization.
- **`MULTI_AGENT_REFERENCE`** gets its own fan-out/join shape (see below) instead of a linear template.

When `task_definition.decomposition_allowed` or `planning_policy.allow_task_decomposition` is `false`, decomposition is skipped entirely and the Planner produces a single representative stage instead. A `HUMAN_APPROVAL_STAGE` is inserted immediately after validation whenever approval is required. Stage/dependency/criteria ids are deterministic (`${planning_request_id}-stage-N`, etc.), so identical input always produces an identical plan.

## Stages e dependências

Every `OrchestratorPlanStage` forces `stage_planned=true`, `stage_executed=false`, `simulation=true`, `production_blocked=true` — a stage is a declaration of intent, never a record of execution. Consecutive stages in a linear template are linked by a single `AFTER_SUCCESS_REFERENCE` dependency; the resulting graph is verified acyclic via `hasDependencyCycle` (DFS with a recursion stack) before a plan is ever produced — a cycle anywhere blocks the whole request with `DEPENDENCY_BLOCKED`.

## Paralelismo

Paralelismo é apenas declarativo. Only `MULTI_AGENT_REFERENCE` tasks produce parallel stages, and only when `task_definition.parallelism_allowed`, `planning_policy.allow_parallel_stages`, and the tenant's `maximum_parallel_stages`/`maximum_agent_references` are all satisfied — otherwise the Planner blocks (`POLICY_BLOCKED`) rather than silently falling back to sequential. The multi-agent template fans validation out to N agent-reference stages (`parallelizable=true`) and joins them at a single finalization stage before audit; every parallel stage still has `stage_executed=false` — nothing runs concurrently, or at all.

## Memória e continuidade

**O Planner nunca sacrifica memórias obrigatórias, preferências, estado do projeto ou continuidade para reduzir custo.** The Planner consumes the PR #93 decision through `memory_selection_decision_reference` only — it never reclassifies or re-selects memory. All six preservation flags in that reference's `operational_flags` (`required_memory_preserved`, `preferences_preserved`, `project_state_preserved`, `continuity_preserved`, `pending_tasks_preserved`, `applicable_decisions_preserved`) must be `true` for the plan to proceed; any single one being `false` blocks the whole request with `MEMORY_BLOCKED` (there is no separate `CONTINUITY_BLOCKED` status — continuity is one of memory selection's own preservation guarantees, so a continuity failure is a memory failure).

## Contexto

The Planner consumes only `Context Assembly Engine`'s already-produced result, distinguishing `assembly_planned=true` (a context was successfully planned) from `context_assembled=false`/`content_loaded=false`/`prompt_generated=false` (nothing was actually loaded or generated) — the same three-flag invariant `context-assembly-result.js` (PR #87) already enforces. The Planner never re-assembles context.

## Modelo

**O Planner não seleciona novamente o modelo. Ele preserva a decisão já produzida pelo Model Selection Engine.** `model_selection_decision_reference` carries only a minimal reference — id, fingerprint, bindings, `decision`, and two operational flags (`model_selected_in_simulation`, `deterministic_resolution_selected`) plus the `selected_cost_tier` the Model Selection Engine already chose. The Planner's cost principle is: *"O Planner não escolhe o modelo mais poderoso. Ele preserva a seleção do modelo elegível de menor custo capaz de cumprir os requisitos da etapa."* It is enforced structurally by omission — the Planner has no code path that inspects `selected_cost_tier` and swaps it for anything else; it only ever copies the reference's own id onto a `MODEL_REFERENCE_STAGE`. `NO_LLM` selections (`deterministic_resolution_selected=true`) are preserved identically, and a `BLOCKED` model decision blocks the whole plan (`MODEL_SELECTION_BLOCKED`) when the task requires a model — the Planner never falls back to selecting one itself.

## Tools

Only already-validated `Tool Decision References` are consumed (`tool_decision_references`, one minimal reference per tool, carrying `tool_called=false` and a declarative `side_effect_free` flag). The Planner checks presence, binding consistency, and that none of them is `BLOCKED` — it never re-derives capability, permission, approval, or cost eligibility, since PR #88's Tool Contracts already did that. A required tool id with no matching reference, or a `BLOCKED` reference, blocks with `TOOL_BLOCKED`.

## Workflow

Only `workflow_decision_reference` (PR #89's already-registered decision, reduced to a minimal reference) is consumed. No new workflow is ever created here. A `BLOCKED` workflow reference blocks with `WORKFLOW_BLOCKED` only when the task actually names a `required_workflow_reference_id` — tasks that don't need a workflow ignore its value.

## Orçamento

`OrchestratorPlanBudget` (`orchestrator-plan-budget.js`) is purely declarative: `budget_enforced=true`, `budget_consumed=false`, only non-negative integers, no monetary floats. `reserved_memory_tokens` is the one protected reserve (continuity's token cost is not tracked separately, since — like PR #93's project state and continuity references — it carries no `estimated_tokens` field of its own to protect). The Planner blocks (`BUDGET_BLOCKED`) whenever the task's own token or cost estimate would exceed what's available after `reserved_output_tokens`, or the maximum total cost — no real token or monetary value is ever consumed.

## Aprovação

`ApprovalContext` always forces `approval_granted=false` and `approval_applied=false` in this PR — nothing here can grant or apply an approval. Approval is required whenever `task_definition.requires_human_approval`, `task_complexity=TIER_5_CRITICAL`, or the caller's own `approval_context.approval_required` is `true`; when required, the result status becomes `APPROVAL_REQUIRED_SIMULATION` (decision `GENERATE_APPROVAL_PLAN`) instead of `PLAN_READY_SIMULATION` — the plan itself may still contain a `HUMAN_APPROVAL_STAGE` and every stage after it, but nothing downstream is ever treated as released for execution.

## Critérios de sucesso

`OrchestratorSuccessCriteria` (11 `criteria_type` values) are attached one per meaningful stage (validation, memory, context, model, tool, workflow, approval, audit) and always force `criteria_satisfied=false`/`evaluation_executed=false` — a criteria is a declared expectation, never a recorded evaluation outcome.

## Registry

`orchestrator-planning-registry.js` provides nine independent, in-memory, synthetic entity stores — planning requests, task definitions, planning policies, plan budgets, plan stages, plan dependencies, success criteria, a lightweight plan index (id + stage/dependency ids + fingerprint, tenant/organization-bound), and planning results — reusing the exact `resolveRegistration` precedence from PR #91/#92/#93 (replay, payload mismatch, optimistic-concurrency version conflict, fingerprint conflict, version downgrade, tenant/organization rebinding protection, deep freeze, defensive clone). Only the planning request store carries a version field, matching the precedent set by `orchestrator-registry.js` and `memory-selection-registry.js`.

## Auditoria

`orchestrator-planning-audit.js` records only: fingerprints (request, task, policy, budget, every stage, every dependency, every success criteria, the plan, and the result itself), tenant/organization/project/agent bindings, stage counts by type, token/cost estimates, the declared (never granted) approval context, blockers, reason codes, logical sequence, and the three simulation-safety flags. It never records stage content, tool parameters, or model responses — there are none to record.

## Limitações

- **Decomposition templates are fixed and coarse.** Only four shapes exist (deterministic, model-reference default, tool, workflow) plus multi-agent fan-out/join. A future PR may need finer-grained or caller-supplied templates.
- **Multi-agent fan-out is a fixed count heuristic**, not a real sub-planning process — it derives an agent-stage count from `required_capabilities.length` bounded by policy maximums, not from actually planning each sub-agent's own task.
- **No cross-reference content validation.** Like `orchestrator-request.js` (PR #92), this Planner checks tenant/organization/agent/project/session consistency and blocked-vs-not status, never that a referenced entity's *content* actually exists in a real store.
- **`orchestrator-request.js`'s `memory_selection_policy_reference`/`required_memory_references` fields (PR #92 addendum) are still not consumed by this Planner** — it reads memory preservation exclusively through `memory_selection_decision_reference`.

**A próxima etapa arquitetural é o Agent Orchestrator Decision Engine.**
