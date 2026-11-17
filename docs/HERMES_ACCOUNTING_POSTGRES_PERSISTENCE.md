# C24 — PostgreSQL Operational Persistence

C24 adds a structural persistence contract for the C23 operational control plane. It is not a runtime connection and is never auto-applied by this code change.

## Canonical runtime reuse

Accounting binds to the existing Hermes durable execution tables:

- \`hermes.execution_jobs\`;
- \`hermes.execution_attempts\`;
- the existing worker ownership and lease runtime.

No Accounting scheduler, worker, lease table or parallel execution plane is created.

## Durable records

\`accounting_capability_flags\` stores tenant-scoped, versioned flags for \`FINANCIAL_EXECUTION\` and \`FISCAL_SUBMISSION\`. Both \`enabled\` and \`real_provider_enabled\` default to false.

\`accounting_execution_bindings\` binds an Accounting operation to a canonical execution job and optional attempt. Database uniqueness enforces one logical operation and one idempotency key per tenant/capability.

## Safety boundary

The migration is structural only. The repository test reads the SQL as text and verifies foreign keys, uniqueness, bounded capabilities and fail-closed defaults. It does not connect to PostgreSQL, Supabase or any external provider.

No secrets, deployment, migration runner, scheduler, payment, fiscal submission or provider execution is included.

## Future integration

A later C25 bridge would still need an independent review, transaction-level repository contract, human approval and a new green CI result before any runtime integration. C24 alone grants no execution authority.
