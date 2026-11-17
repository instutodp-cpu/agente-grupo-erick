# Hermes Runtime Host Boundary V1

This boundary introduces the smallest reusable host/process contract for the
Hermes runtime. It is not the API entrypoint and is not connected to a
consumer, signal handler, server, worker, provider, or deployment.

## Lifecycle

`createHermesRuntimeHost` receives one explicit `runtime_input` and two
dependency factories: the D4-C provisioning source and the D4-A runtime
composition factory. Construction is inert. `start()` is explicit, shared
across repeated calls, and creates one provisioning result and one runtime
composition. `close()` is explicit, shared, idempotent, and closes the runtime
composition through its existing D3 owner. Consumers receive only the
persistence and registry references; close ownership remains with the host.

Closing before starting is a safe no-op that prevents a later start. If
startup fails after a composition has been created, the host attempts to close
that composition before propagating the startup error. No fallback consumer is
created.

## Dependency and ownership boundary

The host does not know how `memory` or `postgres` is selected. D2 remains the
authority. The host passes an empty selection environment to the existing
composition boundary so the current safe memory default remains explicit and
no ambient process configuration activates PostgreSQL.

The started value exposes only the provisioning result, persistence, and
registry. It does not expose the durable composition, lifecycle owner, or close
operation to future consumers. A later runtime-wiring checkpoint may inject the
references into a real Hermes consumer and connect this host to the actual
process lifecycle.

No environment variables, database connections, signals, process exits,
secrets, migrations, workers, providers, or network operations are used by
this boundary.
