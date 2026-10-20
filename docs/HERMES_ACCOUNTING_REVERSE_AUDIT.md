# C19 — Reverse Audit

C19 searches for accounting incompleteness from both directions instead of trusting that upstream ingestion captured everything.

## Principle

Normal trace:
`SOURCE → CANONICAL FACT → RECONCILIATION → JOURNAL → LEDGER`

Reverse trace:
`LEDGER / BANK / FISCAL / INVENTORY / PAYROLL → EXPECTED SOURCE AND CHAIN`

Both directions must agree.

## Examples

- bank credit without supported sale/receivable;
- ledger entry without fiscal/source evidence;
- NF-e purchase without goods receipt/payable/inventory consequence;
- inventory movement without supported operational event;
- payroll payment without payroll event;
- sale/card receivable without expected settlement.

## Gates

The engine checks:
- source records missing from ledger;
- ledger records unsupported by source;
- missing stages in an expected chain;
- orphan downstream records;
- exact integer-cent tie-outs.

A one-cent unexplained difference is an exception.

## Authority

Reverse Audit detects and explains exceptions. It never auto-corrects source data or journals.

## Relationship to C17

C17 defines independent audit assertions and packages. C19 provides a reusable reverse-tracing capability that C17 can invoke for completeness and occurrence testing.

## Not implemented

- production graph/index persistence;
- probabilistic entity linkage;
- automated source correction;
- domain-specific full-population adapters.
