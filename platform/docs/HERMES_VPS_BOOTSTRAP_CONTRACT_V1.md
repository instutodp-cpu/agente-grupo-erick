# Hermes VPS Bootstrap Contract V1

`hermes-vps-bootstrap-contract-v1` is a provider-neutral, versioned contract
for a future Linux host that may run the Hermes Execution Plane. It is an
architecture and validation boundary, not a provisioning implementation.

## Guarantees

- V1 is staging-only and defaults to `HERMES_HOST_SAFE_MODE`.
- Inbound and outbound network policies are deny-by-default; public access is
  limited to the declarative HTTPS route and no firewall is changed here.
- SSH root/password access, plaintext secrets, missing resource limits,
  missing health checks, and missing exact revision provenance are rejected.
- Bootstrap plans are deterministic, idempotency-keyed, reversible where
  possible, and contain no executor. Preflight accepts typed fixtures only.
- Receipts are schemas with redaction constraints; this checkpoint creates no
  operational receipt.

## Explicit non-goals

This contract does not buy or access a VPS, install packages, configure SSH,
DNS, TLS, firewalls, Docker, systemd, secrets, queues, schedulers, workers,
providers, or production systems. A host existing does not authorize any
capability. `SERVICE_RUNNING != EXECUTION_AUTHORIZED` and
`HOST_PRESENT != CAPABILITY_AUTHORIZED`.

## Boundaries and future authorization

The Control Plane remains Maestro/Base44 and the Execution Plane remains the
provider-neutral Hermes host. Provider, shell, network, scheduler, queue,
worker, secret resolution, operational persistence, and production effect are
all disabled in safe mode and require separate authorization contracts.
The Public Web Canary remains an isolated, non-secret, read-only health
surface at `/hermes-canary/v1/health`.

## Bootstrap, preflight, execution, and receipt

`buildHermesVpsBootstrapPlan` only describes future steps. The preflight
validator evaluates a supplied host fixture without discovering a real host.
Future execution is a separate, authorized implementation. A receipt records
future evidence and must never contain secret values.

## Operations and migration

The intended deployment is containerized and reproducible, with Docker Compose
preferred, immutable revisions, health gates, bounded logs, restore-tested
backups, and rollback. These are declarative requirements only. Because no
provider API, hostname, domain, or credential is encoded, a later operator can
move between compatible VPS providers without changing the Hermes contract.
