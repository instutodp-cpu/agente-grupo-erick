# Hermes VPS Shared Durable Coordination and Audit Boundary V1

This document defines the Hermes/VPS-specific coordination boundary between
the existing authorization, lifecycle, attempt ownership, trusted admission,
and a future executor. It is a contract and deterministic reference model;
it is not a production storage implementation.

## Responsibility

The boundary coordinates one canonical snapshot containing:

- authorization identity and scope binding;
- the exact consumed lifecycle reference;
- attempt identity and owner binding;
- trusted admission identity and handoff fingerprint;
- replay and correlation references;
- an admission audit reference and receipt placeholder.

The boundary exposes one atomic coordination primitive. A conforming durable
adapter must compare the supplied fingerprints/versions and conditionally
persist the complete coordination snapshot as one durable operation. A caller
must not reconstruct this with separate reads and writes.

The existing canonical contracts remain the source of authorization,
lifecycle, ownership, and admission meaning. This boundary does not mint
replacement identities or authorize execution.

## Identity and Atomicity

The active-attempt coordination key is derived from the existing
authorization ID, execution scope key, plan version, and plan hash. The replay
key is derived from the existing authorization ID, lifecycle reference,
attempt ID, owner reference, handoff fingerprint, and admission ID.

For first admission coordination, the following are one atomic write unit:

1. lifecycle consumption evidence;
2. attempt and owner binding;
3. trusted admission consumption evidence;
4. replay marker;
5. audit reference;
6. receipt placeholder.

The final outcome of a future external operation is outside this boundary and
requires a separate idempotency and recovery contract.

## Reconciliation States

- `CONSISTENT`: all references and expected versions agree.
- `PARTIALLY_PERSISTED`: only part of the coordination record is present;
  execution is forbidden.
- `REPLAY_REQUIRED`: the request may have committed before its acknowledgement;
  resolve it from durable truth.
- `RECONCILIATION_REQUIRED`: canonical references or versions disagree;
  freeze the record and reconcile it.
- `TERMINALLY_REJECTED`: malformed, stale, conflicting, revoked, or otherwise
  invalid state.
- `UNKNOWN_UNSAFE`: the durable outcome cannot be established.

Only a consistent record may be returned as a first commit or exact replay.
Every state has `execution_allowed: false` and `production_effect: ZERO` in
this version.

## Retry and Concurrency

- One active attempt is permitted for an authorization/scope key.
- The first equivalent coordination request may commit once.
- An exact retry returns `SAME_RESULT_REPLAY` with the same record.
- A different attempt, owner, scope, lifecycle reference, or fingerprint is
  rejected as a conflict or stale request.
- A commit followed by a lost acknowledgement is resolved as exact replay.
- A request that did not commit may retry once and become the sole first
  commit.
- An ambiguous, malformed, or contradictory persistence result never grants
  an execution entitlement.

## Reference Adapter Boundary

The repository implementation includes only a deterministic in-memory
reference adapter for semantic tests and snapshot/restart simulations. Its
`REFERENCE_TEST_ONLY` claim is not evidence of database durability,
cross-process atomicity, or multi-instance safety.

A future production adapter must be introduced separately and must provide:

- durable conditional writes or equivalent transactions;
- uniqueness enforcement for active attempts;
- crash/restart recovery;
- consistent reads and version conflict handling;
- lost-response reconciliation;
- durable audit and receipt persistence.

No production adapter is implemented here.

## Explicit Safety Boundary

This contract introduces no executor, dispatcher, worker runtime, provider
integration, SSH transport, shell execution, deployment, production secret,
network execution, or VPS operation. It does not consume real authorization
or create production effects. `execution_allowed` remains false.
