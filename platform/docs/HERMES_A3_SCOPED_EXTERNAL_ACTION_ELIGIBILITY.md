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


### Located source: Maestro Pessoal / missionGateway (2026-10-19)

The authoritative **control-plane application** is Maestro Pessoal
(Base44 app `69f62cbb266971d4deeb4938`), not Hermes Insight Hub.
Its `MissionRun` entity stores `mission_id`, `idempotency_key`,
`contrato_json`, `contract_hash`, `dispatch_protocol_version`,
`emitted_by`, `issued_at`, `hermes_run_id` and `dispatch_simulado`.
The current official `base44/functions/missionGateway/router.ts` exposes
`list_runs` and `verify_integrity`; the handlers in
`run/runService.ts` call `loadMissionAndValidate` /
`loadRunAndValidate` and check `MembroEspaco` membership, while repositories
read via service role. `verify_integrity` checks the immutable Mission Contract
hash and **does not** attest A3 staging-gate execution or single-use issuance.

The currently observed MissionRun
`6ad02b2e45e512d3aeb9199a` belongs to mission
`6ad02b16cdd1db9ef55927ca`, the prior **public-web read**
(`public_web_email_canary_execution`, 2026-10-15). It must never be
reinterpreted as proof of an `update_file` or Draft PR canary.

**Integration dependency, not yet implemented:** extend the *existing*
missionGateway's authorized, server-side read surface to return independently
persisted A3 staging-gate and single-use provenance **bound to the exact
MissionRun/operation/target/approval**. Authenticated Hermes server wiring must
verify the issuer and source; a canonical SHA alone cannot prove authenticity.
Do not use Base44 entity direct reads as a runtime authority shortcut, inject
the existing public-web run into the A3 contract, or fabricate a new MissionRun.
Until the gateway exposes such evidence, `readMissionRun` remains unconfigured
and A3 `update_file` / Draft PR fail closed before consumption.

## Existing Mission Gateway read bridge (2026-10-19)

The staging Hermes A3 code now has a **read-only**, server-injected bridge
(`hermes_maintainer_maestro_missionrun_reader_v1`) for the identified
Maestro Pessoal `missionGateway`. This is an integration boundary, **not**
the missing operational proof. Given a trusted, independently authenticated
server-side `invokeMissionGateway`, it first requests the existing
`list_runs` operation, resolves one MissionRun for the requested mission,
and requires the existing `verify_integrity` contract-hash check to pass.

**Important: `verify_integrity` proves only the Mission Contract hash.**
It is not permission to write, nor does it prove a simulated staging gate
or single-use issuance. The bridge therefore requires a *separate* gateway
verification operation, `verify_a3_provenance`, bound to exactly:
`run_id`, `mission_id`, `a3_operation`, `repository`,
`environment=staging`, `target_digest`, `intent_digest`,
`approval_reference`, `authorization_reference`, and
`single_use_authorization_id`. Only an issuer-verified authoritative
record proceeds to the existing strict A3 validator.

**Not yet available:** the observed Maestro `router.ts` does **not**
implement `verify_a3_provenance`; its MissionRun schema does not carry
the requisite separately attestable A3 proof. No deployed authenticated
Hermes→Maestro invocation channel has been verified/configured. With no
server-supplied `invokeMissionGateway`, or a gateway returning unknown
operation/404/invalid proof, the reader returns no source proof. Both A3
mutation admissions continue to block **before** authorization consumption
and any SCM network call. Tests mock the future gateway response *only in
test code*, including negative tests proving a legacy public-web run with a
valid contract hash still cannot become A3 authority.

To complete this bridge later, evolve the **existing** missionGateway
under its current workspace membership and service-role contracts to
issue/verify a protected, immutable A3 source attestation from a genuinely
authorized MissionRun and simulation gate. Then connect a server-owned
authenticated invoker; never pass a client-controlled invoker, plain
MissionRun field, or bearer token through user input. Source authenticity
must be enforced by the gateway's privileged issuer (canonical digests
alone establish integrity, not authenticity). Do not retrofit that proof
onto the historical one-shot `update_file` canary. Until a separate
successful staging E2E and explicit human promotion, keep
`source_reader_connected=false`, `proven_e2e=false`,
`operational=false`, `human_promotion_authorized=false`,
`candidate=null`; A4, production and merge authority remain forbidden.

## Server-authenticated Maestro Mission Gateway read transport (staging-only; unconfigured)

