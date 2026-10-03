# C7 — Card / Acquirer Reconciliation

C7 models the card lifecycle as a subledger rather than comparing sale gross value directly to bank net settlement.

```text
SALE
→ CARD_TRANSACTION
→ CARD_RECEIVABLE / INSTALLMENTS
→ ACQUIRER_SCHEDULE
→ FEES / MDR
→ OPTIONAL ANTICIPATION
→ SETTLEMENT
→ BANK
```

## Identity

Card facts should preserve acquirer, merchant/terminal, NSU and/or authorization code, brand, modality, installment count and evidence.

## Gross, fees and net

Gross sale, MDR, other fees and expected/actual net are distinct values. Fees are audited against a versioned acquirer contract. A mismatch becomes reviewable evidence rather than an adjusted number.

## Anticipation

Anticipation is not normal settlement. It is modeled separately with:
- selected receivables;
- gross amount;
- anticipation fee;
- net amount;
- occurrence date.

Arithmetic must close exactly in integer cents.

## Chargeback

Chargeback is a separate lifecycle event linked to the original card transaction and evidence. Hermes may prepare an external defense packet, but C7 grants no authority to submit it autonomously.

## Cancellation coherence

Future ingestion must cross-check sale cancellation, fiscal cancellation, acquirer cancellation/refund and bank settlement. One source alone cannot silently erase the others.

## Not implemented

- production acquirer connector;
- merchant credentials;
- automatic chargeback defense;
- settlement persistence;
- bank write/payment capability.
