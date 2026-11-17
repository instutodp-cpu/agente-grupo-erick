# C26 — Accounting PostgreSQL / Execution Plane E2E Gate

C26 adds a local integration gate to the existing PostgreSQL CI service. The test is enabled only for an allowlisted local DSN whose host is loopback and whose database name is \`hermes_test\` (optionally with a local suffix). Otherwise the database test is skipped.

## What it proves

Against the isolated local CI database, the test applies only the canonical execution-job, execution-attempt and C24 Accounting migrations, then verifies:

- capability flags persist with \`enabled=false\` and \`real_provider_enabled=false\`;
- Accounting bindings reference the canonical Hermes execution-job table;
- duplicate \`tenant + capability + idempotency_key\` is rejected by PostgreSQL;
- the C25 handoff traverses job admission → attempt materialization → attempt admission;
- the admitted result remains \`executed=false\`, \`externalEffectAllowed=false\` and \`realProviderAllowed=false\`.

The database test cleans only the synthetic \`tenant-c26\` rows it owns. The runtime test uses an in-memory fake adapter and does not call PostgreSQL.

## Safety boundary

This is a durable Simulation/Shadow integration gate, not production execution authorization. It does not use Supabase, bank/Pix/fiscal providers, secrets, external network endpoints or deployment. It does not execute payment, fiscal submission or any provider call.
