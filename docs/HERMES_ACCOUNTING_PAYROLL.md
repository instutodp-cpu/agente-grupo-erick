# C13 — Payroll, Commissions and Labor Provisions

C13 connects employment contracts, time facts and sales facts to deterministic payroll preparation.

```text
EMPLOYEE → CONTRACT / ROLE / STORE
→ TIME + SALES + HR EVENTS
→ VERSIONED RULES
→ DETERMINISTIC CALCULATION
→ PAYROLL PREVIEW
→ HUMAN REVIEW
→ OFFICIAL PAYROLL
→ PAYMENT
→ BANK
→ ACCOUNTING
```

## Facts are not legal effects

Time-clock and sales systems provide facts. Versioned labor/company rules determine their financial effect. The LLM may explain or flag ambiguity but does not authoritatively calculate payroll law from prose.

## Payroll events

Salary, commission, overtime, absence, DSR, vacation, vacation bonus, 13th salary, bonus, benefit, INSS, FGTS, IRRF, advance, deduction, termination and pró-labore remain distinct event types.

## Commissions

Commission plans are versioned. Eligible sales are calculated deterministically in integer cents. Expected commission is reconciled against payroll; even a one-cent difference becomes a payroll exception.

Signals suggesting sale reassignment around targets remain integrity signals only. They do not establish fraud, commission forfeiture or disciplinary punishment. Human review and applicable policy/legal process remain required.

## Provisions

Vacation, vacation bonus, 13th salary and applicable labor-charge provisions remain explicitly in `PROVISION` state until the lifecycle advances.

## High-risk effects

Termination and other consequential employment effects require human approval. C13 does not execute payroll payments or disciplinary actions.

## Dependencies

C13 supplies payroll/labor facts to C14 tax forecasting and C15 official eSocial/EFD-Reinf/DCTFWeb/FGTS Digital integrations.

## Not implemented

- authoritative Brazilian payroll rule tables;
- eSocial submission;
- FGTS Digital submission;
- bank payroll execution;
- autonomous HR sanctions.