The existing privileged MissionRun reader can now connect to the existing
Maestro Pessoal `missionGateway` through a server-only HTTPS read transport.
Only `list_runs`, `verify_integrity`, and `verify_a3_provenance` are
allowlisted; body field names and exact A3 scope must match. The transport
rejects non-HTTPS URLs, user-controlled endpoints, redirects, error status
codes, oversized responses, malformed JSON and network failures. It does not
create missions, dispatch, write, issue approval, persist evidence, or issue
A3 authority.

The transport is **inert** until the server (not the action request) provides
`HERMES_DEPLOYMENT_STAGE=staging`, a verified app-domain
`MAESTRO_MISSION_GATEWAY_URL` ending exactly with
`/functions/missionGateway`, and `MAESTRO_MISSION_GATEWAY_ACCESS_TOKEN`
through its authorized secret manager. The token must authenticate to the
existing `base44.auth.me()` call as an actual user identity with current
membership and required role; an arbitrary platform API key is not sufficient.
No token or app deployment has been configured or exercised.

The live staging A3 write path still fails closed: the Maestro control plane
has not issued a genuine independent simulation attestation, the approval
must be bound to the exact post-MissionRun action, and no new human promotion
has occurred. This change alone is not operational E2E evidence. Do not
reuse the historic public-web run, replay the previous single-use authorization,
or repeat the historic update-file canary.

## Simulated official MissionRun source candidate (20 October 2026; NOT A3 promotion)

The existing Maestro dispatch Gateway marks non-public-web dispatches `dispatch_simulado=true`.
Prior A3 readers required `dispatch_simulado=false` for every run, unintentionally
excluding the only currently established official zero-effect simulation run path.
That must **not** be solved by mislabeling a simulated run as operational.

Maestro Pessoal sandbox checkpoint `6ad7534c70b57597c48d7be4` now has a
read-only eligibility helper for a completed, simulated official `MissionRun`:
require status `concluida`, an exact single `MissionDispatchOutbox` receipt
with matching workspace/mission/run/dispatch token/contract hash, simulated mock
provider and acknowledged dispatch state. This is only **source candidacy**;
an outbox acknowledgment alone is not an A3 staging-gate receipt.

The Hermes privileged read bridge may now query that run, but remains blocked
unless Maestro additionally verifies the independently signed Ed25519 A3 source
attestation, current precisely scoped human approval, globally unique single-use
ID, durable `sealed` claim, and exact action/target/intent bindings. A missing,
unpublished, inaccessible or invalid gateway response fails closed. The older
operational-run rule remains unchanged. Local transport mocks are **tests only**.

**Not done:** deploy or configure Maestro A3 stage and issuer verification
settings; independently produce and sign genuine zero-effect staging receipts;
authorize a new A3-specific human decision; establish server-to-server
service identity; or perform any actual A3 SCM mutation. Production/A4,
merge authority, and promotion for update_file/Draft create_pull_request
remain forbidden. The 15 October public-web MissionRun and 19 October
update_file canary do not meet this new source contract.


### A3 source hardening — exact Mission Contract and cross-approval replay (20 Oct 2026)

Maestro Pessoal sandbox checkpoint `6ad76bacc924d49ff794f174`
(c03c5046ff257b623f36f2842dc462d87ab635d3) requires the
original official Mission Contract to match the exact MissionRun's
mission/workspace/dispatch idempotency key/emitter/issue time and to
declare `github_api`, an explicit human-approval policy, a code/test mission
type and `merge`, `publish`, `production` denied actions.
A correct contract hash is **necessary but not sufficient**. In particular,
the historical `public_web_read` canary must never qualify as an A3 source.

Both signed admission and provenance read now require exactly one official
`SolicitacaoAprovacao` across **all workspaces** for the proposed
`a3_single_use_authorization_id`, rechecked during persistence and on reads.
Duplicates deny without accepting a second approval, including if a second
approval appears after a source was sealed. These read/check/claim controls
**do not provide atomic global uniqueness** across independent concurrent
approval creations: an authoritative storage `UNIQUE` constraint or
equivalent exclusive ledger remains required before operational promotion.

Maestro Deno synthetic tests: 29 passed, 0 failed. The Hermes
authenticated read bridge duplicates the purpose/scope check before even
calling `verify_integrity` or `verify_a3_provenance`. Missing source
authentication, independent zero-effect simulation receipt, issuer key,
current scoped human approval and actual deployment remain hard blocks.
No issuer was created and no real A3 source/mutation was emitted.


### Contract issuer vs. dispatch actor compatibility — 20 Oct 2026

Official `dispatchService` snapshots `buildMissionContract` **before** acquiring
its Mission dispatch lock. Its contract `requested_by.id` and
`metadata.emitted_by` identify the *mission creator*, while
`MissionRun.emitted_by` identifies the authenticated *dispatcher*.
The `MissionRun.issued_at` is recorded after contract creation; therefore
the timestamps must be valid canonical ISO datetimes in strictly
non-decreasing order, within five minutes, not exactly equal.

