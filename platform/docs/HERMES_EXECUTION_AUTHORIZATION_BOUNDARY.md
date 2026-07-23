# Hermes Agent Core - Execution Authorization Boundary

## Objetivo

This PR defines the Execution Authorization Boundary: a deterministic engine (`execution-authorization-boundary.js`) that consumes the already-produced decision from the Agent Orchestrator Decision Engine (PR #95), the readiness evidence bundle from Orchestrator Decision Evidence References (PR #96), an authorization policy, an actor's identity/role, an authorization scope, declarative approval and budget references, and a logical expiration evaluation — and emits a simulated decision about whether *authorization for a future execution* should be granted.

**AUTHORIZED_SIMULATION representa apenas uma autorização declarativa para uma futura referência de execução. Nenhuma execução é iniciada ou autorizada operacionalmente.**

## Readiness, decisão e autorização: três camadas distintas

- **Readiness** (PR #96) — consolidates budget/dependency/conflict/approval evidence plus PR #95's own domain-readiness flags into one `ReadinessEvidenceBundle`. Says "is every declarative condition satisfied."
- **Decisão** (PR #95) — interprets the plan and the evidence bundle and decides the orchestration's next state: ready, waiting on something specific, or blocked. Says "is the *plan* ready to proceed."
- **Autorização** (this PR) — interprets an already-`READY_SIMULATION` decision and an already-`READY_EVIDENCE_SIMULATION` bundle, together with actor/scope/risk/approval/budget/expiration conditions that are specific to *this* boundary, and decides whether execution *could* be authorized. Says "is this specific actor, in this specific scope, allowed to move this specific plan toward execution."

None of the three layers executes anything. `execution_authorized` is hardcoded `false` on every single decision this boundary can ever produce, including `AUTHORIZED_SIMULATION`.

**A fronteira de autorização não executa agentes, modelos, ferramentas ou workflows.**

**Execução real continuará bloqueada até uma futura Execution Gateway e um Runtime Executor explicitamente habilitados.**

## Request

`ExecutionAuthorizationRequest` (`execution-authorization-request.js`, 19 fields) carries: an `orchestrator_decision_reference` and a `readiness_evidence_bundle_reference` (both minimal mirrors of upstream contracts, described below); PR #94/#95's own `planning_result_reference`/`orchestration_plan_reference` (reused directly, not redefined); an `authorization_policy`, `authorization_scope`, `actor_context`, `approval_reference`, `budget_authorization_reference`, and `expiration_evaluation`; and the usual correlation/causation/trace/logical-sequence/registry-version/simulation-context envelope every PR since #85 has carried.

### OrchestratorDecisionReference

A minimal, 22-field mirror of PR #95's `DecisionResult` — reusing its `RESULT_STATUSES`/`RESULT_DECISIONS`/`NEXT_STATES` enums rather than redefining them, exactly like every prior PR's own `*Reference` contracts mirror their upstream full contract. `execution_authorized`, `execution_started`, and `executed` are forced `false` on every instance; the reference itself can never declare a real authorization. For this boundary to even consider `AUTHORIZED_SIMULATION`, the embedded values must jointly equal `status=READY_SIMULATION`, `decision=AUTHORIZE_PLAN_SIMULATION`, `next_state=PLAN_READY_REFERENCE`, `ready_in_simulation=true`, `approval_required=false` — checked as one unit (`isOrchestratorDecisionReady`), not field by field, so a tampered single field can never slip through.

### EvidenceBundleReference

A minimal, 38-field mirror of PR #96's `ReadinessEvidenceBundle` — drops the four embedded full evidence sub-objects, their per-evidence fingerprints, and the diagnostic `readiness_score` (this boundary only needs the consolidated `bundle_fingerprint` and the readiness flags), reusing PR #96's own `BUNDLE_STATUSES`/`DOMAIN_READY_FIELDS` enums. Same forced-`false` execution flags as above. Ready for authorization only when `bundle_status=READY_EVIDENCE_SIMULATION` and every consistency/domain-ready flag is `true` and `blocking_count=critical_count=0` (`isEvidenceBundleReady`).

## Ordem obrigatória

`evaluateExecutionAuthorizationRequest` follows the 22-step order in the spec exactly, fail-closed at every step:

1–2. request contract shape (which validates `simulation_context` as one of its own nested fields); 3. orchestrator decision status — translated 1:1 when it is also a legal boundary status, else `UNKNOWN_STATUS_BLOCKED`, else proceed only when `isOrchestratorDecisionReady` holds; 4. evidence bundle status — same translate-or-proceed pattern via `isEvidenceBundleReady`, with two extra semantic mappings (`BUDGET_EVIDENCE_BLOCKED`→`BUDGET_BLOCKED`, `CONFLICT_EVIDENCE_BLOCKED`→`CONFLICT_BLOCKED`) and a `VALIDATION_FAILED` fallback for the remaining PR #96-only statuses; 5–9. tenant/organization/agent/project/session bindings across every reference that carries them (bundle, planning result, plan, scope, actor, approval, budget); 10. `plan_id`/`planning_result_id` agreement across `orchestrator_decision_reference`, `readiness_evidence_bundle_reference`, `planning_result_reference`, `orchestration_plan_reference` — any disagreement is `PLAN_BLOCKED`; 11. `expected_registry_version` (optional `context.currentRegistryVersion`, mirroring every prior PR's registry-version check); 12. `plan_fingerprint` agreement between `planning_result_reference` and `orchestration_plan_reference`; 13. actor full verification; 14. role against the scope's `allowed_actor_roles`; 15. scope (agent/project/session/plan/actor ids, plus tool/workflow reference ids when the plan selected any); 16–17. risk and approval (interleaved, see below); 18. budget authorization; 19. logical expiration; 20–21. consolidate blockers and emit the decision; 22. produce the audit.

**A summary precedence table in the spec places `PLAN_BLOCKED` before `MISSING_EVIDENCE_BLOCKED`/`FINGERPRINT_BLOCKED`/`VERSION_BLOCKED`/`CONFLICT_BLOCKED`, while the numbered evaluation order checks the orchestrator decision (step 3) and evidence bundle (step 4) before plan consistency (step 10).** This is the same tension PR #95 and PR #96 already resolved in their own precedence tables — this PR continues that resolution: the more granular, explicitly numbered order is authoritative, since it is unambiguous about what is compared at each step, exactly as documented in `HERMES_AGENT_ORCHESTRATOR_DECISION_ENGINE.md` and `HERMES_ORCHESTRATOR_DECISION_EVIDENCE_REFERENCES.md`.

## Ator

`ActorContext` (`execution-authorization-actor-context.js`, 14 fields) reuses `ACTOR_TYPES`/`ACTOR_ROLES`/`AUTHORIZATION_STATES` from `agent-context-contract.js` (PR #85) rather than redefining them. Full verification (`isActorFullyVerified`) requires `authorization_state=APPROVED_SIMULATION` and all four of `identity_verified`/`membership_verified`/`role_verified`/`scope_verified` to be `true`, checked jointly — any single flag `false` is `ACTOR_BLOCKED`. **Nenhuma autenticação real é realizada nesta PR** — these flags are declarative inputs produced upstream (Agent Session Boundary / Agent Policy Boundary), never computed here.

## Papel e escopo

`AuthorizationScope` (`execution-authorization-scope.js`, 22 fields) is a positive allowlist: `allowed_actor_roles`, `allowed_agent_ids`, `allowed_project_ids`, `allowed_session_reference_ids`, `allowed_plan_ids`, `allowed_actor_ids`, `allowed_tool_reference_ids`, `allowed_workflow_reference_ids`, `allowed_task_types` (reusing PR #94's `TASK_TYPES`), and `allowed_risk_classifications`. **Um escopo vazio nunca concede autorização** — every one of those lists is checked with `length === 0` treated as a hard block, never as "no restriction." No entry may contain a wildcard or regex metacharacter (`WILDCARD_FREE_PATTERN`); scope matching is always exact-value inclusion, never pattern matching. `cross_tenant_allowed`/`cross_organization_allowed`/`cross_project_allowed`/`cross_session_allowed` are forced `false` on every scope this PR can construct — cross-boundary references are not supported at all yet, not even declaratively.

## Risco

Risk classifications (`RISK_CLASSIFICATIONS` in `execution-authorization-scope.js`): `LOW`, `MODERATE`, `HIGH`, `CRITICAL`, `RESTRICTED`. This 5-value enum is defined locally rather than reusing `agent-metadata-contract.js`'s `AGENT_RISK_CLASSIFICATIONS` (which only carries `LOW`/`MODERATE`/`HIGH`/`RESTRICTED` — no `CRITICAL`) because this PR's spec explicitly requires the fifth tier.

**No field in this PR's own contracts carries "the risk classification currently being authorized."** `OrchestratorDecisionReference`, `EvidenceBundleReference`, `AuthorizationScope` (which only carries the *allowed set*), and every other object in this request graph were all specified with exact, closed field lists that leave no room for it. Rather than invent a field the spec does not list — violating "não duplicar contratos" and the exact-fields discipline every prior PR has held to — the risk classification being authorized is supplied out-of-band via `context.riskClassification`, the same declarative side-channel pattern PR #95 established for `context.dependencyRecords`/`context.currentRegistryVersion` (data the engine needs but no formal contract in that PR carried). A missing or invalid value fails closed as `RISK_BLOCKED` — it is never treated as `LOW` by default.

Rules: `RESTRICTED` always blocks, unconditionally, even if present in `allowed_risk_classifications`. Any classification outside `allowed_risk_classifications` blocks. `HIGH` additionally requires the actor's role to be one of `HIGH_RISK_COMPATIBLE_ROLES` (`ADMIN`, `MANAGER`, `SUPERVISOR`) — the spec names no concrete role list for "papel... compatível," so this is a deliberate, documented judgment call, not a value taken from the spec text. `CRITICAL` additionally requires the `approval_reference` to declare an actual approval mechanism: `approval_state=NOT_REQUIRED` for a critical-risk action is itself `RISK_BLOCKED` (a critical action absolutely needs *some* declared approval path), while `PENDING`/`APPROVED_SIMULATION`/`DENIED`/`EXPIRED_LOGICAL`/`CONFLICTED` all fall through to the dedicated approval step (17) to resolve normally — so a critical-risk action with a real, still-pending approval reference produces `WAITING_APPROVAL_SIMULATION`, not `RISK_BLOCKED`.

## Aprovações

`ApprovalReference` (`execution-authorization-approval-reference.js`, 19 fields, 6 `approval_state` values: `NOT_REQUIRED`, `PENDING`, `APPROVED_SIMULATION`, `DENIED`, `EXPIRED_LOGICAL`, `CONFLICTED`) is derived deterministically from `approval_required`/`approval_type`/`approval_decision_reference_ids.length` vs `minimum_approvals`, with a narrow overridable allowlist (`DENIED`/`EXPIRED_LOGICAL`/`CONFLICTED`) for externally-verdicted outcomes no reference-counting alone could produce. `DENIED`/`EXPIRED_LOGICAL`/`CONFLICTED` are always `APPROVAL_BLOCKED`; `PENDING` produces `WAITING_APPROVAL_SIMULATION`; `NOT_REQUIRED`/`APPROVED_SIMULATION` proceed. **Nenhuma aprovação real é concedida ou aplicada** — `approval_applied` is forced `false` on every instance this PR can construct.

## Orçamento

`BudgetAuthorizationReference` (`execution-authorization-budget-reference.js`, 22 fields) derives `budget_authorization_validated` as the logical AND of `tokens_authorized_in_simulation`, `cost_authorized_in_simulation` (both computed from `estimated_plan_*` vs `maximum_authorized_*`), and all three `protected_*_reservations_preserved` flags. Missing any one of the five — an exceeded ceiling or an unpreserved reservation — is `BUDGET_BLOCKED`. **Nenhum token ou custo é consumido** — `budget_consumed` is forced `false` on every instance.

## Expiração lógica

`ExpirationEvaluation` (`execution-authorization-expiration.js`, 14 fields) uses only logical sequence numbers — never a wall clock, never a timer. `clock_accessed=false`, `timer_created=false`, `authorization_mutated=false` are forced on every instance, and the regression suite greps every module in this PR for `Date.now()`/`new Date()`/`setTimeout`/`setInterval`/`setImmediate` to enforce it structurally, not just by convention. `current_sequence` below `authorization_created_sequence` is a *validation error*, not a "not yet expired" result — a request cannot claim to be evaluated at a point in logical time before it was created. `expired_logically` is `true` only when `expiration_applicable=true` and the elapsed sequence count (`current_sequence − authorization_created_sequence`) exceeds `maximum_valid_sequences`; a logically-expired authorization is `EXPIRED_AUTHORIZATION`. This contract deliberately carries no `expiration_fingerprint` field of its own (unlike every other reference in this PR) — the spec's own exact-fields list for `ExpirationEvaluation` omits it; the `AuthorizationDecision`'s `expiration_fingerprint` is computed externally over the whole evaluation object.

## Precedência

Same mechanism as PR #95/#96: the engine's sequential, fail-closed evaluation *is* the precedence — whichever check fails first determines the returned status, and nothing downstream runs. `AUTHORIZED_SIMULATION` is only reachable after every one of the 19 substantive checks (steps 3–19, plus the final policy gate) passes. `DENY` and `UNKNOWN_STATUS_BLOCKED` are legal `status` values not present in the spec's own 19-item precedence table: `UNKNOWN_STATUS_BLOCKED` is produced by step 3/4's translation fallback (an upstream status this boundary has no equivalent for); `DENY` is produced by the final policy gate (`authorization_policy.allow_authorized_simulation !== true`) — the exact same last-step veto pattern PR #95's own engine uses.

## Registry

`execution-authorization-registry.js` provides eight independent, in-memory, synthetic entity stores (requests, policies, scopes, actors, approvals, budgets, expiration evaluations, decisions), reusing the identical `resolveRegistration`/`createEntityStore` precedence every prior PR's registry uses.

## Auditoria

`execution-authorization-audit.js` records only: every fingerprint (request, orchestrator decision, readiness bundle, plan, scope, actor, approval, budget, expiration), tenant/organization/project/session/actor bindings, `status`/`decision`/`next_state`, `blockers`, `reason_codes`, `logical_sequence`, and the three simulation-safety flags plus `executed=false`. It never records plan content, approval reference ids, budget numbers, prompts, memory, credentials, endpoints, tool parameters, or model responses.

## Limitações

- **A key-name allowlist extension was required.** Nearly every field name this PR's spec mandates (`authorization_request_id`, `budget_authorization_validated`, `authorization_scope`, `authorization_created_sequence`, …) legitimately contains the word "authorization," which the shared operational-material detector (`agent-identity-contract.js`) treats as a forbidden key token by default (to catch things like `authorization_header`/`bearer_token` shaped payloads). Sixteen exact field names, plus the two spec-mandated fixture scenario names (`expired-authorization`, `replay-authorization`), were added to `AGENT_CORE_ALLOWLISTED_KEY_NAMES` — the same mechanism that already allowlisted `authorization_state` for an earlier PR. This is a shared-file change with a wider blast radius than usual for one PR; the full existing test suite (1625 tests as of `main`) was re-run after the change and passes unchanged.
- **`HIGH_RISK_COMPATIBLE_ROLES` is a documented judgment call, not a literal spec value.** The spec says HIGH risk "exige papel e política compatíveis" without naming the compatible roles; this PR chose `ADMIN`/`MANAGER`/`SUPERVISOR`.
- **The risk classification being authorized travels via a side-channel `context` parameter, not a formal contract field**, for the same reason PR #95 used side-channels for data with no home in its own exact-fields contracts — see "Risco" above.
- **`allowed_task_types` is validated structurally (enum membership, uniqueness, ordering) but is not cross-checked against a concrete "current task type,"** because no object in this PR's request graph carries one. Unlike risk (which the spec's own fixture list requires exercising), no fixture or test in the spec requires this cross-check, so no side-channel was introduced for it.
- **No cross-reference content resolution.** Like every prior orchestrator/evidence PR, this boundary checks tenant/organization/project/session/plan consistency and status/fingerprint agreement, never that a referenced entity's content actually exists in a real store.

**A próxima etapa arquitetural é o Execution Plan Contract.**
