# C23 — Accounting Operational Control Plane

C23 reconstructs the shared operational control plane beneath the C21 payment-preparation and C22 controlled-execution contracts.

## Scope

It covers \`FINANCIAL_EXECUTION\` and \`FISCAL_SUBMISSION\` with tenant-scoped, versioned capability flags. No capability is enabled by default, and both \`enabled\` and \`realProviderEnabled\` must be explicit booleans before the flag can pass its gate.

## Simulation-first contract

The module is intentionally in-memory and synthetic:

- capability flags, reservations, leases and attempts are immutable snapshots;
- \`simulationOnly\` is always \`true\`;
- \`externalEffectAllowed\` is always \`false\`;
- real providers, secrets, persistence and deployment are out of scope.

## Idempotency and leases

Before any provider boundary, a reservation is keyed by \`tenantId + capability + idempotencyKey\`. A duplicate in the same tenant/capability is rejected with \`CONFLICT\`; the same key in another tenant remains isolated.

A reservation has an owner and an ISO UTC lease. An active lease blocks another worker; an expired lease may be recovered with a new future lease. Invalid or non-future timestamps fail closed.

## Auditable attempts

Each attempt is first-class and carries \`auditRequired: true\`. Failures remain represented as \`FAILED\`. A synthetic success must include a provider reference; that reference is evidence only and never grants external execution authority.

## Relationship to C21/C22

\`domain gate → tenant capability flag → idempotent reservation → lease → synthetic attempt → confirmation/reconciliation\`

The C23 layer does not replace the domain gates in C21/C22 and does not activate any real gateway.

## Not implemented

- PostgreSQL uniqueness constraint or transaction;
- distributed lock service;
- persistent feature-flag repository;
- real provider adapters or secrets;
- external execution, fiscal submission or deployment.
