# C8 — Accounts Payable, Accounts Receivable and Crediário

C8 enforces the distinction:

```text
DOCUMENT != OBLIGATION != PAYMENT != SETTLEMENT
```

## Accounts payable

The target chain is:

```text
PURCHASE ORDER → NF-e → GOODS RECEIPT → OBLIGATION → INSTALLMENTS
→ PAYMENT PREPARATION → BANK PAYMENT → SETTLEMENT
```

C8 only reaches `READY_FOR_PAYMENT`. It does not execute money movement.

Readiness requires deterministic checks for document, receipt, amount, beneficiary, duplicate detection and evidence completeness. Any missing check produces `BLOCKED`.

## Accounts receivable / crediário

Receivables preserve original amount, paid amount, outstanding balance, due date, installment and evidence.

Aging buckets:
- A_VENCER
- 1_30
- 31_60
- 61_90
- 91_120
- 120_PLUS

Credit policy is versioned. Limit changes, discounts, renegotiation and negative-listing effects remain human-approval actions. Hermes may analyze and prepare; it does not autonomously punish or restrict a customer.

## Duplicate detection

Same company + counterparty + source document + installment with the same amount/due date is a duplicate candidate. Identity collision with differing financial facts is a conflict, not a silent overwrite.

## Cash forecasting

C8 establishes the facts needed for future deterministic cash forecasts at 7/14/30/60/90 days. Forecasting does not change obligation state.

## Not implemented

- payment execution;
- autonomous collections;
- autonomous credit-limit mutation;
- negative-listing submission;
- bank write;
- persistence/scheduler.
