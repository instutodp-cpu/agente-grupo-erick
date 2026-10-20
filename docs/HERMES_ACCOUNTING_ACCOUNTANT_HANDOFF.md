# C18 — Accountant Handoff & Collaboration

C18 closes the first accounting operating cycle by packaging reconciled, closed and independently audited work for accountant review.

## Handoff package

A versioned handoff binds:
- ClosePackage;
- InternalAuditPackage;
- evidence manifest;
- open/non-critical exceptions;
- journal entries;
- tax/labor obligations;
- supporting evidence.

The package is immutable. A later package supersedes an earlier version instead of rewriting history.

## Readiness gate

A package is `READY_FOR_ACCOUNTANT` only when:
- close is ready/closed;
- independent audit is PASS;
- evidence is complete;
- no critical exception remains open.

## Lifecycle

`DRAFT → READY_FOR_ACCOUNTANT → DELIVERED → UNDER_REVIEW → ACCEPTED`

The accountant may request changes, producing:
`UNDER_REVIEW → CHANGES_REQUESTED → UNDER_REVIEW`.

Stages cannot be silently skipped.

## Accountant feedback

Comments and change requests are first-class traceable records. A requested correction identifies its target and reason.

A change to closed/accounted material:
- does not mutate the old record;
- requires evidence;
- requires approval;
- creates a new version;
- can trigger controlled reopen/reconciliation as required by earlier layers.

## Collaboration principle

The goal is to replace fragmented PDF/spreadsheet/email/WhatsApp exchanges with a governed accounting handoff while preserving the accountant's professional review role.

## Not implemented

- accountant portal/UI;
- external accounting-software API/export;
- notification transport;
- digital signature;
- production persistence.
