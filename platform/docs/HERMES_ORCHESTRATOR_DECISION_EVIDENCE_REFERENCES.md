# Hermes Agent Core - Orchestrator Decision Evidence References

## Objetivo

This PR replaces the Agent Orchestrator Decision Engine's (PR #95) conceptual dependency on unbound auxiliary flags — a loose `planning_result_reference.budget_validated` boolean, and side-channel context parameters like `dependencyRecords`/`unresolvedConflictIds`/`resolvableConflictIds` — with declarative, minimal, versioned, fingerprinted, immutable, auditable evidence references. Evidence represents exclusively four conditions: budget, dependencies, conflicts, and approvals. A fifth contract, the readiness evidence bundle, consolidates the four plus the domains PR #95 already owns (policy, memory, preferences, project state, continuity, context, model, tools, workflow) into one declarative snapshot.

**Uma decisão só pode confiar em condições representadas por evidências mínimas, versionadas e fingerprintadas.**

**Flags auxiliares não vinculadas a uma referência de evidência não constituem prova suficiente para autorização futura.**

**Esta implementação não autoriza nem inicia execução real.**

## O problema da flag solta

Before this PR, `budget_validated=true` on `planning_result_reference` was trusted at face value by the Decision Engine — a single boolean, produced upstream by PR #94's Planner, with no fingerprint tying it to the specific budget computation that produced it, no version, no explicit binding beyond whatever `planning_result_reference` itself carried. Anyone constructing (or corrupting) a `DecisionRequest` payload could set that one field to `true` regardless of whether the underlying budget numbers actually supported it. The same was true of the two side-channel `context.*` parameters for dependencies and conflicts: entirely caller-supplied, never validated, never fingerprinted, trivially forgeable.

This PR's mandatory principle: every condition used to produce a decision must be explicitly referenced, versioned, fingerprinted, bound to tenant, bound to organization, bound to the plan, bound to the planning result, immutable, and auditable. A loose flag outside a fingerprinted reference is never sufficient proof.

## As quatro evidências

Each evidence type is a `build*EvidenceReference(input)` function that *derives* its own `evidence_status` deterministically from the inputs it is given — it never accepts an arbitrary caller-supplied status for the domain-specific outcome. A small, explicit `overridableStatuses` allowlist exists on every evidence type so a caller can attach a genuinely *upstream* problem (a stale version, a tampered fingerprint, an unrelated conflict) without being able to force the domain-derived outcome itself (e.g. `VALIDATED_SIMULATION` can never be forced over an actually-over-budget computation).

### Budget (`orchestrator-budget-evidence-reference.js`)

29 fields. Computes `tokens_within_limit`, `cost_within_limit`, and `protected_reservations_within_limit` from `maximum_total_tokens`/`estimated_total_tokens`, `maximum_total_cost_minor_units`/`estimated_total_cost_minor_units`, and the sum of `reserved_memory_tokens`+`reserved_context_tokens`+`reserved_output_tokens` against `maximum_total_tokens`. `budget_validated` is the logical AND of all three. `evidence_status` is `VALIDATED_SIMULATION` when `budget_validated`, else `BUDGET_BLOCKED` (or one of the 4 overridable non-derived statuses: `VERSION_BLOCKED`, `FINGERPRINT_BLOCKED`, `CONFLICT_BLOCKED`, `VALIDATION_FAILED`). `budget_consumed` is always `false` — evidence records a computation, it never spends anything.

### Dependency (`orchestrator-dependency-evidence-reference.js`)

22 fields. Reuses PR #94's `hasDependencyCycle` over an optional `dependencyRecords` side-channel (full `{from_stage_id, to_stage_id}` objects, supplied at evidence-construction time — the minimal `dependency_ids` list alone cannot carry graph shape) to detect `cycle_detected`, `self_dependency_detected` (an edge from a stage to itself), `missing_dependency_detected` (an edge referencing a stage id outside `stage_ids`), and `duplicate_dependency_detected`. `dependency_graph_valid` is true only when none of the four are set. `evidence_status` is `CYCLE_BLOCKED` specifically for a cycle, `DEPENDENCY_BLOCKED` for any other graph defect, else `VALIDATED_SIMULATION`. `dependency_validation_executed` is always `true` and `dependency_applied` is always `false`.

