# C25 — Accounting Runtime Integration Adapter

C25 connects Accounting to the existing Hermes Execution Plane through a guarded handoff. It does not create a second scheduler, queue, worker, claim, lease or fencing system.

## Boundary

The handoff carries tenant identity, operation identity, capability and idempotency key. Only these modes are accepted:

- \`SIMULATION\`;
- \`SHADOW\`.

Production is structurally rejected. Every accepted handoff forces:

- \`executed=false\`;
- \`externalEffectAllowed=false\`;
- \`realProviderAllowed=false\`.

## Canonical runtime sequence

The bridge requires the existing runtime to perform:

\`admitExecutionJob → materializeExecutionAttempt → admitExecutionAttempt\`

A missing runtime, denied job, failed materialization, denied attempt or adapter exception stops with \`BLOCKED\`. Exceptions are mapped to non-sensitive reasons; no provider output or secret is returned.

The success result is \`ADMITTED_SIMULATION\` only. It is not execution, authorization to execute, payment, fiscal submission or provider invocation.

## Relationship to C23/C24

- C23 supplies tenant capability, idempotency and lease invariants;
- C24 supplies the structural binding contract to canonical Hermes persistence;
- C25 supplies the guarded domain-to-runtime handoff.

C25 never opens a database connection and never applies a migration.

## Not implemented

- runtime repository/adapters;
- PostgreSQL or Supabase connection;
- provider invocation;
- payment, fiscal submission, deployment or scheduler activation;
- secrets or permission changes.
