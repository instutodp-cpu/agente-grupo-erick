# Hermes VPS PostgreSQL Durable Persistence Infrastructure V1

This document describes the structural infrastructure delivered by PR-B.
It implements the logical PostgreSQL schema required by the existing PR #133
authorization lifecycle persistence contract. It does not implement the
production adapter, runtime selection, cutover, or shared coordination from
PR #136/#137.

## Scope

The migration creates one namespaced table:

`hermes.authorization_lifecycle`

It contains the canonical authorization/lifecycle payload, plan binding,
execution scope, lifecycle state, monotonic sequence, persistence revision,
transition references, fingerprint, receipt references, and server timestamps.

This PR intentionally does not create a coordination, lease, fencing,
attempt, admission, executor, provider, worker, or external-operation table.
Those records require the later contracts and adapters that own their
semantics.

## Migration

There is no migration framework in the repository. The versioned migration is
therefore a PostgreSQL-standard `psql` script:

`platform/migrations/hermes/001_create_authorization_lifecycle.sql`

For an isolated empty test database, an operator may run it explicitly with
`ON_ERROR_STOP`:

```text
psql "$HERMES_POSTGRES_TEST_DATABASE_URL" \
  --set ON_ERROR_STOP=1 \
  --file platform/migrations/hermes/001_create_authorization_lifecycle.sql
```

`HERMES_POSTGRES_TEST_DATABASE_URL` is a test-environment placeholder only.
No value is committed and no production connection is attempted by PR-B.
The migration is transactional and uses `IF NOT EXISTS` for the schema,
table, and indexes so a repeated application is harmless when the existing
objects match the reviewed definition. Existing schema drift must be
detected and rejected by the deployment review before reuse; this migration
does not silently repair an unknown table.

## Constraints and indexes

- `authorization_id` is the primary key and the sole current authoritative
  lifecycle identity.
- No physical foreign key is created in PR-B. The plan, attempt, owner,
  admission, and receipt references are logical references because their
  canonical owner tables/interfaces are outside this PR. Adding a foreign
  key to a non-owned or not-yet-existent table would create an architectural
  dependency and would not improve isolation.
- Payload identity and payload authorization hash must match their canonical
  columns.
- Lifecycle state is limited to `REGISTERED`, `CONSUMED`, and `REVOKED`.
- Transition references must match the row authorization identity and the
  state-specific nullability rules.
- Sequence and persistence revision are non-negative.
- Receipt reference and receipt hash are all-or-nothing.
- The state index supports lifecycle inspection.
- The `(authorization_id, fingerprint)` index supports deterministic
  compare-and-set lookup; the future adapter must still include an expected
  fingerprint/version predicate in its update.

The migration does not add a separate idempotency key because PR #133 does
not define one. Its canonical idempotency boundary is the authorization ID
plus validated lifecycle fingerprint. PR #136 coordination and replay keys
remain owned by that later boundary.

## Isolation

The current #133/#136 Hermes contracts do not define `tenant_id`,
`organization_id`, `workspace_id`, `company_id`, `mission_id`, or `run_id`.
PR-B therefore does not invent those columns or claim cross-tenant support.
The durable identity is bound to the canonical authorization, plan, scope,
lifecycle, attempt/owner, and admission references defined by the existing
contracts.

Any future multi-tenant or cross-workspace scenario requires a contract
revision that adds the dimension, binds it into identity and queries, and
defines its database policy before production use.

`RLS_IMPLEMENTED: NO`

`RLS_REASON: OUT_OF_SCOPE_BY_CONTRACT`

RLS is not a substitute for missing application identity. It can be added in
a later reviewed layer after the authoritative Hermes contract defines the
required tenant/workspace dimensions.

## Concurrency and failure behavior

The schema supports the PR #133 adapter requirements without implementing the
adapter:

- inserts are protected by the primary key;
- lifecycle transitions must be conditional on the current fingerprint and
  revision inside one database transaction;
- a zero-row conditional update is a deterministic conflict/stale result;
- `revision` is storage concurrency metadata and `sequence` remains the
  lifecycle domain sequence;
- transaction rollback exposes no partial lifecycle transition;
- malformed JSON or a constraint violation is rejected by PostgreSQL;
- unavailable storage and unknown commit outcomes must be surfaced as
  fail-closed results by PR-C;
- no Map-backed adapter may be selected in production.

No external coordination service is introduced. Lease acquisition, renewal,
release, fencing, and active-attempt uniqueness for PR #137 remain out of
scope and must be implemented only by the later shared coordination layer.

## Test strategy

The repository has no PostgreSQL service or migration runner in CI. PR-B
therefore includes a dependency-free static migration test that proves the
reviewed DDL contains the required table, constraints, indexes, transaction
boundary, and excludes production/runtime wiring. It does not claim a live
database result.

For an isolated database, run the migration command above and inspect the
schema with PostgreSQL catalog queries before any adapter work. Never point
this test procedure at production or commit a connection string.

## Explicit non-goals

`PRODUCTION_ADAPTER_IMPLEMENTED: NO`

`PRODUCTION_CUTOVER_PERFORMED: NO`

`PRODUCTION_WRITES_PERFORMED: NO`

`DATABASE_CONNECTION_PERFORMED: NO`

`RLS_IMPLEMENTED: NO`

No runtime Hermes behavior changes, dual-write, backfill, secret, feature
flag, automatic migration, or production configuration is included.

## Next layer

PR-C may implement `HermesVpsAuthorizationLifecyclePersistence` against this
schema with dependency injection, explicit durable configuration, transaction
semantics, and fail-closed startup/runtime behavior. PR-C must not implement
PR #137 shared coordination or external execution.
