# C24 — PostgreSQL Operational Persistence

C24 deliberately reuses the existing Hermes durable execution runtime instead of creating a second Accounting scheduler/worker/lease architecture.

## Existing canonical runtime reused

Accounting execution binds to:
- `hermes.execution_jobs`;
- `hermes.execution_attempts`;
- existing ownership/worker/lease/fencing/capacity runtime migrations.

This preserves the Hermes principle: one execution plane, specialized domains.

## New durable records

### accounting_capability_flags

Tenant-scoped, versioned activation for:
- FINANCIAL_EXECUTION;
- FISCAL_SUBMISSION.

Both `enabled` and `real_provider_enabled` default to false.

### accounting_execution_bindings

Binds an Accounting operation to the canonical Hermes execution job/attempt.

Database uniqueness enforces:
- one logical operation per tenant/capability;
- one idempotency key per tenant/capability.

This moves the critical duplicate-prevention invariant below JavaScript into PostgreSQL.

## Migration policy

The migration is structural only and is never auto-applied by this code change. Deployment follows the existing Hermes migration process.

## Remaining integration

C25 should implement the repository/service adapter that transactionally:
1. reads tenant capability flag;
2. creates/adopts canonical execution job;
3. inserts Accounting binding;
4. materializes/claims an execution attempt through the existing Hermes runtime;
5. never invokes a real provider while production gates remain false.
