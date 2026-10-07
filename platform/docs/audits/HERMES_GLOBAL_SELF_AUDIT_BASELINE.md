# Hermes Global Self-Audit — Baseline 2026-10-03

Revision audited: `043f2a80cf97ed1099fdf139ab0254e39fd5e13c` (main after Marketing #495).

## Inventory

The audited tree contains 135 platform documents, 691 core source files, 543 API tests, 2 GitHub workflows and 202 Marketing files.

## Proven findings

### F-001 — Core capability registry is stale (high)

`platform/services/api/src/capabilities/registry.js` declares every domain `planned` and explicitly says no capability is implemented. That statement is no longer globally true. The repository now contains a real bounded Hermes maintainer GitHub execution chain and a large implemented/tested Marketing foundation.

Action: do not use this registry alone as an operational readiness authority. Reconcile it with domain registries and runtime evidence before autonomy promotion.

### F-002 — Governance report describes a future scanner (high)

`platform/docs/GOVERNANCE_CHECK_REPORT.md` says the governance check is documentation only and does not implement a real scanner or mandatory CI gate. Therefore governance documentation cannot be treated as proof that self-audit is automated.

Action: implement an evidence-producing self-audit runner and gate before claiming autonomous governance.

### F-003 — Marketing has split truth sources (high)

The core registry calls Marketing `planned`, while `marketing/registry.yaml` declares a Marketing foundation with eight capability families and the merged #495 contains contracts, engines and tests. The Marketing registry still intentionally says `status: foundation`, `simulation_first: true`, `default_execution: deny`.

Readiness: planned=yes, contracted=yes, implemented=yes, tested=yes, proven_e2e=no for external side effects, operational=no for external side effects.

### F-004 — Maintainer GitHub workflow has stronger evidence than legacy planning text (critical provenance)

The bounded maintainer path has real staging evidence from canary attempt 13: repository read -> real branch -> harmless real edit -> test exact edited revision -> real Draft PR. PR #528 then passed CI and was merged by a human. Exact edited revision: `a5dcd628e0562d52f12ee811a4aeaa9205ead5da`; merge: `a677b179b6f44f11c232bef63b102d8b03298cbe`.

This proves a scoped operational capability. It does NOT prove unrestricted execution, production authority or merge authority.

### F-005 — Execution-plan documentation contains historical next-step language (medium)

`HERMES_EXECUTION_PLAN_STAGE_MANIFEST.md` still contains historical statements such as “next stage should not be Execution Gateway yet”. These are useful provenance but are not current roadmap authority after later maintainer execution work.

Action: classify historical PR-era docs separately from current normative contracts instead of deleting provenance.

## Readiness baseline

| Capability | Planned | Contracted | Implemented | Tested | E2E proven | Operational |
|---|---|---|---|---|---|---|
| Hermes maintainer / GitHub bounded workflow | yes | yes | yes | yes | yes | yes, staging/scoped |
| Marketing foundation | yes | yes | yes | yes | simulation/integrated only | no external execution |
| Automated global self-audit | yes | yes | no | no | no | no |
| Core business domains (compras/financeiro/treinamento) | yes | partial/unknown | not proven by this audit | not proven | no evidence | no evidence |

“Unknown/not proven” is intentional: absence of evidence in this baseline is not evidence of absence.

## Priority mission groups

1. **Self-audit automation:** turn this baseline into a deterministic evidence collector and CI-readable report.
2. **Authority reconciliation:** separate normative/current contracts from historical PR documentation and reconcile the core capability registry with domain truth sources.
3. **Readiness expansion:** inventory every domain/capability with exact contract, implementation, test, E2E and operational evidence.
4. **Autonomy canary:** only after 1–3, give Hermes one bounded mission and verify autonomous audit -> plan -> branch -> edit -> exact-revision tests -> CI correction -> Draft PR -> evidence, stopping at the human gate.

## Protected boundaries

This audit does not authorize merge, production publishing, financial spend, customer messaging, destructive operations, or secrets/permission changes. Those remain human/protected boundaries.
