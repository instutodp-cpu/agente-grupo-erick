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

Actual runner execution is fail-closed unless that preflight succeeds and the existing official canary/admission execution guard also accepts the same canary and admission. This closes the direct legacy runner path in which a syntactically valid canary plus durable admission could reach the runtime without first passing the A3 eligibility boundary.

The existing operational admission composition is also upgraded to v2 and re-evaluates the complete A3 eligibility input **before** durable authorization-consumption or attempt-ownership persistence. The legacy three-argument admission path therefore blocks before Postgres is touched. Eligible target SHA, branch, repository, base reference, intent digest and authorization reference must match the same official grant/canary chain.

These two bindings close the direct admission and canary-runner bypasses without creating a parallel authorization stack. A successful admission may prepare the already-existing durable request, but does not itself call GitHub; actual provider/network/write remain behind the execution guard and explicit A3 human boundary.

## Trusted E2E binding

A later audit found one additional legacy route: the trusted E2E safe-workflow composition still wired `create_branch` directly to `hermes_maintainer_github_durable_write_runtime_composition_v1`. That runtime accepted a valid durable admission but did not know about the A3 eligibility contract.

The trusted E2E path is therefore hardened as follows:

- `hermes_maintainer_trusted_e2e_operational_input_builder_v2` requires the complete branch A3 eligibility input and runs the official admission-v2 preflight with it;
- `hermes_maintainer_trusted_e2e_operational_preparation_v2` passes that same A3 input into the official durable admission v2 before workflow preparation;
- `hermes_maintainer_trusted_e2e_canary_workflow_preparation_v2` preserves the exact A3 eligibility input and canary in the branch mutation context;
- the safe-workflow execution-boundary handoff now identifies `hermes_maintainer_github_write_canary_runtime_runner_v2` as the only official `create_branch` runtime for this path;
- the execution invocation fails closed with `A3_EXECUTION_CONTEXT_REQUIRED` before runtime invocation if the A3 input or canary is absent;
- `hermes_maintainer_trusted_e2e_runtime_composition_v2` uses the official A3 canary runner rather than the legacy direct durable-write runtime;
- final E2E readiness trusts only trusted-runtime composition v2, so the legacy v1 composition cannot regain readiness by compatibility fallback.

Update-file and Draft PR execution remain on their existing official bounded runtimes. This change does not run the trusted E2E canary, does not resolve a provider credential, does not call GitHub through the runtime, does not consume real single-use authority, and does not promote A3.

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
- `platform/services/api/src/runtime/hermes-maintainer-github-write-operational-admission-composition.js`
- `platform/services/api/test/hermes-maintainer-github-write-operational-admission-composition.test.js`
- `platform/services/api/src/runtime/hermes-maintainer-trusted-e2e-operational-input-builder.js`
- `platform/services/api/src/runtime/hermes-maintainer-trusted-e2e-operational-preparation.js`
- `platform/services/api/src/runtime/hermes-maintainer-trusted-e2e-canary-workflow-preparation.js`
- `platform/services/api/src/runtime/hermes-maintainer-trusted-e2e-runtime-composition.js`
- `platform/services/api/src/core/hermes-maintainer-safe-workflow-execution-boundary-handoff.js`
- `platform/services/api/src/core/hermes-maintainer-safe-workflow-execution-invocation.js`
- `platform/services/api/test/hermes-maintainer-trusted-e2e-operational-input-builder.test.js`
- `platform/services/api/test/hermes-maintainer-trusted-e2e-operational-preparation.test.js`
- `platform/services/api/test/hermes-maintainer-trusted-e2e-canary-workflow-preparation.test.js`
- `platform/services/api/test/hermes-maintainer-trusted-e2e-runtime-composition.test.js`
- `platform/services/api/test/hermes-maintainer-safe-workflow-execution-invocation.test.js`
- `platform/docs/audits/HERMES_READINESS_MAP.json`
