# C15 — eSocial, EFD-Reinf, DCTFWeb and FGTS Digital

C15 models official government-obligation integrations without granting autonomous submission authority.

```text
PAYROLL / HR / COMMISSIONS
→ EXPECTED OBLIGATIONS
→ eSocial / EFD-Reinf
→ DCTFWeb
→ DARF
→ PAYMENT
→ BANK
→ ACCOUNTING
→ RECONCILED
```

FGTS Digital follows its corresponding official obligation/payment chain.

## Government event lifecycle

`DRAFT → VALIDATED → READY_FOR_REVIEW → APPROVED → READY_TO_SUBMIT → SUBMITTED → PROCESSING → ACCEPTED | REJECTED`

`SUBMITTED != ACCEPTED`. Official rejection codes/messages and protocols are preserved.

## Versioning and validation

Every event carries government schema and rule versions. Before review it must pass schema, business-rule, dependency, cross-source and evidence checks.

## Rectification

A rectification creates a linked replacement event. The original event is retained and never silently overwritten. Corrections should originate from the source fact when possible.

## DCTFWeb / payment document

The official assessment and its DARF/payment document remain distinct records. C15 preserves expected, reported, assessed, guide, paid and reconciled concepts instead of collapsing them.

## Reconciliation gate

True reconciliation requires:
- expected amount matched;
- reported event matched;
- official assessment matched;
- guide matched;
- bank payment confirmed;
- accounting recorded.

## Authority

`FISCAL_SUBMIT` remains human-approved. Credentials, certificates and production submission transports are not implemented here.

## Core invariants

```text
SUBMITTED != ACCEPTED
ASSESSED != PAID
PAID != RECONCILED
```

## Not implemented

- production eSocial transport;
- production EFD-Reinf REST/webservice transport;
- DCTFWeb/MIT production submission;
- FGTS Digital production transport;
- certificate/credential storage;
- autonomous guide payment.
