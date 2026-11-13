# C22 — Controlled Fiscal Submission Gateway

C22 defines the controlled boundary for future real fiscal/government transmissions. Production transmission remains disabled by default.

## Defaults

`featureEnabled = false`

`realProviderEnabled = false`

## Supported contract targets

The gateway contract can represent eSocial, EFD-Reinf, DCTFWeb, FGTS Digital, NF-e, NFS-e and state/municipal obligations. A system must also be explicitly allowlisted by policy.

## Authorization gates

Before authorization:
- schema must be valid;
- temporal rule version must be effective;
- business validation must pass;
- evidence must be complete;
- human approval must exist;
- preparer and approver must differ;
- envelope must not be expired;
- idempotency key must exist;
- feature and real provider must be enabled.

Any missing condition fails closed.

## State semantics

`AUTHORIZED != SUBMITTED != PROCESSING != ACCEPTED != RECONCILED`

A transport receipt/protocol proves receipt only. Official acceptance is recorded separately. Official rejection code/message is preserved.

After acceptance, Hermes still reconciles the official obligation and accounting record before reaching `RECONCILED`.

## Idempotency

Submission keys must be transactionally reserved in production. Reuse is denied by contract.

## Credentials

Certificates, tokens and provider credentials remain server-side and outside LLM context.

## Not implemented

- production government transport;
- certificate/secret manager integration;
- persistent idempotency transaction;
- production feature flag;
- automatic rectification submission.
