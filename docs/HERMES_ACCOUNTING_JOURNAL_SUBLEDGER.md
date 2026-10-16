# C11 — Journal Entry Preparation & Accounting Subledger

C11 converts reconciled facts into reviewable journal drafts.

```text
VERIFIED FACTS
→ VERSIONED ACCOUNTING RULE
→ JOURNAL DRAFT
→ DETERMINISTIC BALANCE CHECK
→ HUMAN REVIEW
→ APPROVAL
→ POSTING (future integration)
```

## Double entry invariant

Every entry must satisfy exactly, in integer cents:

```text
SUM(DEBIT) == SUM(CREDIT)
```

A R$ 0.01 difference blocks the entry.

Hermes must never create an unsupported balancing line, suspense amount or other plug merely to make a journal close.

## Chart of accounts

The chart of accounts is imported from an approved real accounting source and versioned. The LLM cannot invent the authoritative chart.

Account classification proposed by AI remains `NEEDS_REVIEW` until an approved mapping exists. Approved mappings may later become deterministic rules through the governed rule lifecycle.

## Dimensions

Journal lines may carry company, establishment, cost center and department dimensions.

## Economic state

Forecast, provision, assessed and paid values remain distinct. C11 does not collapse them into a single accounting truth.

## Posting authority

C11 prepares and validates entries. Posting requires explicit human approval and a future authorized write integration.

## Not implemented

- ERP/accounting-system posting connector;
- authoritative Grupo Erick chart of accounts;
- automatic suspense clearing;
- database ledger persistence.
