# Hermes Agent Core - Agent Orchestrator Decision Engine

## Objetivo

This document defines the Agent Orchestrator Decision Engine: a deterministic engine (`orchestrator-decision-engine.js`) that consumes only the already-produced result and declarative plan from the Agent Orchestrator Planner (PR #94), validates every reference it carries, and emits a simulated decision about what should happen next — authorize the plan in simulation, wait on a specific resolvable condition, or block outright.

**O Agent Orchestrator Decision Engine apenas interpreta o plano e produz uma decisão simulada. Ele não autoriza nem inicia execução real.**

## Planejamento, decisão, autorização e execução: quatro camadas distintas

- **Planejamento** (PR #94) — decomposes a task into a declarative plan: stages, dependencies, budget, approval context.
- **Decisão** (this PR) — interprets that already-produced plan and its upstream references, and decides the orchestration's *next state*: ready, waiting on something specific, or blocked. It re-derives nothing from any upstream domain.
- **Autorização** (not yet built) — would be the boundary that actually permits a `READY_SIMULATION` plan to proceed toward real execution. Nothing in this PR is that boundary; `execution_authorized` is hardcoded `false` on every single result this engine can ever produce, including `READY_SIMULATION`.
- **Execução** (not yet built, and not this PR's concern at all) — would actually run a stage.

**READY_SIMULATION significa que o plano está estruturalmente pronto para uma futura fronteira de autorização. Não significa que qualquer agente, modelo, ferramenta ou workflow foi executado.**

## Ordem de avaliação

`evaluateOrchestratorDecisionRequest` follows the 26-step order below exactly, fail-closed at every step — the first inconsistency found is the one returned, and nothing after it runs:

1–2. validate the request's own contract shape (which already validates `simulation_context` as one of its nested fields); 3. the `planning_result_reference`/`orchestration_plan_reference` shapes are validated as part of step 1 too; 4–8. cross-check tenant/organization/agent/project/session across every reference against the canonical identity taken directly from `planning_result_reference` (which — unlike PR #94's `OrchestratorPlanningRequest` — carries all five identity fields at its own top level); 9. cross-check `plan_id`/`plan_fingerprint` agreement between `planning_result_reference` and `orchestration_plan_reference`, and (when a caller supplies `context.currentRegistryVersion`) the request's `expected_registry_version`; 10. confirm `planning_result_reference.status` is one of PR #94's two plan-generating statuses; 11–14. memory preservation, preferences, project state, and continuity (see below); 15. policy; 16. context; 17. model selection or NO_LLM; 18. tools; 19. workflow; 20. budget; 21. dependencies; 22. approvals; 23–24. consolidate blockers and compute readiness; 25. emit the decision; 26. produce the audit.

**A note on the two orderings in the specification.** The specification also lists a separate, coarser 18-entry "Precedência de decisão" table, which places `POLICY_BLOCKED` above `MEMORY_BLOCKED`. That table's ordering does not match the numbered, item-by-item "Ordem obrigatória de avaliação" section, which explicitly checks memory (steps 11–14) before policy (step 15). This implementation treats the more granular, explicitly numbered evaluation order as authoritative, since it is unambiguous about exactly what is being compared at each step; the summary table's ordering is honored everywhere else it is unambiguous (structural validation and bindings before every domain-specific check, and `READY_SIMULATION` only after every other check has passed).

## Blockers

`OrchestratorBlocker` (`orchestrator-blocker.js`) is the atomic unit of "why not": 22 `blocker_type` values, 4 severities, 12 declarative `resolution_type` values. Only `HIGH` and `CRITICAL` severity may ever set `blocking=true` — enforced at the contract level, not just by convention. **WARNING nunca pode ser usado para permitir silenciosamente uma condição obrigatória ausente** — every domain check in this engine that represents a missing mandatory condition always constructs its blocker at `HIGH` severity with `blocking=true`; `WARNING`/`INFO` severities exist in the enum for future diagnostic use but this PR's engine never emits one for a real gap. A blocker is either fully resolvable (`resolvable=true` with a real `resolution_type`) or not resolvable at all (`resolvable=false` with `resolution_type=NONE`) — the contract rejects any other combination.

## Readiness

`OrchestratorReadiness` (`orchestrator-readiness.js`) is a 14-domain readiness snapshot plus a `readiness_score` — a deterministic, floatless, integer 0–100 diagnostic computed by `computeReadinessScore` (10 points off per not-ready domain, 2 points off per warning, capped, floored at 0; no machine learning, no randomness). **A pontuação de readiness é apenas diagnóstica e nunca pode superar uma política, blocker ou requisito obrigatório** — enforced structurally: `overall_ready_in_simulation` is forced `false` the instant `blocking_count` or `critical_count` is above zero, and forced `false` unless every one of the 14 domain flags is `true`, regardless of what the score says. `readiness_evaluated=true` and `execution_started=false` are fixed on every readiness record.

## Precedência

The engine's sequential, fail-closed evaluation *is* the precedence mechanism — whichever check fails first determines the returned status, and nothing downstream is even evaluated, so no later check can ever override an earlier one. `READY_SIMULATION` is only reachable after all 22 substantive checks (steps 4–22) pass.

## Aprovações

Approval is read, never derived: the engine treats `planning_result_reference.status === 'APPROVAL_REQUIRED_SIMULATION'` (or a non-empty `approval_stage_ids`) as the sole signal that approval is required — exactly what PR #94's Planner already decided, never re-derived from task risk or complexity. When required, the result is `WAITING_APPROVAL_SIMULATION` / `REQUEST_HUMAN_APPROVAL` / `WAITING_APPROVAL_REFERENCE`, with `approval_required=true` and `ready_in_simulation=false`. **Nenhuma aprovação deve ser criada ou aplicada** — nothing in this PR ever sets an approval's granted or applied flag; those stay hardcoded `false` on every upstream contract this engine reads, and this engine has no field of its own that could represent a granted approval.

## Memória e continuidade

The engine never reclassifies memory — it reads only `memory_selection_decision_reference`'s `operational_flags` (from PR #94's minimal reference) and `planning_result_reference`'s own `memory_preserved`/`continuity_preserved`/`project_state_preserved` flags. A hard `decision=BLOCKED` on the memory reference always produces `MEMORY_BLOCKED`; anything else that fails — required memory, preferences, project state, continuity, pending tasks, or applicable decisions not preserved — produces the single resolvable `WAITING_MEMORY_REFERENCE` / `REQUEST_MEMORY_RESELECTION` outcome (there is no separate `CONTINUITY_BLOCKED`/`PREFERENCE_BLOCKED` *status*, even though those exist as distinct `blocker_type` values for diagnostic granularity — matching the precedent PR #94 itself set for memory/continuity).

## Contexto

Only checked when the plan actually references context (`planning_result_reference.context_reference_ids` non-empty). A hard `decision=BLOCKED` produces `CONTEXT_BLOCKED`; `operational_flags.assembly_planned !== true`, or any non-empty `blockers` on the reference itself, produces `WAITING_CONTEXT_REFERENCE` / `REQUEST_CONTEXT_REASSEMBLY`. **Não montar contexto novamente** — nothing in this engine assembles anything; it only reads the three already-forced-false flags (`context_assembled`, `content_loaded`, `prompt_generated`) that PR #87's contract guarantees.

## Modelo

Accepts exactly `NO_LLM_SELECTED_SIMULATION` and `MODEL_SELECTED_SIMULATION`. `decision=BLOCKED` produces `MODEL_BLOCKED`; a status outside those two, or a non-empty `blockers` list on the reference, produces `WAITING_MODEL_REFERENCE` / `REQUEST_MODEL_RESELECTION`. **Não escolher outro modelo** — the engine never selects a model; when a low-cost model was already selected, that selection (its `reference_id` and `selected_cost_tier`) passes straight through into the result unchanged. `decision_policy.allow_no_llm`/`allow_model_reference` gate whether either path is even acceptable to this particular decision policy.

## Tools

Checked only when the plan selected tools. Every required tool id must have a matching, non-`BLOCKED` reference with an empty `blockers` list and `side_effect_free=true`; otherwise `TOOL_BLOCKED` (missing or hard-blocked) or `WAITING_TOOL_REFERENCE` / `REQUEST_TOOL_REVIEW` (needs review). **Não selecionar nem executar ferramenta** — this engine has no tool-selection logic at all, only presence/blocked/review checks.

## Workflow

Checked only when the plan selected a workflow. Same blocked/review split as tools, using `WORKFLOW_BLOCKED` / `WAITING_WORKFLOW_REFERENCE` / `REQUEST_WORKFLOW_REVIEW`. **Não alterar workflow.**

## Budget

**Superseded by PR #96.** The engine no longer trusts a loose `planning_result_reference.budget_validated` flag as proof. `orchestrator-decision-request.js` now carries a mandatory `budget_evidence_reference` (see `HERMES_ORCHESTRATOR_DECISION_EVIDENCE_REFERENCES.md`), and the engine reads exclusively `budget_evidence_reference.evidence_status`/`.budget_validated`: not `VALIDATED_SIMULATION`/`true` with `planning_result_reference.plan_generated=true` produces the resolvable `WAITING_BUDGET_REFERENCE` / `REQUEST_BUDGET_REVIEW`; the same with `plan_generated=false` (no plan exists at all to review) produces the hard `BUDGET_BLOCKED`. A loose `planning_result_reference.budget_validated=true` claim that disagrees with the evidence is always ignored. **Não aumentar orçamento automaticamente** — nothing here changes any budget value.

## Dependências

**Superseded by PR #96.** Cycle/self-dependency/missing-dependency/duplicate-dependency detection has moved to `dependency_evidence_reference` (built from a declarative `dependencyRecords` side-channel at evidence-construction time, not at decision time). The engine reads exclusively `dependency_evidence_reference.evidence_status`/`.dependency_graph_valid`; anything other than `VALIDATED_SIMULATION`/`true` is `DEPENDENCY_BLOCKED` — there is no resolvable "waiting" status for dependencies once evidence is mandatory (`WAITING_DEPENDENCY_REFERENCE` remains a legal `DecisionResult` enum value for backward compatibility but is structurally unreachable from this evidence-only path). An inconsistency between `planning_result_reference.dependency_ids` and `orchestration_plan_reference.dependency_ids` — the same plan described two different ways — is still checked separately and is also `DEPENDENCY_BLOCKED`.

## Conflitos

**Superseded by PR #96.** Conflict detection has moved to `conflict_evidence_reference`. The engine reads exclusively `conflict_evidence_reference.evidence_status`/`.conflicts_resolved`; anything other than `NO_CONFLICT_SIMULATION`/`true` is `CONFLICT_BLOCKED` — there is no resolvable "waiting" status for conflicts once evidence is mandatory (`WAITING_CONFLICT_RESOLUTION` remains a legal `DecisionResult` enum value for backward compatibility but is structurally unreachable from this evidence-only path).

## Registry

`orchestrator-decision-registry.js` provides seven independent, in-memory, synthetic entity stores (decision requests, planning result references, orchestration plan references, decision policies, blockers, readiness records, decision results) reusing the exact `resolveRegistration` precedence from every prior PR's registry (replay, payload mismatch, optimistic-concurrency version conflict, fingerprint conflict, version downgrade, tenant/organization rebinding protection, deep freeze, defensive clone). Only the decision request and orchestration plan reference stores carry version fields.

## Auditoria

`orchestrator-decision-audit.js` records only: every fingerprint (request, planning result, plan, policy, memory, context, model, each tool, workflow, each blocker, readiness, and the result itself), tenant/organization/project/agent bindings, status/decision/next_state, blocking/warning/critical counts, the readiness score, reason codes, logical sequence, and the three simulation-safety flags. It never records stage content, tool parameters, or model responses.

## Limitações

- **Budget, dependency, and conflict checks now depend on PR #96's evidence references, not this PR's own contract fields.** See `HERMES_ORCHESTRATOR_DECISION_EVIDENCE_REFERENCES.md` for the full evidence contract, the loose-flag problem it solves, and the resulting structural unreachability of `WAITING_DEPENDENCY_REFERENCE`/`WAITING_CONFLICT_RESOLUTION`.
- **The two orderings in the specification are reconciled by treating the numbered evaluation order as authoritative** where they disagree (memory before policy) — see "Ordem de avaliação" above.
- **No cross-reference content resolution.** Like every prior orchestrator PR, this engine checks tenant/organization/agent/project/session consistency and blocked-vs-not status, never that a referenced entity's content actually exists in a real store.

**A próxima etapa arquitetural é o Execution Authorization Boundary.**
