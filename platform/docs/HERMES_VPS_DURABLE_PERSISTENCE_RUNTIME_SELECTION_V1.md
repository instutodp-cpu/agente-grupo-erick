# Hermes VPS Durable Persistence Runtime Selection V1

This document defines the explicit selection boundary added after the
PostgreSQL lifecycle adapter. It does not activate PostgreSQL in the Hermes
runtime, perform a cutover, apply a migration, or make a production write.

## Allowed modes

The selection boundary accepts only:

- `memory`: the existing deterministic reference adapter. This is the default
  when no Hermes-specific mode is supplied and remains a test/reference mode;
  it is not a claim of production durability.
- `postgres`: the existing server-side PostgreSQL lifecycle adapter from PR-C.

The selector reads `HERMES_DURABLE_PERSISTENCE_MODE`. Generic `DATABASE_URL`
presence never selects PostgreSQL. The adapter still receives
`HERMES_DURABLE_DATABASE_URL` through the existing PostgreSQL factory.

## Failure behavior

An unknown mode fails configuration validation. When `postgres` is explicitly
selected, missing or invalid durable configuration, missing lifecycle plan,
pool construction failure, unavailable storage, and schema incompatibility
remain errors. None may be converted to `memory`.

The selection boundary does not change the PostgreSQL transaction, CAS,
receipt, replay, or conflict semantics. Those remain owned by the PR-C
adapter. It also does not implement shared durable coordination from PR-D's
next layer, tenant/workspace extensions, provider execution, SSH, workers,
queues, schedulers, deployment, or cutover.

## Activation boundary

This module is dependency-injection infrastructure only. No current Hermes
composition root imports it, so this change does not activate PostgreSQL or
change production defaults. A later activation checkpoint must separately
approve runtime wiring, durable configuration, migration state, readiness,
rollback, and production access.

`PRODUCTION_ADAPTER_ACTIVATED: NO`

`PRODUCTION_CUTOVER: NO`

`PRODUCTION_WRITES: 0`
