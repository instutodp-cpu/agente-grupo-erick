# Hermes VPS Execution Handoff and Executor Admission Contract V1

This contract is the declarative boundary between a claimed execution attempt
and a future executor. It validates evidence; it does not execute an attempt.

```text
PLAN != AUTHORIZATION != OWNERSHIP != EXECUTION
```

## Required evidence

An accepted handoff binds the authorization ID and hash, provisioning plan
version and hash, exact phase/step scope, consumed lifecycle reference,
attempt ID and fingerprint, current owner, admission reference, operation
identity, and tenant/company/scope isolation reference.

The handoff fingerprint is SHA-256 over explicit canonical material. A
security-relevant mutation changes that fingerprint. Unknown fields,
unsupported versions, missing evidence, stale leases, terminal lifecycle or
attempt states, and any binding mismatch are rejected.

`CLAIMED` ownership and a `CONSUMED` lifecycle reference are required. An
authorization, attempt ID, or handoff document alone is insufficient.

## Admission and replay

`admitExecutionHandoff()` is pure and returns decision evidence only. It does
not persist, consume, claim, dispatch, or execute anything. The
`consumeExecutionHandoff()` boundary requires the dedicated
`atomicConsumeExecutionAdmission(request)` persistence interface. This single
durable operation compares the attempt fingerprint, claimed ownership,
consumed lifecycle reference and admission identity, then conditionally
persists the immutable `admission_consumption` marker. No public
read/check/write composition is sufficient to implement this interface.

The durable admission key is the canonical digest of authorization identity,
lifecycle-consumption reference, attempt identity, owner identity and handoff
fingerprint. A first call returns `FIRST_ADMISSION`; an exact persisted replay
returns `SAME_RESULT_REPLAY`; a conflicting replay, stale state or ambiguous
persistence outcome denies.

This defines the atomic admission/consumption contract, not exactly-once VPS
execution. The repository currently provides only a clearly test-only,
in-memory adapter for deterministic semantic tests; no production durable
backend is implemented here. A future durable adapter must provide the single
operation against shared durable storage. Crash/recovery and idempotency
around an external side effect remain responsibilities of a future executor
runtime.

## Trusted adapter boundary

The runtime entry point `consumeExecutionHandoff()` accepts only an adapter
with the private nominal trusted-adapter brand and the explicit certification
claim `ADAPTER_OWNER_RESPONSIBILITY`. A plain callback or structurally similar
object is rejected. Certification designates responsibility; it does not prove
that an external database is durable or atomic. The current Map-backed test
adapter is used only by isolated semantic tests and cannot satisfy the trusted
runtime boundary.

## Result envelope

The result schema correlates authorization, attempt, owner, handoff, and a
future result reference. It distinguishes admitted-without-execution,
rejected, succeeded, failed, and unknown outcomes. This contract cannot claim
that execution occurred: its own result envelope always has
`execution_performed: false` and `production_effect: ZERO`.

## Explicit exclusions

This milestone adds no provider, network, SSH, shell, worker, queue,
scheduler, dispatch, credential, secret, persistence adapter, or executor.
It provides no real-world exactly-once execution guarantee and no durable
provider outcome recovery. Those require separate authorized milestones.
