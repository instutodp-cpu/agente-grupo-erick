# Hermes Confirmation PostgreSQL Adapter V1

This adapter implements `confirmation-persistence-v2` for the separate
Confirmation bounded context. It is intentionally not the Hermes VPS
authorization lifecycle adapter.

## Boundary

`createPostgresConfirmationPersistence({ pool })` receives an already-created
server-side PostgreSQL pool. It does not read environment variables, create or
own a pool, close a pool, select a backend, run migrations, or wire the API
runtime. Pool ownership remains with a later composition boundary.

The default table name is fixed as `hermes.confirmations`. A qualified table
name is accepted only for isolated harnesses after strict lowercase SQL
identifier validation; no arbitrary caller-controlled SQL is interpolated.
All record values are bound parameters.

## Atomic transition

`compareAndTransition` performs the state decision with a conditional
`UPDATE ... WHERE confirmation_id = $1 AND status = $3 RETURNING ...`. A
zero-row update is classified with a subsequent read as `not_found` or
`state_mismatch`; that read cannot change the already-decided transition.
Duplicate creation propagates PostgreSQL's primary-key violation and is not
silently converted into an upsert.

## Schema and isolation

The logical fields are exactly the current confirmation contract:
`confirmation_id`, `trace_id`, `domain`, `intent`, `status`, and `expires_at`.
There is currently no tenant, workspace, or company dimension. Consequently,
this adapter is not approval for a future multi-tenant cutover until that
isolation decision is resolved.

`platform/migrations/hermes/002_create_confirmations.sql` is a versioned,
forward-only schema artifact used by isolated tests. The CI integration test
applies the same artifact in a dedicated `hermes_confirmation_test` schema so
it cannot race the existing D2 test cleanup of the `hermes` schema. It is not
applied by the adapter or by the runtime.

## Test-only reset

`reset()` issues a bounded `DELETE` for controlled test/setup usage. It is
never called automatically and does not imply production lifecycle ownership.

PostgreSQL integration tests use only the ephemeral CI service exposed through
`HERMES_POSTGRES_TEST_DATABASE_URL`. No production URL or secret is stored in
the repository.
