# Hermes VPS Runtime Composition Root V1

This boundary formalizes the future Hermes process composition without
changing the current API entrypoint or activating durable persistence.

## Contract

`createHermesVpsRuntimeComposition` receives an explicit
`provisioning_plan` and delegates persistence selection to the existing PR-D2
composition. It then creates exactly one PR-D3 lifecycle owner. The returned
boundary exposes `persistence`, `registry`, `lifecycle_owner`, and `close()`.

The boundary does not parse environment variables, choose `memory` or
`postgres`, create a second persistence implementation, register process
signals, start a server, or open a database by itself. Selection remains the
responsibility of the existing D2 factory and its safe `memory` default.

## Ownership

The caller that creates this runtime composition owns the returned boundary.
Consumers receive only the persistence and registry references. They do not
receive the durable composition and must not close its resources directly.
The lifecycle owner is the sole owner of the durable composition close path;
its existing shared close promise provides idempotent sequential and
concurrent teardown.

## Deferred wiring

This PR-A boundary is intentionally not imported by
`platform/services/api/src/index.js`. The current API bootstrap has no
authoritative Hermes provisioning-plan input or Hermes durable consumer yet.
The later runtime-wiring checkpoint must provide that input, create one
runtime composition at the process composition root, inject its references,
and connect `close()` to the existing shutdown owner without changing backend
selection or enabling PostgreSQL implicitly.

No PostgreSQL connection, migration, secret, production write, worker,
provider, or deployment is introduced here.
