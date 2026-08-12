# Hermes VPS Authorization Lifecycle Registry V1

This contract is the in-memory, deterministic lifecycle boundary between the
Hermes VPS Execution Authorization Contract V1 and a future execution
boundary. It is deliberately not a database, distributed registry, executor,
or provisioner.

## Invariants

- Every entry is bound to one immutable `authorization_id`.
- Registration validates the authorization against the exact Provisioning Plan
  version and SHA-256 hash supplied when the registry is created.
- Consumption validates the requested phase/step scope, plan hash, expiry,
  revocation state, and single-use state before one synchronous state change.
- A second consume is reported as `ALREADY_CONSUMED`; conflicting identifiers,
  malformed entries, unknown states, and mismatched plans/scopes fail closed.
- Revocation records carry the same `authorization_id`; a non-empty unrelated
  record is never evidence for the authorization being evaluated.
- Receipts and lifecycle fingerprints use the repository's canonical stable
  serialization and SHA-256 content digest. No secret values are accepted.

## Atomicity and recovery boundary

The registry provides **logical atomicity** for its synchronous in-memory
compare-and-consume operation. It does not provide durable or distributed
atomicity across processes, hosts, or restarts. `exportLogicalSnapshot` and
`restoreLogicalSnapshot` are deterministic test/contract representations only;
they are not persistence. A future durable registry/persistence adapter must
define crash recovery, replay persistence, concurrency, and durability before
any executor may rely on them.

`PLAN_CREATED != AUTHORIZATION_CREATED != EXECUTION_AUTHORIZED !=
EXECUTION_PERFORMED`. This registry does not call providers, SSH, shells,
networks, workers, queues, schedulers, or persistence systems.
