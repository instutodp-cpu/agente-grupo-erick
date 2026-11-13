# C6 — Reconciliation Engine

C6 reconciles accounting evidence without allowing probabilistic guesses to become facts.

## Matching ladder

0. strong identity — transaction IDs, access keys, endToEndId, NSU/auth identifiers when authoritative;
1. deterministic composite — governed combinations of amount/date/account/counterparty/reference;
2. temporal — deterministic bounded time-window rules;
3. grouping — 1:1, 1:N, N:1 and N:M;
4. fuzzy — candidate generation only;
5. AI-assisted — hypothesis/explanation only.

Levels 4 and 5 always produce `NEEDS_REVIEW`. Confidence never promotes them to `MATCHED`.

## Statuses

`MATCHED | PARTIAL | UNMATCHED | CONFLICT | NEEDS_REVIEW | EXPLAINED_VARIANCE | BLOCKED`

A contractual fee may produce `EXPLAINED_VARIANCE`; the variance remains explicit and auditable.

## Core chains

C6 is designed to support:
- SALE ↔ FISCAL DOCUMENT ↔ PAYMENT ↔ BANK;
- PURCHASE ↔ NF-e ↔ GOODS RECEIPT ↔ PAYABLE ↔ BANK;
- crediário receivable ↔ receipt ↔ bank/cash;
- cash events ↔ daily close;
- later card/acquirer chains in C7.

## Exceptions

Accounting exceptions are first-class records, not log strings. They carry reason, severity, evidence and review state.

Late evidence creates a new reconciliation/version in the persistence layer that follows; history must not be silently rewritten.

## Learning boundary

Human resolutions may improve future candidate generation. A heuristic cannot silently become a deterministic business rule. Promotion requires simulation, ground truth and human approval.

## Not implemented

- persistent reconciliation store;
- fuzzy similarity model;
- LLM call;
- automatic exception resolution;
- write-back to source systems.
