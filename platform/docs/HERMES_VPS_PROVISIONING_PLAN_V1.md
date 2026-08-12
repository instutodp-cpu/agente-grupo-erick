# Hermes VPS Provisioning Plan V1

`hermes-vps-provisioning-plan-v1` is a declarative, deterministic and
auditable transition plan. It consumes the canonical Bootstrap Contract V1
and does not implement a provisioner.

```text
Bootstrap Contract
        |
Provisioning Plan
        |
[future Execution Authorization]
        |
[future Provisioner/Executor]
        |
VPS real
```

The two final stages are outside this checkpoint.

## Contract boundary

The plan is always generated and validated as `PLAN_ONLY`. It has no SSH,
shell, provider, network, filesystem, firewall, package, service, DNS, TLS,
secret-writing or deployment executor. `PLAN_CREATED != EXECUTION_AUTHORIZED`
and `EXECUTION_AUTHORIZED != EXECUTION_PERFORMED`.

Generation requires a valid Bootstrap Contract V1 and carries its exact
version/hash reference. The plan uses stable canonical serialization and a
SHA-256 material hash. No timestamps, random values, UUIDs, external state or
network results participate in the hash.

## Phases and steps

V1 orders host validation, OS preparation, service identity, filesystem
layout, runtime dependencies, network/firewall intent, application revision,
persistent data/logging, service supervision intent, readiness verification,
and final handoff. Every phase and step has explicit preconditions,
authorization boundary, intended effect, verification, failure behavior and
idempotency identity.

Network, shell, provider and secret requirements are descriptive metadata only.
Secret fields contain categories/references, never secret material. Safe mode
is mandatory, production is forbidden, and all rollback behavior is abort-and-
preserve-evidence.
