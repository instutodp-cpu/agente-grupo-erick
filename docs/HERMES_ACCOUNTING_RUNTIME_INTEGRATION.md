# C25 — Accounting Runtime Integration Adapter

C25 connects Accounting to the existing Hermes Execution Plane without creating a second scheduler, queue, worker or lease system.

## Boundary

The Accounting domain emits a `HERMES_ACCOUNTING_RUNTIME_HANDOFF_V1` carrying tenant identity, operation identity, capability and idempotency key.

Only two modes are permitted in C25:
- SIMULATION
- SHADOW

Production is structurally rejected.

Every handoff forces:
- `executed=false`
- `externalEffectAllowed=false`
- `realProviderAllowed=false`

## Canonical runtime sequence

The bridge requires the existing runtime to perform:

`admitExecutionJob → materializeExecutionAttempt → admitExecutionAttempt`

If the canonical runtime is missing, job admission is denied, materialization fails, or attempt admission fails, Accounting stops fail-closed.

C25 does not implement its own queue/worker/claim/lease/fencing. Those remain responsibilities of the existing Hermes Execution Plane and its PostgreSQL adapters.

## Why this matters

C21/C22 define financial/fiscal safety semantics.
C23 defines operational control invariants.
C24 persists Accounting bindings into the canonical execution model.
C25 now creates the domain-to-runtime handoff while keeping all external effects disabled.

## Next gate

C26 should compose this bridge with the real PostgreSQL admission/materialization adapters and run an integration test against the database/runtime in Simulation/Shadow. It must still prove zero provider/network side effects before any controlled-production discussion.
