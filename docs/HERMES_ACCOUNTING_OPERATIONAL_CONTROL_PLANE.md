# C23 — Accounting Operational Control Plane

C23 moves execution safety from in-memory contracts toward an operational persistence contract.

## Scope

It governs both:
- `FINANCIAL_EXECUTION`;
- `FISCAL_SUBMISSION`.

## Tenant-scoped feature flags

Execution enablement is never assumed globally. Each tenant/capability has a versioned flag with two explicit gates:

`enabled`

`realProviderEnabled`

Both must be true. Defaults remain false.

## Transactional idempotency contract

Before any external side effect, the runtime must atomically reserve:

`tenant + capability + idempotency_key`

A duplicate reservation is rejected before provider execution.

The JavaScript module models this invariant. Production persistence must enforce it with a database uniqueness constraint/transaction.

## Lease / lock

A reservation carries an owner and lease expiry. While a valid lease exists, another worker cannot execute the same operation. Expired leases may be recovered deliberately.

This protects retries, crashes and concurrent workers from double execution.

## Execution attempts

Every attempt is a first-class audited record, including failures. A timeout is not silently retried outside the same idempotent operation.

## Tenant isolation

A feature flag belonging to one tenant can never authorize another tenant's reservation.

## Relationship to C21/C22

C21 and C22 define domain authorization and provider-state semantics.

C23 supplies the shared operational control plane beneath them:
`domain gate → tenant feature flag → atomic reservation → lease → provider attempt → audit → confirmation/reconciliation`.

## Not implemented

- PostgreSQL migration/unique constraint;
- distributed lock implementation;
- persistent feature-flag repository;
- real provider adapters;
- secret manager integration.