### Conflict (`orchestrator-conflict-evidence-reference.js`)

29 fields, including 12 domain-specific `*_conflict_detected` flags (tenant, organization, project, session, fingerprint, version, policy, memory, context, model, tool, workflow). `unresolved_conflict_detected` is true if the caller sets it directly or if *any* of the 12 domain flags is true. `conflicts_resolved` is its exact negation. `evidence_status` is `CONFLICT_BLOCKED` when unresolved, else `NO_CONFLICT_SIMULATION` — this evidence type has no "waiting to be resolved" status; a conflict is either present or it is not.

### Approval (`orchestrator-approval-evidence-reference.js`)

23 fields. Reuses PR #94's `ACTOR_ROLES` and `APPROVAL_TYPES`. Three-branch derivation: not required at all → `NO_APPROVAL_REQUIRED_SIMULATION`; required but `approval_type='NONE'` → `APPROVAL_BLOCKED` (a required approval with no declared approval mechanism is a hard block, not a wait); required with enough `approval_reference_ids` to meet `minimum_approvals` → `APPROVAL_REFERENCE_VALIDATED_SIMULATION` with `approval_granted=true`; otherwise → `WAITING_APPROVAL_SIMULATION`. `approval_applied` is always `false` — evidence records references to approvals, it never applies one.

## O Readiness Evidence Bundle

`orchestrator-readiness-evidence-bundle.js` (51 fields) embeds all four full evidence sub-objects — each nullable, since a bundle representing `MISSING_EVIDENCE_BLOCKED` must be able to say "this evidence is genuinely absent" without that absence itself being a validation error. `DOMAIN_READY_FIELDS` (13 fields) splits into two groups: `budget_ready`/`dependencies_ready`/`conflicts_ready`/`approval_ready` are *derived* directly from the embedded evidence objects' own `evidence_status` fields; the remaining 9 (`policy_ready`, `memory_ready`, `preferences_ready`, `project_state_ready`, `continuity_ready`, `context_ready`, `model_ready`, `tools_ready`, `workflow_ready`) are caller-supplied pass-through booleans, since those domains remain PR #95's Decision Engine's own responsibility and have no evidence contract of their own in this PR.

`bundle_status` derivation order: missing evidence → `MISSING_EVIDENCE_BLOCKED`; inconsistent bindings → `BINDING_BLOCKED`; inconsistent versions → `VERSION_BLOCKED`; inconsistent fingerprints → `FINGERPRINT_BLOCKED`; unresolved conflict → `CONFLICT_EVIDENCE_BLOCKED`; over-budget → `BUDGET_EVIDENCE_BLOCKED`; invalid dependency graph → `DEPENDENCY_EVIDENCE_BLOCKED`; waiting approval → `WAITING_APPROVAL_EVIDENCE`; everything ready → `READY_EVIDENCE_SIMULATION`; anything else → `VALIDATION_FAILED`. `overall_ready_in_simulation` is forced `false` the instant `blocking_count`/`critical_count` is above zero or any consistency/domain-ready flag is false, structurally mirroring PR #95's own `OrchestratorReadiness` invariant. `readiness_score` (`computeReadinessScore`) is a deterministic, floatless, integer 0–100 diagnostic (7 points off per not-ready domain, 5 per inconsistency, 2 per warning capped at 10) — purely diagnostic, never authoritative. `evidence_evaluated=true`, `execution_authorized=false`, `execution_started=false` are fixed on every bundle.

## Validação consolidada (`orchestrator-decision-evidence-validator.js`)

