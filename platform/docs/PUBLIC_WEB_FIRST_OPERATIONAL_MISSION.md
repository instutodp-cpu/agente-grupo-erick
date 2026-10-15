# Public Web — First Operational Mission

## Status

The public-web read-only capability has crossed the first real-network operational boundary in **staging only**.

The successful canary was executed from merged revision:

`7318ee2a3d3d82c889b99fb77a6bec03118ed58e`

The result proved one bounded HTTPS GET to the staging health endpoint with:

- `PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_COMPLETED`
- `executed: true`
- `real_provider_called: true`
- `provider_invoked: true`
- `transport_invoked: true`
- `external_network_called: true`
- HTTP class `2xx`
- `redirects_followed: 0`
- `production_effect: ZERO`
- a single request identity in the authorization window
- durable PostgreSQL audit transition `public_web_canary_request_started -> public_web_canary_request_succeeded`
- single-use authorization, reservation, and replay identities consumed

This evidence promotes **public-web read-only staging canary** to operational. It does not promote production and it does not promote the generic runtime execution path, which remains simulation-only.

## Next bounded operational objective

The next proof is one useful Maestro Mission Engine research mission flowing through a narrow operational bridge into the already-proven Hermes public-web execution path.

The bridge must evolve existing contracts rather than create a parallel Mission Engine.

### Maestro authority

Maestro remains the control plane and continues to own:

- `Mission`
- `MissionRun`
- `MissionStep`
- `SolicitacaoAprovacao`
- `MissionDispatchOutbox`
- idempotency, CAS dispatch ownership, locks and reconciliation
- human approval policy

Hermes does not acquire mission-control or merge authority.

### Mission envelope

Only a `pesquisar` Mission Contract may become an operational public-web candidate in this phase.

The immutable Mission Contract hash must bind:

- mission and run identity
- workspace identity
- idempotency and correlation identity
- `allowed_tools = ["public_web_read"]`
- required denied actions
- explicit human approval policy
- budget bound
- target configuration inside the existing `context` field

The mission `context` is a canonical JSON string with exactly one `public_web` object. The bounded public-web input contains:

- exact HTTPS `target_url`
- approved read-only operation and source type
- approved content types
- `maximum_requests: 1`
- `redirects_allowed: false`
- bounded timeout
- bounded response size

Query strings, fragments, credentials, non-HTTPS targets, write/action tools, production dispatch, and widened workspace bindings fail closed.

### Trust boundary

Mission-provided tenant/user/workspace authority is not trusted by itself. Hermes binds the envelope to trusted runtime identity and verifies the workspace match before creating an operational trial plan.

A mission envelope only produces `PUBLIC_WEB_OPERATIONAL_MISSION_BOUND_NOT_EXECUTED`. It does not itself authorize or start network execution.

### Execution boundary

Real mission execution must reuse the proven public-web controls:

1. authenticated Maestro-to-Hermes inbound dispatch
2. immutable contract-hash verification
3. staging-only target policy
4. safe DNS resolution and approved-IP pinning
5. durable audit readiness before network
6. fresh strong human email reauthentication
7. single-use authorization grant and active session
8. exact human TTY confirmation
9. one request maximum, redirects disabled
10. durable success/failure audit
11. authenticated Hermes-to-Maestro result acknowledgement/callback

No old challenge, evidence key, grant, session, or replay identity may be reused.

## Semantics of `simulated`

`simulated` is now an evidence field, not a permanent historical label.

A public-web result may be `simulated: false` only when all real execution evidence is present:

- `executed: true`
- `real_provider_called: true`
- `provider_invoked: true`
- `transport_invoked: true`
- `external_network_called: true`

Pre-network requests, dry-runs, fixtures, mock results, and incomplete telemetry remain `simulated: true`.

This removes the ambiguity observed in the first successful real canary without weakening simulation-first admission rules.

## Non-goals for this increment

- no production public-web execution
- no generic runtime promotion from simulation to real execution
- no autonomous protected action
- no browser automation
- no redirects
- no credential-bearing public targets
- no merge authority for Hermes
- no callback accepted without authenticated origin
- no global target allowlist widening

## Operational edge ingress

The staging edge uses a separate `Caddyfile.operational-mission` artifact for the first operational mission. The historical observation-only Caddyfile remains unchanged and continues to strip `Authorization` from observation routes.

The operational artifact adds exactly one authenticated edge route: `POST /internal/mission-dispatch`. Only that route forwards the caller's `Authorization` header to the loopback Hermes API so the machine bearer can be resolved by the ingress identity registry. `Proxy-Authorization`, cookies, caller-supplied forwarding headers, query strings, raw request headers in access logs, and sensitive response headers remain blocked or redacted. All unsupported paths and methods remain a terminal proxy `404`.

Enabling this edge route does not authorize public-web execution. Mission admission remains durable and non-executing; fresh email reauthentication, single-use authorization, and exact real-TTY confirmation remain mandatory before the one-request public-web runner can start.
