# Hermes VPS Execution Attempt Ownership Contract V1

This contract is the boundary between a consumed durable authorization and a
future executor. It records ownership and lease state only. It does not call a
provider, open SSH, execute shell commands, start a worker, mutate a queue, or
perform an execution.

The contract preserves:

```text
PLAN != AUTHORIZATION != EXECUTION
```

An authorization may be consumed without creating an execution owner. A
claimed attempt identifies a single owner and a lease, but does not prove that
execution occurred.

## State model

```text
CLAIMABLE -> CLAIMED -> RUNNING -> SUCCEEDED
                              -> FAILED
                              -> UNKNOWN_OUTCOME
                              -> ABORTED
                              -> EXPIRED

CLAIMED -> UNKNOWN_OUTCOME | ABORTED | EXPIRED
```

`UNKNOWN_OUTCOME` is terminal for this contract. It prevents an automatic
retry when an external side effect may have occurred but its result is not
known. A running attempt that loses its lease is recovered to
`UNKNOWN_OUTCOME`; a claimed but not-started attempt is recovered to
`EXPIRED`. Neither state grants a new owner.

The test adapter provides logical compare-and-claim semantics and survives a
new registry instance while the adapter instance is retained. A production
distributed persistence adapter is not implemented here.

## Binding and receipts

Every attempt is bound to the authorization ID and hash, the exact consumed
lifecycle reference, provisioning plan version and hash, exact phase/step
scope, executor reference, attempt ID, lease ID, and idempotency key. The
canonical active-attempt uniqueness key is the digest of authorization ID,
plan version/hash, and exact execution scope. The persistence adapter must
enforce that key atomically; terminal states never release it for automatic
retry. Unknown or malformed states deny forward progress. Receipts contain lifecycle facts only and explicitly report
`execution_observed: false` and `production_effect: ZERO`.

## Excluded capabilities

This contract intentionally excludes providers, network, SSH, shell, secrets,
VPS provisioning, workers, queues, schedulers, dispatch, and a real executor.
Those require separate authorization and later checkpoints.