`evaluateDecisionEvidence(input)` runs, in order: (1–2) presence and structural validity of all four evidences; (3–4) `planning_result_id`/`plan_id` consistency across all four; (5–6) tenant/organization bindings on all four, plus project/session bindings specifically on budget and approval evidence (the only two evidence types that carry those fields); (7) an optional caller-supplied `expectedRegistryVersion`/`currentRegistryVersion` check; (8) fingerprint tamper detection — each evidence's own fingerprint is recomputed (by destructuring out `evidence_fingerprint` and hashing the rest via `stablePayload`, never by trusting the stored value) and compared against what the evidence itself declares. The first failure at any step short-circuits with the corresponding `bundle_status` and a `null` placeholder for genuinely-not-yet-available evidence. Once every step passes, the full `ReadinessEvidenceBundle` is built and returned. This module never alters a decision, re-evaluates budget, recomputes dependencies beyond the declarative data already on the evidence references, resolves a conflict, grants an approval, or authorizes execution.

## Integração com o Decision Engine (PR #95)

`orchestrator-decision-request.js` grew from 19 to 24 fields: `budget_evidence_reference`, `dependency_evidence_reference`, `conflict_evidence_reference`, `approval_evidence_reference`, and `readiness_evidence_bundle_reference` are all mandatory (non-nullable) on the request contract — a request missing any one of them fails `validateOrchestratorDecisionRequest` before the engine ever runs.

`orchestrator-decision-engine.js` was updated to:
- Run `evaluateDecisionEvidence` immediately after the existing tenant/organization/agent/project/session binding checks (before the plan/version/fingerprint checks) and block with `MISSING_EVIDENCE_BLOCKED`, `VALIDATION_FAILED` (for `BINDING_BLOCKED`), or `FINGERPRINT_BLOCKED` accordingly.
- Read budget exclusively from `budget_evidence_reference.evidence_status`/`.budget_validated` — the old `planning_result_reference.budget_validated` flag is never consulted again. A loose `true` claim there that disagrees with the evidence is always ignored (verified directly by the `loose-flag-does-not-override-evidence` test case).
- Read dependencies exclusively from `dependency_evidence_reference.evidence_status`/`.dependency_graph_valid` — the old `context.dependencyRecords`/`context.pendingDependencyReviewIds` side-channel parameters no longer drive any outcome.
- Read conflicts exclusively from `conflict_evidence_reference.evidence_status`/`.conflicts_resolved` — the old `context.unresolvedConflictIds`/`context.resolvableConflictIds` side-channel parameters no longer drive any outcome.
- Cross-check `approval_evidence_reference.approval_required` against the Planner's own approval signal (`planning_result_reference.status === 'APPROVAL_REQUIRED_SIMULATION'` or non-empty `approval_stage_ids`), blocking with `APPROVAL_BLOCKED` on any mismatch or on `evidence_status === 'APPROVAL_BLOCKED'`.
- Run a second, defensive `evaluateDecisionEvidence` call immediately before emitting `READY_SIMULATION` — interpreting the fully-assembled bundle with every domain-ready flag now `true` — and block with `VALIDATION_FAILED` if the bundle disagrees. This is a fail-closed re-check, not a re-derivation of anything already decided upstream.
- Preserve PR #95's existing fail-closed, sequential precedence: whichever check fails first still determines the returned status.
- Never change the meaning of `READY_SIMULATION`, and never set `execution_authorized`/`execution_started` to anything but `false` on any result this engine can produce.

`orchestrator-decision-result.js`'s `RESULT_STATUSES` grew from 28 to 29 with the addition of `MISSING_EVIDENCE_BLOCKED`, inserted into the updated precedence table immediately after `SESSION_BLOCKED` and before `FINGERPRINT_BLOCKED`:

`VALIDATION_FAILED`, `TENANT_BLOCKED`, `ORGANIZATION_BLOCKED`, `PROJECT_BLOCKED`, `SESSION_BLOCKED`, `MISSING_EVIDENCE_BLOCKED`, `FINGERPRINT_BLOCKED`, `VERSION_BLOCKED`, `CONFLICT_BLOCKED`, `POLICY_BLOCKED`, `MEMORY_BLOCKED`, `CONTEXT_BLOCKED`, `MODEL_BLOCKED`, `TOOL_BLOCKED`, `WORKFLOW_BLOCKED`, `BUDGET_BLOCKED`, `DEPENDENCY_BLOCKED`, `WAITING_APPROVAL_SIMULATION`, `READY_SIMULATION`.

