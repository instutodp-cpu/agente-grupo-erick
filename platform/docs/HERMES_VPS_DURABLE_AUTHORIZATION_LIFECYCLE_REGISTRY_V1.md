# Hermes VPS Durable Authorization Lifecycle Registry V1

This contract defines the persistence boundary required for a future durable
Hermes authorization lifecycle registry. It is not an executor and does not
perform provider, SSH, shell, network, worker, queue, scheduler, secret, or
production operations.

## Boundary

`PLAN != AUTHORIZATION != EXECUTION`. Persisting an authorization or consuming
one never performs the operation described by the Provisioning Plan.

The domain depends on a small persistence interface with `read`, `insert`,
`compareAndConsume`, and `revoke`. The compare-and-consume primitive is the
required atomic boundary: an adapter must commit only when the expected
fingerprint still matches, so conflicting consumers produce one winner.

## Durability statement

This PR defines durable semantics and tests them with a deterministic local
adapter that retains state across registry instances and can simulate read,
write, atomicity, and lost-response failures. That adapter is **not production
durable storage**. No database, filesystem, Redis, Supabase, Base44, or vendor
adapter is included.

A production adapter must provide transaction durability, crash recovery,
cross-process concurrency, and an explicit result for a commit whose response
was lost. Failures are fail-closed; a lost response is reconciled from stored
state and cannot create a second consume.

## Receipts and security

Receipts contain lifecycle facts only: authorization ID, plan binding, scope,
state, sequence, and deterministic SHA-256 material. They explicitly claim
`execution_performed: false` and `production_effect: ZERO`. Secret values and
credentials are forbidden from persisted entries, hashes, receipts, and tests.
