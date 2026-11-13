# C26 — Accounting PostgreSQL / Execution Plane E2E Gate

C26 adds an integration gate to the existing PostgreSQL CI service.

The test applies the canonical execution-job and execution-attempt migrations plus C24 Accounting bindings against the isolated local `hermes_test` PostgreSQL database.

It proves:
- Accounting capability flags persist with both execution switches false by default;
- Accounting bindings reference the canonical Hermes execution job table;
- duplicate `tenant + capability + idempotency_key` is rejected by PostgreSQL itself;
- the C25 handoff traverses job admission → attempt materialization → attempt admission;
- the admitted result still reports `executed=false` and `externalEffectAllowed=false`.

No bank, Pix, fiscal authority, provider credential or external network endpoint is configured by C26.

This is a durable Simulation/Shadow integration gate, not production execution authorization.
