# Hermes VPS Durable Persistence Lifecycle Owner V1

This boundary gives a future composition root one explicit owner for an
already-created Hermes durable persistence composition. It does not create a
composition, select `memory` or `postgres`, read environment variables, open a
database connection, or register process signal handlers.

## Ownership

The caller creates the PR-D2 composition and passes it to
`createHermesVpsDurablePersistenceLifecycleOwner`. The returned owner exposes
the composition's persistence and registry references for consumers. Consumers
do not receive composition ownership and must not close the underlying
composition directly; only the owner closes it.

## Close semantics

`close()` stores and returns one shared promise. Sequential and concurrent
calls therefore invoke the underlying composition close exactly once and
observe the same result. A close failure is propagated through that shared
promise and is not retried or converted into success.

## Boundary

This PR does not modify `src/index.js`, server startup/shutdown, signal
handling, PostgreSQL activation, migrations, secrets, deployment, workers,
providers, queues, schedulers, or shared coordination. A later runtime-wiring
checkpoint must create one owner at the process composition root and connect it
to the application's shutdown path.
