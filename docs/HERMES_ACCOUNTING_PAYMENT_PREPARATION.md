# C20 — Payment Preparation & Controlled Financial Actions

C20 prepares a payment package without granting money-movement authority.

```text
OBLIGATION
→ DOCUMENT / GOODS / AMOUNT MATCH
→ BENEFICIARY + DESTINATION VERIFICATION
→ DUPLICATE CHECK
→ EVIDENCE
→ PAYMENT INSTRUCTION
→ HUMAN REVIEW
→ SEGREGATED APPROVAL
→ READY_TO_EXECUTE
```

## PREPARE != EXECUTE

A payment instruction has `PREPARE` authority. Even an approved execution envelope has `executionAuthorityGranted = false` in C20.

Actual bank/Pix execution is a later controlled-production capability and remains fail-closed here.

## Hard gates

A payment cannot become ready for review unless:
- obligation is matched;
- amount is matched;
- beneficiary is verified;
- destination account/key is verified;
- duplicate check passes;
- evidence is complete;
- due date is valid.

## Duplicate protection

Payment identity is deterministic over company, obligation, beneficiary, amount, due date and destination reference. Production execution must additionally enforce persistent idempotency at the gateway.

## Segregation

The payment preparer cannot approve the same payment.

## Execution envelope

C20 can create a future execution envelope with approval reference, idempotency key and expiry. The envelope is intentionally powerless until a later capability grants execution under stronger controls.

## Not implemented

- bank/Pix write connector;
- credential storage;
- payment execution;
- persistent idempotency/transaction lock;
- refund/reversal execution.
