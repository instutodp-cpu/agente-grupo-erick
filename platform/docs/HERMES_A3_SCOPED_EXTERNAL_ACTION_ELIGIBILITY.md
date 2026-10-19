# Hermes A3 Scoped External Action Eligibility

Status: A3 authorized_scoped for the proven staging maintainer SCM create_branch capability after exact-revision real canary and explicit human promotion authorization
Mode: evidence-first, fail-closed, staging-only, exact-target, single-use
Execution authority: scoped only through the official approval + authorization + single-use + durable A3 chain; no generic or wildcard authority
Merge authority: human only; A4 remains protected

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

## Two-phase durable ownership admission fix (not operational promotion)

The existing standalone `update_file` and Draft PR admissions require A3 eligibility before they persist SCM consumption and exclusive ownership. A3's original `durable_target` expected an already-proven safe-workflow ownership binding, which was unavailable to the standalone acceptance entry. Using an in-memory test fixture as if it were that persisted proof is forbidden.

This increment preserves the official human approval/grant contracts and defines a *strict pending-ownership* phase for the two candidate operations only:

1. Before any PostgreSQL consumption, validate **all existing A3 input fields except the not-yet-created durable proof**, demanding `source_evidence.durable_target=null`, a valid expiring staging single-use record, verified operator binding, exact payload digest, same real human approval/grant, bounded cost and every A4 exclusion. The admission separately binds the pending scope and payload to the exact grant and operational request. A caller-supplied ownership object is not acceptable here.
2. Consume SCM grant and create exclusive attempt ownership using the **existing durable Postgres create-if-absent adapters and official receipt/binding factories**. Reject absent, failed, ambiguous or replayed receipts.
3. Hydrate the full A3 evidence **only from that verified SCM ownership receipt**. Re-evaluate the complete A3 gate; require ownership key, attempt, consumption, authorized intent and grant reference to match. If this check fails, execution stops even if consumption has already been persisted; never roll back or reuse the one-shot authorization.
4. The official runtime v2 independently compares the returned full evidence to the original pending envelope and the actual durable admission before credential resolution/network. Missing, drifted or forged proof fails closed.
5. Legacy complete safe-workflow durable-target evidence remains compatible. This fix neither grants A3 execution to new operations nor promotes them: `update_file` and Draft PR stay `implemented_tested_unpromoted` until separately authorized real staging canaries and human promotion decisions.

Verification: `a3-durable-preownership.test.js`, `a3-durable-preownership-operational.test.js`, existing update-file/PR runners and trusted E2E tests. These tests use mocked persistence/provider dependencies and do not consume any live authorization, mutate the repository or execute the approved canary.

## Maintenance extension: A3 v3 candidate (not promoted)

The historical trusted E2E v2 notes above document the previously promoted `create_branch`-only boundary. The new **A3 v3** extension is implemented and testable but grants **no additional operational authority**.

- `update_file` and `create_pull_request` (Draft only) retain their official human approval/authorization chains, evolved to v2 with exact payload digests. The edit approval covers branch, path, prior blob SHA, content digest and commit-message digest; Draft PR approval covers base, head, draft, title and body digests. A changed byte requires new human approval.
- `hermes_a3_scoped_external_action_eligibility_v3` validates distinct official approval binding, authorization grant, staging single-use authorization, durable target and operator evidence per operation. Caller-supplied booleans and legacy artifacts cannot substitute.
- Operational admission compositions v2 re-evaluate A3 **before durable authorization consumption / PostgreSQL persistence**; runtime compositions v2 re-evaluate the same evidence and exact payload **before credential resolution or provider network**.
- Trusted E2E v3 carries three distinct A3 eligibility inputs through evidence preparation, operational preflight, admission, safe-workflow execution invocation and the final readiness gate. Missing evidence at *any* mutation fails closed.
- Update-file and Draft PR staging entries require explicit `APPROVED` and `AUTHORIZED` decisions bound to the same intent digest. Opaque references alone cannot synthesize either decision.
- `create_branch` retains its proven A3 scoped authority. The **new two operations are not E2E-proven, not operationally authorized, and not promoted** pending bounded real staging canaries and separate explicit human promotion approval.
- `autonomy.current_max_level=A3_authorized_scoped`, `autonomy.candidate=null`, and the protected A4 boundary remain unchanged. No merge authority, no production publish, and no automatic A3 extension are granted by these changes.

Evidence: `platform/services/api/test/a3-scoped-external-action-multiop.test.js`, the updated human-authorization tests, runtime tests, trusted E2E tests and `platform/docs/audits/HERMES_READINESS_MAP.json`. This PR does not perform an external write or consume live authorization.

## Promotion result

A3 is now authorized only for the capability and boundary that were actually proven: staging maintainer SCM `create_branch` through `MAINTAINER_SCM_WRITE_SINGLE_USE_V1`. This is not blanket external-action authority and does not authorize another provider, operation, environment or target family.

Promotion evidence:

