# Hermes VPS Durable Persistence Contract Compatibility V1

Status: PR-B.1 contract/schema hardening. No production adapter is included.

This document is the normative compatibility addendum to the architecture
contract and does not authorize production database access.

## Purpose

This document closes the compatibility boundary between the Hermes durable
authorization lifecycle contract and the PostgreSQL schema created by PR-B.
It does not implement PostgreSQL access, runtime selection, migration
application, shared coordination, or production writes.

## Persistence interface version

The lifecycle persistence interface is versioned as:

`hermes-vps-authorization-lifecycle-persistence-v2`

The four operations retain their existing meanings and now accept either a
plain result or a Promise resolving to the same result shape:

- `read(authorization_id)`
- `insert(entry, receipt)`
- `compareAndConsume(authorization_id, expected_fingerprint, entry, receipt)`
- `revoke(authorization_id, expected_fingerprint, entry, receipt)`

The registry preserves synchronous return values for synchronous adapters,
including the deterministic Map reference adapter. A Promise is propagated
only when the selected persistence method returns one. No blocking, process
execution, cache substitution, or synchronous wrapper is permitted.

Rejected Promises, malformed results, contradictory status/entry/receipt
shapes, and storage exceptions fail closed as persistence failures.

## Receipt boundary

The registry creates the deterministic lifecycle receipt before the mutating
persistence operation. The receipt is supplied as part of the same operation
that writes the lifecycle entry. The adapter must persist the lifecycle row
and receipt fields atomically.

The receipt contains the lifecycle event, canonical authorization identity,
state, sequence, deterministic receipt reference, fingerprint, receipt hash,
`execution_performed: false`, and `production_effect: ZERO`.

The existing PR-B columns are sufficient:

- `receipt_reference TEXT`
- `receipt_hash TEXT`

Both values are all-or-nothing under the existing database constraint. No
additional migration is required by PR-B.1.

On read, the adapter returns the persisted entry and receipt together. A
missing, malformed, or mismatched receipt is not executable state and must
fail closed. The later production adapter remains responsible for mapping
these values to the PostgreSQL row.

## Initial registration concurrency

The primary key on `authorization_id` remains the durable uniqueness
boundary. A future PostgreSQL adapter must perform the insert atomically and
return the existing canonical entry and receipt when an insert conflict can
be resolved safely.

| Concurrent case | Required result |
| --- | --- |
| Same identity and same fingerprint | `REPLAY_ACCEPTED` with the existing receipt |
| Same identity and different fingerprint | `CONFLICT` |
| Same identity and incompatible payload | `CONFLICT` |
| Commit wins while another request is inserting | The loser re-reads or receives the existing row and applies the table above |
| Commit outcome unknown | Fail closed; later retry reconciles from durable truth |

The application must not rely on a read/check/insert sequence outside the
database transaction. PostgreSQL constraints and transaction semantics are
authoritative for the race.

## Error semantics

- unique violation: deterministic `CONFLICT` or resolved replay;
- stale fingerprint: `CONFLICT`;
- invalid transition: rejected, never overwritten;
- unavailable or timeout: `READ_FAILED`/`WRITE_FAILED`;
- serialization failure or deadlock: bounded deterministic retry, then fail closed;
- malformed persisted row: invalid/failure result;
- unknown commit outcome: failure plus later reconciliation;
- receipt conflict or mismatch: fail closed;
- missing required durable configuration: startup/configuration failure in
  any future production adapter.

No error may be converted into authorization, admission, or execution
permission.

## Explicit non-goals

- no PostgreSQL client or production adapter;
- no migration file or migration execution;
- no runtime wiring or cutover;
- no Map fallback in production;
- no tenant/workspace/company dimensions;
- no shared coordination, lease, claim, fencing, executor, provider, SSH,
  worker, queue, scheduler, deployment, or production write.

`PRODUCTION_ADAPTER_IMPLEMENTED: NO`

`PRODUCTION_WRITES: 0`

`PR_D_SHARED_COORDINATION_IMPLEMENTED: NO`