The Maestro and Hermes authenticated-read guards now bind
mission/workspace/idempotency key exactly, independently validate both
actor roles and original creator binding, and require the issuer timestamp
to precede the official run timestamp within the bounded dispatch window.
This resolves a confirmed false-negative in the previous guard without
trusting input-supplied source proof. Maestro 29/29 synthetic tests passed
(checkpoint `6ad77c9fd0aa036752cc7539`, commit
`46869922ec40030ecf63ce256f6b7c94cd1d16b7`).

The independent zero-effect receipt, exact post-run human approval,
global transactional single-use ownership and signing/deployment gates
remain mandatory and are **not** provided by this compatibility fix.


### Staging PostgreSQL global single-use claim migration — 20 Oct 2026

PR #563 includes `034_create_maintainer_a3_source_authorization_claims.sql`
as a deliberately **unapplied** staging-only schema migration in the existing
`hermes` PostgreSQL namespace. It is distinct from
`maintainer_scm_write_consumption` and does **not** consume an SCM
authorization or attest a simulation. Database-enforced exclusivity applies
globally across workspaces to
`single_use_authorization_id` (PRIMARY KEY), `approval_reference`,
`simulation_receipt_digest` and `source_record_digest`. The table
stores bound mission/workspace/run/operation/target/intent/issuer-signed-record
digests only, no credentials or provider capabilities.

The exact migration was tested against staging PostgreSQL inside an
outer explicit transaction, stripping only the migration's own
`BEGIN`/`COMMIT` wrappers and ending with **ROLLBACK**. Observed:
schema creation, rejection of duplicate authorization IDs, duplicate approvals,
duplicate simulation receipts and the `production` environment; one
synthetic row before rollback, zero table persistence afterward.
No migration was deployed and no official Base44 evidence was written.

Two further explicit blocks remain:
1. The independent, trusted issuer must prove a **real**, newly completed
   zero-effect A3 simulation receipt bound to an official code-scoped MissionRun
   and an exact post-run human decision, not merely an acknowledged mock outbox.
2. A privileged staging service must atomically claim this durable PostgreSQL
   key **before** the Maestro attestation is finalized or consumed by Hermes;
   until the real authority path uses the database constraint, the schema
   remains a tested contract, **not** enforcement in the live A3 gate.

Neither observation-only HTTP, a valid contract hash, nor this migration
authorizes an external SCM operation, merge, production or A4.


### A3 source claim persistence — non-executing adapter (20 October 2026)

The existing PR now contains
`platform/services/api/src/core/hermes-maintainer-a3-source-claim-postgres-persistence.js`,
a non-HTTP, default-disabled PostgreSQL persistence adapter for migration 034.
It is **not** the independent Ed25519 issuer, the authoritative Maestro
approval decision, an execution action, or the pre-existing SCM write
consumption. No production dispatch path imports or enables this adapter.

An intentionally absent privileged server callback
`verifyOfficialSource` must eventually authenticate the official
MissionRun, specific post-run human decision, correctly signed source and
independently confirmed zero-effect simulation receipt. A request's
`verified` flag is not trusted as authority. The callback cannot be supplied
from HTTP input; server composition will remain fail-closed until genuine
evidence can be verified. Enabling also requires both
`HERMES_DEPLOYMENT_STAGE=staging` and
`HERMES_A3_SOURCE_CLAIMS_ENABLED=true` from server-owned configuration.

Given a trusted verifier, this component validates exact claim scope,
atomically inserts into the existing migration-034 PostgreSQL table,
commits and read-verifies the immutable binding. All conflicts, replays,
unavailable verifiers and uncertain persistence return a denial. It
never returns `execution_authorized=true`, never calls a provider and
never inserts into the SCM consumption ledger.

Synthetic adapter/schema tests 9/9 passed on staging VPS; the focused
self-audit + A3 reader suite passed 24/24 and returned an empty
`errors` array after refreshing source/test inventory counts.
PostgreSQL uniqueness was previously tested in rollback-only staging
transactions. **Migration 034 remains unapplied in the durable staging
database; the adapter has no live execution wiring.** No signed A3
attestation was issued, no authorization consumed and no new MissionRun
created. Integrating the real issuer callback and durable claims into
the Maestro↔Hermes admission decision remains a separate gate in the
same ongoing PR, not a reason to fabricate evidence or open micro-PRs.


### A3 ownership read-time revalidation (October 20, 2026)

