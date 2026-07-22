# Hermes Agent Core — Agent Orchestrator Readiness

Companion to `platform/docs/audits/HERMES_INTEGRATION_ARCHITECTURE_AUDIT_79_89.md`. This document does not implement the Agent Orchestrator — it defines the contract the Orchestrator must honor once a future PR builds it, based on what PRs #79–#89 actually provide today.

> **Update (PR #91):** the `agent-registry.js`/`agent-policy-registry.js` `expected_fingerprint`/`FINGERPRINT_CONFLICT` gap noted in §1 below has been fixed — see `platform/docs/audits/HERMES_REGISTRY_FINGERPRINT_CONFLICT_FIX.md`. All 9 registries now support `expected_fingerprint` uniformly.

## 1. Dependências Permitidas

The Orchestrator MAY depend on:

- Every `validate*`/`build*` export from the 77 contract-bearing files across Agent Core, Agent Policy, Agent Session, Agent Memory, Model Provider, Model Selection, Context Assembly, Tool, and Workflow domains.
- Every `evaluate*` engine function: `evaluateModelSelectionRequest` (`model-selection-engine.js`), `evaluateContextAssemblyRequest` (`context-assembly-engine.js`), and the boundary evaluators in `agent-policy-boundary.js`/`agent-session-boundary.js`/`agent-memory-decision.js`.
- Every `create*Registry()` factory across the 9 in-scope registries, called once per Orchestrator instance (never at module scope — see §4). Note one remaining confirmed asymmetry: `model-provider-registry.js` has no `registerDecision`/`getDecisionById` pair at all, unlike the other 8 domains. (The `agent-registry.js`/`agent-policy-registry.js` `expected_fingerprint` gap noted here previously was fixed in PR #91 — see the update note above.)
- The shared kernel: `agent-identity-contract.js` (`stablePayload`, `cloneFrozen`, `exactFields`, `findAgentCoreOperationalMaterial`) and `read-only-adapter-contract.js`.

## 2. Dependências Proibidas

The Orchestrator MUST NOT:

- Call any tool, provider, model, or network API directly, or through any adapter not yet built and reviewed for this purpose.
- Import any `node:http`/`node:https`/`node:net`/`node:fs`/`node:child_process`/`node:worker_threads`/`node:vm`, `fetch(`, `process.env`, `eval(`, `new Function(`, or dynamic `import(` — the same restriction every PR #79–89 module already honors, confirmed by this audit's architectural test.
- Bypass a `build*Decision`/`build*Result` function to construct a decision-shaped object by hand and register it directly — every registry independently re-validates and rejects this (confirmed empirically in this audit), but the Orchestrator itself must never rely on that as its primary safety mechanism.
- Auto-query any registry to resolve a reference the caller didn't explicitly supply. Every PR #79–89 engine takes all its inputs as explicit arguments; the Orchestrator must preserve this — "referências injetadas explicitamente," never implicit lookups.
- Treat `ContextAssemblyResult.assembly_planned=true` as equivalent to real content being available, or `ModelSelectionDecision.status=MODEL_SELECTED_SIMULATION` as a model actually having been called. Both remain simulation-only by construction.

## 3. Referências Mínimas de Entrada

Based on the actual field lists of `context-assembly-request.js`, `tool-decision.js`, and `workflow-decision.js`, the Orchestrator's own request shape should carry, at minimum:

| Reference | Source domain | Minimum fields the Orchestrator must carry |
|---|---|---|
| Agent contract reference | Agent Core / Session | `agent_id`, `tenant_id`, `organization_id`, `contract_status`, `lifecycle_state`, fingerprint |
| Policy decision reference | Agent Policy | `policy_status`, `allowed_in_simulation`, fingerprint |
| Session reference | Agent Session | `session_id`, `session_present`, fingerprint |
| Memory contract + retrieval reference | Agent Memory | `memory_contract_id`, `retrieval_reference_id`, tenant/org/agent/session binding fields (all four are independently cross-checked by PR #87's engine) |
| Model selection decision reference | Model Selection | **Not a direct field copy** — see §9 finding in the audit report. The Orchestrator must build an explicit adapter mapping `ModelSelectionDecision.{decision_id, status, decision, selected_provider_id, selected_model_id}` onto `ModelSelectionDecisionReference.{decision_reference_id, decision_status, decision_value, selected_provider_id, selected_model_id, decision_fingerprint}` — there is no single field on the real decision literally named `decision_fingerprint`; one of the five existing fingerprint fields (or a fresh `stablePayload(decision)`) must be chosen deliberately. |
| Context assembly result | Context Assembly | `context_package_reference_id`, `plan_fingerprint`, `assembly_planned`, `total_allocated_tokens`, `remaining_context_tokens`, blockers/reason_codes. If step-level content sizing matters, the Orchestrator must also carry the separate `plan` object (`ordered_section_ids`, per-section allocation) — `evaluateContextAssemblyRequest` returns `{result, plan, sections}` as three separate values; only `result` is typically registered/audited, so **explicitly decide whether the Orchestrator needs `plan` too**, and pass it through, since nothing rebuilds it from `result` alone. |
| Tool reference | Tool Contracts | `tool_id`, `category`, `capabilities` (from the decision, not re-derived), tenant/org binding, `tool_fingerprint` |
| Workflow + step references | Workflow Contracts | `workflow_id`, `step_references`, per-step `step_type`/`required_capabilities`/`depends_on`/`approval_required`, tenant/org binding, `workflow_fingerprint`, `step_fingerprints` |

## 4. Formato Recomendado de Resultado

Mirror the established 4-part shape used by every decision-bearing domain: `status` (an enum whose blocked variants are specific: `TENANT_BLOCKED`, `ORGANIZATION_BLOCKED`, `VALIDATION_FAILED`, plus domain-specific ones), `decision` (a 2-value enum: the "proceed" value or `BLOCKED`), `blockers`/`reason_codes` (arrays of short machine-readable strings, never prose, never raw content), and the full set of forced-false execution flags (`executed`, `runtime_enabled`, `network_used`, `tool_called`, `model_called`, `provider_called`, plus any new domain-specific ones the Orchestrator introduces) spread **last** in every construction path, exactly like all 8 existing `build*Decision`/`build*Result` functions. Do not invent a fifth shape — reuse this one.

## 5. Ordem de Avaliação

Based on the ordered pipelines already implemented in `context-assembly-engine.js` (10-step) and `workflow-decision.js` (validate → structural checks → cross-tenant checks), the Orchestrator's own evaluation order should be:

1. Validate every input reference's own contract shape (fail closed on the first invalid one — don't attempt cross-checks against a structurally invalid reference).
2. Verify tenant/organization/agent/session consistency across every reference, in the same "whole-request blocks" style used throughout PRs #87–89 (a mismatch blocks the whole orchestration attempt, never silently drops one reference).
3. Verify policy allows proceeding (`policy_status !== DENY`, `allowed_in_simulation === true`) — this must run **before** any cost/budget evaluation, matching Context Assembly's own ordering ("políticas sempre prevalecem sobre score").
4. Verify the model selection decision is in an acceptable status (`NO_LLM_SELECTED_SIMULATION` or `MODEL_SELECTED_SIMULATION`) before consuming its output.
5. Verify the context assembly result status is `ASSEMBLY_PLANNED_SIMULATION` before treating any section/source as available.
6. Verify every referenced tool is `TOOL_REGISTERED_SIMULATION` and that its declared `capabilities` are a superset of the workflow step's `required_capabilities` — **this cross-check does not exist anywhere in PRs #88–89 today** and must be added by the Orchestrator itself (see the audit report §9).
7. Verify the workflow decision is `WORKFLOW_REGISTERED_SIMULATION`, then separately walk every step's `approval_required` flag — a `WORKFLOW_REGISTERED_SIMULATION` status alone does **not** mean "clear to proceed without human sign-off" (confirmed finding, see the audit report and `test/hermes-integration-architecture-audit.test.js`).
8. Only after all six prior checks pass, produce the Orchestrator's own declarative plan — still never executing anything.

## 6. Invariantes

The Orchestrator's own output must satisfy every invariant every existing domain already satisfies, forced unconditionally regardless of input: `simulation=true`, `production_blocked=true`, `executed=false`, `runtime_enabled=false`, plus every execution-shaped flag relevant to what it composes (`agent_executed`, `workflow_executed`, `step_executed`, `tool_called`, `provider_called`, `model_called`, `network_used`, `memory_read`, `memory_written`, `history_loaded`, `content_loaded`, `prompt_generated`, `tokens_consumed`, `cost_consumed`, `fallback_executed`, `escalation_executed`) forced `false`. This audit's architectural test (`test/hermes-integration-architecture-audit.test.js`) already proves every existing builder honors this under adversarial override attempts — the Orchestrator's own builder must pass the identical style of probe before merge.

## 7. Responsabilidades

The Orchestrator is responsible for:
- Composing already-validated references from all 9 domains into one coherent plan.
- Detecting and blocking on tenant/organization/agent/session inconsistency across the composed references (no existing engine does this end-to-end across all 9 domains — each engine only checks the references it directly receives).
- Cross-validating Tool/Model/Context references embedded in Workflow steps against the actual registered entities (§5 item 6) — none of PRs #87–89 do this today, by design.
- Aggregating `approval_required`/`human_review_required` signals that are currently scattered as boolean metadata on Workflow steps and Model Selection task profiles into one clear "needs human sign-off" summary.
- Producing one deterministic, frozen, fingerprint-bearing declarative plan — never executing any part of it.

## 8. Não Responsabilidades

The Orchestrator is explicitly **not** responsible for, and must not attempt:
- Calling any tool, model, or provider.
- Loading real memory, history, documents, or tool results.
- Generating a real prompt or consuming real tokens/cost.
- Running retries, timeouts, compensations, or approvals — it only plans around their declared metadata.
- Re-implementing validation already performed by an upstream contract (e.g., re-checking a `Workflow`'s own field shape — that's `workflow-contract.js`'s job; the Orchestrator only cross-checks *between* already-valid objects).

## 9. Checklist de Implementação

- [ ] Reuse `stablePayload`/`cloneFrozen`/`exactFields`/`findAgentCoreOperationalMaterial` from `agent-identity-contract.js` — do not reimplement.
- [ ] Reuse the `createEntityStore` registry pattern (§7 of the architecture audit) for the Orchestrator's own registry, if one is needed — don't invent a 10th variant.
- [ ] Write the explicit `ModelSelectionDecision` → `ModelSelectionDecisionReference` adapter (§3 above) as a named, tested function — don't inline it ad hoc at every call site.
- [ ] Add the Tool-capability-vs-Workflow-step-required-capabilities cross-check (§5 item 6) — currently absent everywhere.
- [ ] Add the approval/human-review aggregation step (§5 item 7, §7) — currently absent everywhere.
- [ ] Force every execution-shaped flag `false` with the safe-flags object spread **last** in every construction path, including the validation-failure/degrade path — verified by an adversarial-override test before merge, matching this audit's own test style.
- [ ] Add an architectural regression test (extending `test/hermes-integration-architecture-audit.test.js` or a new sibling file) asserting the Orchestrator module itself introduces no new circular dependency and imports no forbidden runtime API.
- [ ] Register the new test file in `package.json`'s `test` script.

## 10. Matriz Mínima de Testes

Per the audit spec's §13, the next PR must cover at minimum:

happy path declarativo · NO_LLM · modelo econômico · policy deny · tenant mismatch · organization mismatch · session blocked · memory blocked · model selection blocked · context blocked · tool blocked · workflow blocked · approval required (pending human sign-off, not a decision-status block — see §5 item 7) · fingerprint mismatch · version conflict · replay · idempotência · invariantes de não execução (adversarial override probe on the Orchestrator's own builder, mirroring `test/hermes-integration-architecture-audit.test.js`'s existing pattern for all 8 current decision builders).

Ten of these scenarios are already proven composable today, using only existing PR #79–89 code with no Orchestrator implementation, in `test/hermes-integration-architecture-audit.test.js` and reproduced in the audit report's §4 (Fluxo Declarativo Ponta a Ponta) — the next PR can lift these directly as its starting fixtures rather than re-deriving them.