**Continuing the precedent set by PR #95's own docs**: this table's ordering (which places `CONFLICT_BLOCKED` before `POLICY_BLOCKED`/`MEMORY_BLOCKED`) does not exactly match this implementation's actual sequential evaluation order, where conflict evidence is checked late (after dependencies, immediately before approval) rather than in position 9. PR #95 already established that its own numbered, item-by-item evaluation order is treated as authoritative over the coarser summary precedence table where the two disagree; this PR continues that same resolution rather than reordering a working, already-tested sequential engine to match a summary table.

## Registro (`orchestrator-decision-evidence-registry.js`)

Five independent, in-memory, synthetic entity stores (budget evidence, dependency evidence, conflict evidence, approval evidence, readiness bundles), reusing the exact same `resolveRegistration`/`createEntityStore` precedence every prior PR's registry uses: replay acceptance on an identical payload, payload-mismatch rejection on a same-version differing payload, optimistic-concurrency version conflict, fingerprint conflict, tenant/organization rebinding protection, deep freeze, and defensive clone on every read.

## Auditoria (`orchestrator-decision-evidence-audit.js`)

`buildOrchestratorDecisionEvidenceAudit(input)` records only: the four evidence fingerprints plus the bundle fingerprint plus the caller-supplied planning-result and plan fingerprints, tenant/organization/project/session bindings, an `evidence_statuses` object (one status string per evidence type, or `evidence_not_available` when genuinely absent), a `consistency_flags` object, a `counts` object (blocking/warning/critical), `bundle_status`, `reason_codes`, `logical_sequence`, and the three simulation-safety flags plus `executed=false`. It never records evidence content beyond fingerprints and status strings — no token counts, no dependency graphs, no conflict details, no approval reference ids.

## Cenários bloqueados

`MISSING_EVIDENCE_BLOCKED` (any of the four evidences absent), `BINDING_BLOCKED` surfaced as `VALIDATION_FAILED` at the Decision Engine level (tenant/organization/project/session/planning-result/plan mismatch on any evidence), `FINGERPRINT_BLOCKED` (a recomputed evidence fingerprint disagrees with the stored one — tamper detection), `VERSION_BLOCKED` (a stale `expectedRegistryVersion`), `BUDGET_BLOCKED`/`WAITING_BUDGET_REFERENCE` (budget evidence not validated), `DEPENDENCY_BLOCKED` (invalid or cyclic dependency graph), `CONFLICT_BLOCKED` (any unresolved conflict), `APPROVAL_BLOCKED` (a required-approval mismatch or a hard-blocked approval evidence).

## Limitações

- **`WAITING_DEPENDENCY_REFERENCE` and `WAITING_CONFLICT_RESOLUTION` are structurally unreachable.** Both remain legal `DecisionResult` enum values (untouched, for backward compatibility with any external consumer matching on the full enum), but neither `DependencyEvidenceReference` nor `ConflictEvidenceReference` models a resolvable "waiting" state distinct from validated-vs-blocked — both are binary per their own `evidence_status` enums (dependency has the additional `CYCLE_BLOCKED` variant, which is still a hard block, not a wait). This is a deliberate consequence of the evidence-only design: a resolvable "waiting for review" state would itself need to be evidence, fingerprinted and bound like everything else, and this PR's scope is limited to budget/dependency/conflict/approval evidence exactly as specified.
- **The precedence-table-vs-implementation-order deviation inherited from PR #95 is now compounded by this PR's own table** — see "Integração com o Decision Engine" above.
- **The 9 non-evidence domain-ready flags on the readiness bundle (policy/memory/preferences/project_state/continuity/context/model/tools/workflow) are caller-supplied pass-through booleans, not independently derived by this PR.** They remain PR #95's Decision Engine's own responsibility; this PR does not introduce evidence contracts for those domains.
- **No cross-reference content resolution.** Like every prior orchestrator PR, evidence references check tenant/organization/project/session consistency and fingerprint/version agreement, never that a referenced entity's content actually exists in a real store.

**A próxima etapa arquitetural é o Execution Authorization Boundary.**
