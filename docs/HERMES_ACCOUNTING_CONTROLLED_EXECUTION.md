# C21 — Controlled Financial Execution Gateway

C21 defines the execution boundary for future real financial actions. It does not enable production payments.

## Default state

`featureEnabled = false`

`realProviderEnabled = false`

Both must be explicitly enabled by controlled production configuration before an execution can become authorized.

## Authorization gates

Every execution requires:
- approved C20 payment instruction/envelope;
- preparer different from approver;
- non-expired envelope;
- allowlisted destination;
- amount within policy limit;
- idempotency key;
- feature enabled;
- real provider enabled.

Any missing condition fails closed.

## Idempotency

An execution key must be reserved in a persistent transactional store before provider submission. Reuse is denied. The current module models the contract; production persistence remains future integration work.

## State semantics

`AUTHORIZED != SUBMITTED != CONFIRMED != RECONCILED`

A provider request being accepted does not prove money movement. Provider confirmation is separately recorded, and bank evidence must then reconcile amount and destination.

## Credentials

Provider credentials must never be exposed to the LLM. Production adapters must use secret-managed server-side credentials and audited gateway calls.

## Promotion

Real provider enablement requires prior Ground Truth, Shadow and human-supervised gates. C21 code existing in the repository is not permission to activate production execution.

## Not implemented

- real bank/Pix connector;
- secret manager integration;
- persistent idempotency transaction;
- production feature-flag store;
- refund/reversal execution.
