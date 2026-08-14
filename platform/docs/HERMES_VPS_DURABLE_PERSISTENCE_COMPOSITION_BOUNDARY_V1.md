# Hermes VPS Durable Persistence Composition Boundary V1

This boundary composes the explicit persistence selection from PR #141 with
the existing Hermes durable lifecycle registry. It is dependency-injection
infrastructure only; it is not imported by the API entrypoint and does not
activate PostgreSQL in the runtime.

## Ownership

`createHermesVpsDurablePersistenceComposition` owns the lifecycle of the
selected persistence resource within the returned composition. Its idempotent
`close()` delegates PostgreSQL pool shutdown to the existing factory. Memory
selection has no external resource and therefore has a deterministic no-op
cleanup.

## Selection and safety

The existing factory remains the single source of truth for `memory` and
`postgres` selection, including explicit mode validation, the safe memory
default, the Hermes-specific PostgreSQL URL, and fail-closed construction.
Generic `DATABASE_URL` does not activate PostgreSQL. No runtime entrypoint,
worker, provider, queue, scheduler, migration, or production cutover is
introduced here.

## Boundary

The composition exposes the selected persistence interface and lifecycle
registry for isolated callers and tests. Lifecycle, transaction, CAS, receipt,
replay, and conflict semantics remain implemented by the existing registry and
PostgreSQL adapter. A later runtime-wiring checkpoint must separately define
application startup/shutdown ownership and production activation.
