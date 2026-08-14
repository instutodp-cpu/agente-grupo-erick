# Hermes VPS PostgreSQL Durable Lifecycle Adapter V1

This document describes the PR-C production adapter for
`hermes-vps-authorization-lifecycle-persistence-v2`. It implements the
existing lifecycle persistence contract against the PR-B table without
activating the adapter in the Hermes runtime.

## Boundary

- Adapter: `createPostgresHermesVpsAuthorizationLifecyclePersistence`.
- Storage: `hermes.authorization_lifecycle` from the PR-B migration.
- Client: injected server-side `pg` Pool; no browser/client bundle access.
- Configuration factory: `HERMES_DURABLE_DATABASE_URL`.
- Missing configuration fails closed; the Map reference adapter is never a
  production fallback.
- Receipt reference and hash are persisted in the same row as lifecycle state.

The adapter does not implement shared durable coordination, leases, fencing,
attempt/admission persistence, provider execution, SSH, workers, deployment,
cutover, or dual-write with Base44.

## Operation semantics

`read` selects by canonical `authorization_id`, reconstructs the lifecycle
entry and receipt, and rejects malformed JSON, state, sequence, fingerprint,
identity, plan, or receipt data as `READ_FAILED`.

`insert` uses `INSERT ... ON CONFLICT (authorization_id) DO NOTHING` inside a
transaction. A successful insert stores the complete lifecycle entry and
receipt together. A conflict returns the durable existing row so the registry
can classify an exact fingerprint as replay and divergent data as conflict.

`compareAndConsume` and `revoke` lock the current row, validate the immutable
identity and expected fingerprint, then perform a conditional
`UPDATE ... RETURNING` using the current revision. A transition and its
receipt commit together. A stale or invalid transition never overwrites the
row.

Serialization failures (`40001`) and deadlocks (`40P01`) receive at most two
bounded retries. Malformed data, conflicts, permission errors, stale writers,
and invalid transitions are not retried. A commit error is an unknown commit
outcome and is returned as a failure; later reads must reconcile durable truth.

## Tests and activation boundary

Unit tests use an injected deterministic client harness and assert the SQL,
transaction, CAS, receipt, retry, and fail-closed contracts. The optional live
integration test runs only when `HERMES_POSTGRES_TEST_DATABASE_URL` is set for
an isolated test database. It never selects a production URL or applies a
production migration.

`PRODUCTION_ADAPTER_IMPLEMENTED: YES`

`PRODUCTION_ADAPTER_ACTIVATED: NO`

`PRODUCTION_CUTOVER: NO`

`PRODUCTION_DATABASE_CONNECTED: NO`

`PRODUCTION_WRITES: 0`

`PR_D_SHARED_COORDINATION_IMPLEMENTED: NO`
