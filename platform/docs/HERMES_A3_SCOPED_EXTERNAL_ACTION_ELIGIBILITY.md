# Hermes A3 Scoped External Action Eligibility

Status: implemented and tested eligibility contract v2 with exact source revision binding; A3 remains unauthorized
Mode: evidence-first, fail-closed, staging-only
Execution authority: none
Merge authority: human only

## Objective

Define the missing eligibility boundary for autonomy level A3 (`approved_scoped_external_action`) without promoting A3 and without creating a new execution or authorization stack.

This boundary answers only whether an already approved and authorized, precisely scoped staging maintainer SCM action has enough bound evidence to become an A3 candidate for a later execution boundary.

It does **not** issue approval, issue authorization, consume an authorization, resolve credentials, call a provider, use the network, persist operational state, start execution, execute an action, publish to production, or grant A4 authority.

## Initial source authority

The first supported source family is intentionally narrow: `MAINTAINER_SCM_WRITE_SINGLE_USE_V1`.

The gate consumes the existing official artifacts directly:

1. `hermes_maintainer_scm_write_approval_binding_v1` — explicit human approval bound to the SCM intent digest;
2. `hermes_maintainer_scm_write_authorization_grant_v1` — explicit SCM authorization bound to the same approval and intent;
3. `hermes_maintainer_single_use_execution_authorization_v1` — staging-only, expiring, single-use authorization validated by its existing official validator.

The three artifacts must agree on operation, repository and base reference. Approval and SCM authorization must also agree on branch and intent digest. The target supplied to A3 must match that authorized SCM target exactly. In v2, a fourth official artifact is required: `hermes_maintainer_safe_workflow_durable_target_v1`, which binds the exact `base_sha` used by the later create-branch request to the same intent/workflow evidence without invoking execution.

A generic caller object such as `{ authorized: true }`, a different source-family label, or an unsupported capability cannot become A3 evidence. Adding another capability family requires an explicit code and test change; there is no wildcard authority adapter.

## Required bindings

An eligible candidate must provide and bind:

- capability `hermes-maintainer-scm-write`;
- staging environment;
- exact operation;
- exact repository, base reference, **base SHA** and branch target, with canonical target digest;
- the official SCM intent digest from the approval/authorization chain;
- verified operator identity and scope, with operator-binding digest and source reference;
- official human approval reference;
- official SCM authorization reference;
- official single-use authorization ID and fingerprint;
- official durable target bound to the same intent, carrying the exact `base_sha`;
- single-use state: unconsumed and unrevoked;
- explicit evaluation time before authorization expiry;
- requested cost units not exceeding the explicit maximum.

Wildcard-like target selectors are rejected. Base-SHA drift, scope drift, fingerprint drift, source-chain disagreement, unknown fields and lifecycle drift all fail closed.

## A4 boundary

Every protected A4 action flag must remain false:

- merge to main;
- production publication;
- financial spend;
- customer messaging;
- destructive action;
- secret or permission change.

Any requested A4 authority blocks the candidate.

## Output semantics

A successful result is `A3_SCOPED_EXTERNAL_ACTION_ELIGIBLE` with `a3_eligible=true`.

Even on success, the gate always preserves:

- `execution_authorized=false`;
- `execution_started=false`;
- `executed=false`;
- `provider_invoked=false`;
- `external_network_called=false`;
- `production_allowed=false`;
- `a4_authority_granted=false`.

Eligibility is evidence for a later promotion/canary decision, not permission to execute.

## Preexecution binding

The staging GitHub write canary runner v2 re-evaluates the complete A3 eligibility input before the existing execution guard. It binds repository, base reference, branch, exact base SHA and action intent to the same canary and durable admission. A caller-supplied eligibility summary is never trusted as authority.

The runner exposes an inert `preflight` path. Preflight does not resolve credentials, call the network, write to GitHub, persist operational state, consume an authorization, or authorize execution. A successful preflight reports `A3_PREEXECUTION_READY` while preserving `execution_authorized=false`, `execution_started=false`, `execution_performed=false`, `network_call_performed=false` and `write_performed=false`.

Actual runner execution is now fail-closed unless that preflight succeeds and the existing official canary/admission execution guard also accepts the same canary and admission. This closes the legacy runner path in which a syntactically valid canary plus durable admission could reach the runtime without first passing the new A3 eligibility boundary.

This binding still does **not** promote A3, execute a real canary, grant production authority, or grant merge authority.

## Promotion rule

This implementation does not change the autonomy state. `A0`, `A1`, and bounded `A2` remain the only authorized levels. A3 remains protected.

A future A3 promotion requires, at minimum, capability-specific end-to-end proof on an exact revision, a bounded operational environment, durable single-use/replay evidence where applicable, and an explicit human authorization decision. Unit tests, simulation evidence and preexecution readiness alone cannot promote A3.

## Implementation evidence

- `platform/services/api/src/core/a3-scoped-external-action-eligibility.js`
- `platform/services/api/test/a3-scoped-external-action-eligibility.test.js`
- `platform/services/api/test/a3-scoped-external-action-e2e-simulation.test.js`
- `platform/services/api/src/runtime/hermes-maintainer-github-write-canary-runtime-runner.js`
- `platform/services/api/test/hermes-maintainer-github-write-canary-runtime-runner.test.js`
- `platform/docs/audits/HERMES_READINESS_MAP.json`
