# Hermes Agent Core - Agent Orchestrator (Contracts)

## Objetivo

This document defines the first layer of the Hermes Agent Orchestrator: how it represents a complete orchestration request, the declarative plan produced from it, and the decision that summarizes the outcome — reusing every existing PR #79–91 reference contract, duplicating none of them.

**O Agent Orchestrator ainda não executa agentes, ferramentas, workflows ou modelos.**

## Responsabilidades

This PR is responsible for exactly three things: (1) `orchestrator-request.js` — a single object representing a complete orchestration attempt as references only; (2) `orchestrator-plan.js` — a purely declarative plan (ordered validations, decisions, references, blockers, approvals) derived from a request; (3) `orchestrator-decision.js` — a 4-status outcome summary (`PLAN_READY`, `BLOCKED`, `VALIDATION_FAILED`, `SIMULATION_ONLY`), plus a registry and an audit builder for all three. It is explicitly **not** responsible for evaluating a request into a plan — no `orchestrator-engine.js` exists in this PR. Every plan and decision in the fixtures and tests is built directly via `buildOrchestratorPlan`/`buildOrchestratorDecision`, not derived automatically from a request.

## Entradas

`OrchestratorRequest` (`orchestrator-request.js`) carries references only, reusing existing contracts verbatim rather than redefining them:

| Reference | Reused from |
|---|---|
| `agent_contract_reference` | `agent-session-reference.js` (`validateRequestAgentContractReference`, PR #81) |
| `policy_decision_reference` | `agent-session-reference.js` (`validateSessionPolicyReference`, PR #81) |
| `session_reference` | `agent-session-reference.js` (`validateRequestSessionReference`, PR #81) |
| `memory_contract_reference` | `agent-memory-request.js` (`validateMemoryContractReference`, PR #82) |
| `memory_retrieval_reference` | `agent-memory-retrieval-reference.js` (`validateRetrievalReference`, PR #82) |
| `model_selection_decision_reference` | `context-assembly-request.js` (`validateModelSelectionDecisionReference`, PR #87) |
| `context_assembly_result_reference`, `workflow_reference`, `task_reference`, `budget_reference` | `model-contract.js`'s generic `validateSingleReference` (PR #83) — the same minimal reference shape `workflow-step-contract.js` already uses for `tool_reference`/`model_reference`/`context_reference` |
| `tool_references` | `model-contract.js`'s generic `validateReferenceList` (PR #83) |
| `simulation_context` | `agent-context-contract.js` (`validateAgentSimulationContext`, PR #79) |

No field on `OrchestratorRequest` carries content, a message, or a prompt — confirmed both by the field list itself and by a dedicated test asserting none of the 20 field names resembles one.

## Saídas

`OrchestratorPlan` (`orchestrator-plan.js`) represents, and only represents: `ordered_validation_codes`, `ordered_decision_codes`, `ordered_reference_ids`, `ordered_blocker_codes`, `ordered_approval_codes` (five sorted, unique, deterministic string lists — "ordered" means canonically sorted, not insertion-order, so the same set of codes always produces byte-identical output regardless of how they were collected), `execution_plan_reference_id`, `workflow_reference_id`, `tool_reference_ids`, `model_reference_id`, `context_reference_id`. `plan_generated=true` and `plan_executed=false` are forced unconditionally.

`OrchestratorDecision` (`orchestrator-decision.js`) accepts exactly 4 status values — `PLAN_READY`, `BLOCKED`, `VALIDATION_FAILED`, `SIMULATION_ONLY` — and structurally forbids `EXECUTED`, `RUNNING`, `ACTIVE` (any attempt to construct one with a forbidden status degrades to `VALIDATION_FAILED`, confirmed by an adversarial test). Unlike the 8 pre-existing decision-bearing domains (see `HERMES_INTEGRATION_ARCHITECTURE_AUDIT_79_89.md` §6), this decision has **no separate `decision` field** alongside `status` — the audit found that split (`status`+`decision`, or `status`+`effect` in Agent Policy's case) to be a source of naming inconsistency across domains (INTEG-11/INTEG-12), and this PR's own spec never names a second field, so the simplest, most literal reading was kept: one outcome field, four legal values, with finer detail carried only in `blockers`/`reason_codes`.

## Fluxo

Since no evaluator exists yet, the "flow" this PR defines is purely the **shape** a future evaluator must produce, not the evaluation itself:

1. A caller collects references from all 9 upstream domains into one `OrchestratorRequest`.
2. A future evaluator (not built here) would validate the request, cross-check tenant/organization/agent consistency across every reference (a gap the PR #90 audit found no existing engine closes end-to-end — see `HERMES_INTEGRATION_ARCHITECTURE_AUDIT_79_89.md` §16), and produce an `OrchestratorPlan`.
3. That evaluator would summarize the outcome as an `OrchestratorDecision` — `PLAN_READY` when a plan was produced, `BLOCKED`/`VALIDATION_FAILED` otherwise, `SIMULATION_ONLY` reserved for a future simulation-preview mode not yet exercised by any code in this PR.
4. `orchestrator-registry.js` stores requests, plans, and decisions — replay-protected, fingerprint-verified, tenant/organization-isolated — exactly like every registry from `model-selection-registry.js` (PR #84) onward, including the `FINGERPRINT_CONFLICT` fix from PR #91.
5. `orchestrator-audit.js` records only fingerprints, tenant/organization/agent bindings, the workflow/tool/model-selection/context references, the decision status, and reason codes — never a payload.

## Integração

This PR reuses, without modification: `agent-session-reference.js`, `agent-memory-request.js`, `agent-memory-retrieval-reference.js`, `model-contract.js`, `context-assembly-request.js`, `agent-context-contract.js`. No contract, enum, or fingerprint from PRs #79–91 was changed. `orchestrator-request.js`/`orchestrator-plan.js`/`orchestrator-decision.js`/`orchestrator-registry.js`/`orchestrator-audit.js` import nothing from `model-selection-engine.js`, `context-assembly-engine.js`, `tool-decision.js`, or `workflow-decision.js` — confirmed by a dedicated regression test, since composing those engines' real outputs into an `OrchestratorRequest` remains a future evaluator's job, not this PR's.

## Limitações

- **No evaluator exists.** There is no `orchestrator-engine.js`, no function that takes an `OrchestratorRequest` and produces an `OrchestratorPlan`/`OrchestratorDecision` automatically. Every plan and decision in this PR's fixtures and tests is hand-built via the two `build*` functions directly.
- **No cross-reference validation.** Nothing in this PR checks that `agent_contract_reference.tenant_id` matches `memory_retrieval_reference.tenant_id`, or that `workflow_reference` resolves to an actually-registered `Workflow`. This is precisely the "tenant/organization/agent consistency across the composed references" gap the PR #90 audit found no existing engine closes end-to-end (`HERMES_INTEGRATION_ARCHITECTURE_AUDIT_79_89.md` §16) — closing it is a future PR's job, not this one's.
- **`ModelSelectionDecisionReference` still requires the adapter noted in `HERMES_AGENT_ORCHESTRATOR_READINESS.md` §3** (INTEG-01) — this PR reuses the same reference shape as `context-assembly-request.js`, so the same field-name mismatch against a real `ModelSelectionDecision` applies here too.
- **`SIMULATION_ONLY` is a legal but currently unreached status** in the sense that no code in this PR ever derives it from real input — it exists in the enum as a forward-compatible value for a future simulation-preview mode.
- There is no HTTP client, no database, no filesystem access, no real timer, no executable callback or handler, no `dynamic import`, no `eval`, and no `Function` constructor anywhere in these five modules.

## Next Steps

A future PR must add the evaluator (`orchestrator-engine.js`) that actually composes an `OrchestratorRequest` into an `OrchestratorPlan`/`OrchestratorDecision`, closing the cross-reference validation gap and the Tool/Workflow capability and side-effect cross-checks (`INTEG-04`, `INTEG-05`) identified in the PR #90 audit and its companion readiness document.
