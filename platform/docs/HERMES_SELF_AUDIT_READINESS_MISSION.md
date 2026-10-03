# Hermes Self-Audit & Readiness Mission

Status: active mission contract
Mode: evidence-first, fail-closed
Merge authority: human only

## Objective

Make Hermes audit Hermes before granting broader operational autonomy. The audit must compare planned architecture and governance with contracts, capabilities, skills, integrations, tests, CI and proven runtime behavior.

## Evidence ladder

Every audited capability must be classified independently across:

1. planned
2. contracted
3. implemented
4. tested
5. proven_e2e
6. operational

A higher state MUST NOT be inferred from a lower state. A passing unit/contract test is not E2E proof. Existing code is not operational proof. Historical documentation is not current runtime evidence.

## Required audit outputs

The mission must produce machine-readable and human-readable evidence for:

- duplicate or semantically overlapping contracts/capabilities;
- stale or superseded contracts/docs;
- planned capabilities with no implementation;
- implementation with no governing contract;
- tests with no implementation/runtime binding;
- implementation with no meaningful tests;
- CI gates and what they actually prove;
- E2E evidence and exact revision when available;
- operational evidence and environment boundary when available;
- restrictions that remain safety requirements;
- restrictions that are historical and may be candidates for review;
- gaps ranked by dependency, risk and value.

## Autonomy levels

- A0 Observe: repository/runtime read and audit only.
- A1 Prepare: plans, evidence maps, proposed changes and simulations.
- A2 Develop: create branch, edit files, commit, run tests, inspect CI, self-correct, maintain Draft PR.
- A3 Controlled external action: only capability-scoped, environment-scoped and explicitly approved actions.
- A4 Protected authority: merge to main, production publication, financial spend, customer messaging, destructive operations, secrets/permission changes. Human authorization remains mandatory.

No audit finding may silently promote autonomy. Promotion requires evidence and an explicit authorization decision.

## Large-mission operating rule

After this audit, gaps should be grouped into coherent goal missions rather than one PR per tiny capability. Within an authorized mission Hermes may iterate autonomously:

objective -> audit -> plan -> implement -> test -> inspect CI -> correct -> repeat -> Draft PR -> evidence

Stop only at:
- protected human authorization boundary;
- missing external credential/input that cannot be derived safely;
- unresolved product decision;
- proven architectural conflict;
- mission completion.

## First autonomy canary acceptance

A canary passes only if Hermes, from one bounded objective, independently:

1. audits current state;
2. produces a plan from evidence;
3. creates an isolated branch;
4. performs a harmless real repository change;
5. tests the exact resulting revision;
6. interprets and corrects a failing test/CI when applicable;
7. creates or updates a Draft PR;
8. attaches auditable evidence;
9. stops before merge or any protected A4 action.

The canary must preserve `merge_authority:false` and `human_merge_required:true`.

## Initial evidence anchors

The audit must inspect at minimum:

- `platform/docs/PRD.md`
- `platform/docs/GOVERNANCE_CHECK_REPORT.md`
- `platform/docs/HERMES_EXECUTION_PLAN_CONTRACTS.md`
- `platform/docs/HERMES_EXECUTION_PLAN_STAGE_MANIFEST.md`
- `platform/docs/HERMES_AGENT_CORE_CONTRACTS.md`
- `platform/docs/HERMES_AGENT_ORCHESTRATOR.md`
- `platform/docs/HERMES_AGENT_POLICY_BOUNDARY.md`
- `platform/docs/HERMES_TOOL_CONTRACTS.md`
- `platform/docs/HERMES_WORKFLOW_CONTRACTS.md`
- `platform/docs/HERMES_RUNTIME_READINESS_ADMISSION_BOUNDARY.md`
- `platform/docs/audits/HERMES_AGENT_ORCHESTRATOR_READINESS.md`
- `platform/services/api/src/capabilities/registry.js`
- architecture/runtime/maintainer implementations and their tests;
- GitHub CI workflows;
- real canary evidence, including the already proven maintainer read -> branch -> edit -> exact-revision test -> Draft PR path.

## Safety invariants

Simulation-first where external side effects are unnecessary. Default deny. No invented approval, grant, credential, operational evidence or E2E proof. Secrets are referenced, never exposed. Destructive actions, spend, customer communication, production publication and merge remain protected human boundaries.