- exact proven revision: `cb8580f1a0d07487410e5a5c2f27d172746b94ee`;
- real branch mutation: `refs/heads/hermes/canary/a3-create-branch-20261016-175647` created at that exact SHA;
- provider result: HTTP `201`, `GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED`;
- durable receipt: `GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED`, `receipt_valid=true`;
- E2E closure: `E2E_DURABLE_WRITE_CLOSURE_CONFIRMED`, `production_used=false`;
- exact action intent: `sha256:ccad4c4a2d54a557707d71c5caf774ffd73f5432d32f2cb1f525738c10fcc8e1`;
- human approval reference: `human-a3-canary-20261016-1845`;
- human authorization reference: `control-a3-canary-20261016-1845`;
- explicit promotion evidence digest: `sha256:b57ce125c09b9b63457f0cdab93f02c1a4ddf79f98e22295a998b711e7cb46cf`.

The promotion preserves the same per-action controls: explicit human approval and authorization, exact repository/operation/branch/base-SHA binding, staging only, expiring single-use authority, durable replay protection, and fail-closed execution. A4 remains protected: no merge authority, no production publication, no financial spend, no customer messaging, no destructive action, and no secret/permission change.

Any expansion beyond this proven A3 scope requires its own capability-specific evidence and explicit authorization; it cannot inherit authority from this promotion.

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


## Real staging `update_file` observation vs. promotion gate (2026-10-19)

The user explicitly authorized one exact staging `update_file` intent (`sha256:55bffd2fcced4099e9f08a3cf7a1a753ca50fb89a77bd7ff618fea7ce30b7a33`), and the official update-file runtime recorded HTTP 200, an expected GitHub blob and commit, one durable SCM consumption and ownership, and one matching execution outcome and finalization. The readback confirmed the branch update and unchanged `main`.

**Provenance limitation:** the one-shot VPS execution runner assembled a `hermes_maintainer_controlled_executor_v1` simulation object directly before `evaluateHermesMaintainerStagingGate`. Although the structural validator and zero-effect reconciliation passed, this is **not** independent proof that the simulation gate originated from a verified official mission run. The recorded runtime output also did not retain a mission-linked single-use authorization ID. The successful provider write and durable completion cannot retroactively create those missing source attestations.

Consequently the evidence is `real_write_and_durable_closure_confirmed_provenance_pending`, **not** automatic A3 operational promotion. Keep `proven_e2e=false`, `operational=false`, `human_promotion_authorized=false`, `candidate=null` and A4/production/merge protected. Do **not** replay the consumed authorization, reissue evidence for that historical write, or repeat the write to disguise missing provenance. Before a new qualifying canary or promotion request, require independently verifiable official staging-gate source and mission-linked single-use provenance, while retaining the existing exact scoped human authorization path.

Evidence: `platform/docs/audits/HERMES_A3_UPDATE_FILE_CANARY_20261019.json`. No new external execution or operational promotion was performed by this readiness-audit increment.


## A3 MissionRun-origin gate (fail-closed; source not connected)

The 2026-10-19 real `update_file` canary was confirmed at GitHub and in durable
PostgreSQL receipts. However, the staging-gate simulation in that one-shot
runner was assembled locally; it did **not** provide independently verifiable
MissionRun provenance. Those historical facts remain unchanged; no receipt
can be minted retroactively for that write.

This increment adds `hermes_maintainer_a3_mission_source_verification_v1` as
a hard check for **both** `update_file` and Draft `create_pull_request`
operational admission, immediately **before** consuming the authorization
or acquiring Postgres ownership. The verifier requires a read through a
server-owned `readMissionRun` dependency. It does not accept a caller's
`source_evidence` as proof and has **no default reader** or local-fixture
fallback. If the reader is missing, inaccessible, returns a different
mission/operation/branch/target, lacks the exact human grant or single-use
fingerprint, or reports a nonzero simulation effect, admission fails closed
without consuming authorization or fetching write credentials.

The returned MissionRun record must carry the exact durable status
`STAGING_SIMULATION_RECONCILED`, source `MISSION_GATEWAY_DURABLE`, matching
`mission_run_id` and `mission_id`, valid workflow operation, original
target/intent digests, approval/authorization references, single-use ID
and fingerprint, simulation receipt/workflow/authorization/gate fingerprints,
zero-effect flags, and a canonical record digest.

**Critical trust boundary:** a canonical digest verifies internal consistency,
**not** issuer authenticity. An implementation may wire `readMissionRun`
**only** to the separately authenticated authoritative Mission Gateway
record store, using server-managed credentials and a read-only interface.
No such source adapter is connected in this PR. Do not expose dependency
injection to untrusted request parameters or accept evidence manufactured
from the runner's `controlled_execution` object. This guard is deliberately
blocking in staging until that independent backing source exists; test
helpers mock it only for isolated validation and regression tests.

The existing official approval/grant, A3 v3 scoped eligibility, PostgreSQL
`CREATE_IF_ABSENT`, and update-file / Draft PR transport contracts remain
intact. `create_branch` promotion and authority are not expanded. The
readiness state stays `implemented_tested_unpromoted`, and
`proven_e2e`, `operational`, `human_promotion_authorized`, A4 and production
remain false. No new MissionRun, dispatch, provider write or merge is part
of this fix.