The existing default-disabled `hermes-maintainer-a3-source-claim-postgres-persistence`
adapter now exposes `verifyOwned(input)` as a **read-only** check. It
reinvokes its separately provisioned privileged `verifyOfficialSource` callback
for *every* read, checks the entire official claim scope against input, and
reads the PostgreSQL staging ownership row by the authoritative single-use
authorization ID. It requires exactly one row with matching immutable
workspace, mission, MissionRun, approval, operation, target, intent, signed
source digest and independent simulation receipt digest.

Missing or revoked approval, invalid issuer, unavailable issuer, missing row,
any mismatch, unavailable DB or disabled staging flags deny before a positive
ownership response. Even a positive `verifyOwned` response explicitly has
`execution_authorized=false`, `write_performed=false`,
`production_allowed=false` and `merge_authority=false`. No HTTP route or
automatic SCM authorization is created.

This does **not** mean the authoritative receipt has been produced: there is
still no newly completed A3 MissionRun, independent observed simulation
receipt, issuer provisioned, exact post-run approval, or connected
Maestro↔PostgreSQL trusted verifier. The observation API must remain
non-executing. Revalidation is a prerequisite for a future authorized
admission gate, not its replacement.


### Official A3 smoke isolation and revision binding (20 October 2026)

The official pre-simulation candidate reader now accepts ONLY an existing
authenticated, integrally verified **queued, simulated, code-test MissionRun**
with one exact mission/run ID. Its hashed Mission Contract must have
`metadata.tipo=testar`, `allowed_tools=["github_api"]`, deny merge,
publish and production, and a strictly scoped `context`:

```json
{
  "a3_simulation": {
    "version": "a3_zero_effect_smoke_v1",
    "operation": "update_file",
    "repository": "instutodp-cpu/agente-grupo-erick",
    "test_id": "hermes_core_smoke",
    "revision_sha": "<the exact real 40-character staging commit SHA>",
    "network_allowed": false,
    "write_allowed": false,
    "production_allowed": false
  }
}
```

The operation and commit SHA must be fixed **inside the official hashed
MissionRun contract**, not added from caller-supplied request fields after
dispatch. The existing runtime test executor/allowlisted smoke tests are
reused through the established test-execution boundary. The new A3-specific
runner requires server-owned `HERMES_A3_TEST_IMAGE_ID` pinned to a local
Docker `sha256:` image ID; exact local Git checkout HEAD must equal the
signed-off Mission Contract `revision_sha`.

A3's subprocess is invoked only through the local Docker CLI with fixed
`--pull=never --network=none --read-only --cap-drop=ALL`,
`--security-opt=no-new-privileges`, an unprivileged user, memory/CPU/PID
limits, ephemeral `/tmp`, a read-only source bind and two fixed allowlisted
Node tests. It cannot receive arbitrary CLI parameters, network endpoints,
credentials or mount paths from an A3 request. The staged server must keep
`HERMES_EXECUTION_ENABLED=false`,
`HERMES_EXECUTION_KILL_SWITCH=true`,
`HERMES_MISSION_INGRESS_ENABLED=false`; the separate A3 test feature flag
is OFF by default.

Real VPS verification on the isolated checkout (GitHub PR #563 revision
`8689708a7ae1219f73072bb382066fe2c77655c0`) ran:
* 29/29 relevant A3 unit tests, self-audit `errors:[]`;
* 5/5 subprocess smoke tests in manually verified Docker no-network,
  read-only, reduced-privilege mode;
* the **actual pinned-image A3 test runner** on that checkout, reporting
  `test_id=hermes_core_smoke`, `passed=true`,
  `receipt=test_process_passed` (an **ephemeral process return**, NOT an
  independent A3 receipt or issuer-signed attestation);
* healthy HTTPS 200 for the untouched staging observation container, a
  healthy PostgreSQL staging container, 0 source authorization claims.

**No real A3 MissionRun was created, dispatched, claimed or completed by
these tests**. The test run did not update the official outbox or Maestro
MissionRun. The resulting process observation is deliberately insufficient
for `STAGING_SIMULATION_RECONCILED`; it has no independent durable receipt,
no verified issuer, no exact post-run human decision, no permission to claim
the PostgreSQL single-use authorization or consume SCM authority.

The production A3 observation composition remains uninstalled on any HTTP
route or operational ingress. A real zero-effect receipt must eventually
bind actual sandbox/container/process identity, exact verified commit, issuer
identity/signature, official MissionRun/contract digest, audit timestamps and
independently attested effect policy. Until that evidence is generated and
reconciled by a trustworthy issuer, all downstream A3 gates remain CLOSED.
