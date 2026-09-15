# PR-B_CONFIGURATION Contract

Status: authoritative scope contract for the future Public Web Canary PR-B.
This document is documentation only. It does not implement or enable any
runtime behavior.

## A. Purpose

`PR-B_CONFIGURATION` prepares and validates the configuration required by a
future Public Web Canary. It is limited to deterministic, non-production
configuration and preflight boundaries. It must never activate real transport.

Configuration readiness is not provider readiness, canary activation,
production authorization, or authorization for PR-C.

## B. Prerequisite

PR-A is PR #195, merged at:

`3d18725f1865924f5dc5c0183595a5fb09ccba4d`

PR-B may start only from that merged state, or from a later `main` commit that
preserves it. The PR-A invariants in Section J are mandatory prerequisites.

## C. Allowed scope

A future PR-B may contain only the following, and only when necessary to make
this contract executable:

- non-production configuration descriptors and safe local configuration;
- parsing, normalization and validation of configuration;
- opaque secret names, references and descriptors without secret values;
- feature-flag and kill-switch binding with safe defaults;
- deterministic preflight and synthetic dry-run behavior;
- synthetic fixtures only;
- unit, contract, characterization, negative/fail-closed and preflight tests;
- documentation and contract fixtures directly associated with this scope.

The likely existing areas are the provider-configuration contract/registry/
readiness modules, the Public Web Canary trial config loader and preflight,
their example configuration, and their associated tests. This is an area
boundary, not permission to modify every file in those directories. The future
PR-B must provide an exact changed-file manifest before implementation.

## D. Required safety defaults

The following defaults are mandatory:

- `HERMES_PUBLIC_WEB_READ_ONLY_ENABLED` defaults to `false`;
- `HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH` defaults to `true`, meaning the
  kill switch is active and execution is blocked.

Missing, malformed or inconsistent configuration must fail closed. In
particular, absence of a feature flag, absence of a kill-switch value, an
invalid secret reference, an invalid target or a mismatched identity must not
enable transport or change execution state.

Any synthetic test context that explicitly disables the kill switch remains
test-only and must retain `simulated:true`, `executed:false` and
`real_provider_called:false`.

## E. Secret policy

PR-B may recognize only the names, opaque references and sanitized descriptors
needed to validate configuration. It may not contain or handle secret
material.

PR-B must never:

- store a real secret in the repository;
- print or expose a secret;
- include a secret in a fixture, snapshot, report or evidence bundle;
- persist a secret;
- resolve a real secret;
- perform a provider call to obtain or use a secret.

The generic configuration contract fields such as `secret_refs`,
`secret_reference_descriptors`, `secret_reference_type`, `required_secret_names`
and `secret_policy` remain descriptors only. No concrete production secret
name, environment credential, vault path, ARN or secret handle is authorized
by PR-B.

## F. Explicitly out of scope: PR-C or later

The following are prohibited in PR-B:

- real HTTP, DNS or other network transport;
- real provider calls or provider SDK execution;
- real integration with `/message` or `/confirm`;
- a real endpoint, scheduler, worker or background execution;
- automated execution, real sending or real traffic;
- production routing changes or automatic production changes;
- canary activation or any mechanism that makes the canary operational;
- external side effects of any kind;
- creation, resolution or persistence of real secrets;
- migrations, database writes or ledger changes;
- deployment, cutover or runtime registration.

A dry-run may use only injected fakes, synthetic DNS/HTTPS behavior and
synthetic data. It must not open a socket, resolve a real target, call a
provider or cause an external side effect.

## G. PR-C boundary

`PR-C_REAL_TRANSPORT` starts only after PR-B is implemented in a separate PR,
reviewed, CI-green and merged, and a human explicitly authorizes starting
PR-C. Approval or merge of PR-B never authorizes PR-C, real transport, real
secrets, production routing or a real canary.

## H. Future PR-B acceptance criteria

A future PR-B is GO only when all of the following are true:

- the changed-file manifest contains only configuration, preflight, synthetic
  dry-run, fixtures, tests and directly associated documentation;
- both safety defaults in Section D are preserved;
- malformed, missing, invalid and inconsistent input fails closed;
- no real transport, provider call, network or external side effect exists;
- no production code path, routing, endpoint, scheduler or worker is changed;
- no real secret is added, read, resolved, persisted or exposed;
- unit, contract, characterization, negative/fail-closed and preflight tests
  are green;
- all PR-A invariants remain green and durable audit behavior is preserved;
- repository CI is green for the exact candidate commit;
- a human reviewer approves the bounded scope before merge.

## I. NO-GO criteria

PR-B is blocked by any of the following:

- need for real transport, an endpoint, scheduler or worker;
- need for a provider call or real secret;
- need for a production change, migration or remote write;
- any external side effect or real traffic;
- ambiguity between PR-B and PR-C;
- any violation of the PR-A invariants;
- any failed, missing or unverifiable fail-closed test;
- any changed file outside the approved manifest.

## J. Inherited PR-A invariants

PR-A / PR #195 established and PR-B must preserve:

- durable append-only audit persistence for the Public Web Canary;
- a `PRE_NETWORK` audit event before any request attempt;
- a `POST_NETWORK` audit event after the request path;
- canonical audit-event idempotency and deduplication;
- fail-closed behavior when durable audit persistence is unavailable or fails;
- sanitized audit data with no secrets, tokens, headers, cookies, raw body,
  full target or other sensitive provider material;
- no external network execution, real side effect or secret addition in the
  PR-A implementation;
- the existing migration 019 and durable audit schema are not reapplied,
  rewritten or reconciled by PR-B.

## K. Relationship to existing documentation

This contract specializes the existing boundaries in:

- `REAL_PROVIDER_CONFIGURATION_BOUNDARY.md`;
- `PUBLIC_WEB_READ_ONLY_ADAPTER_PILOT.md`;
- `PUBLIC_WEB_NON_PRODUCTION_CANARY_ACTIVATION.md`;
- `PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL.md`.

The repository also contains VPS durable-persistence documents using the
labels PR-B and PR-C. Those labels belong to a separate VPS track and do not
define Public Web `PR-B_CONFIGURATION`.

