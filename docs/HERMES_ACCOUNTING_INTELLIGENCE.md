# C16 — Accounting Intelligence & Management Analytics

C16 turns reconciled accounting facts into management intelligence without allowing the LLM to manufacture financial truth.

```text
VERIFIED FACTS
→ DETERMINISTIC METRICS
→ ACCOUNTING INTELLIGENCE
→ EXPLANATIONS / ALERTS / SCENARIOS / RECOMMENDATIONS
```

## Views

`ACTUAL`, `FORECAST` and `FINAL` are explicit and must never be silently mixed.

## DRE and management scopes

Deterministic DRE/management views can be scoped by group, company, store, cost center or category. Labels such as EBITDA or net income must only be used when the accountant-approved accounting model defines them.

## Required assertion metadata

Every material financial assertion must expose:
- period;
- view;
- data freshness;
- coverage;
- reconciliation status;
- evidence count and evidence identifiers.

No evidence means no material assertion.

## Driver decomposition

Changes can be decomposed into explicit deterministic drivers. Any unexplained remainder stays visible rather than being filled by an AI narrative.

## Intelligence domains

The layer is designed to support:
- DRE and margin intelligence;
- supplier intelligence;
- inventory-to-cash;
- crediário;
- commissions/productivity;
- cash horizons;
- anomaly detection;
- daily CFO Brief.

## Anomalies

Deterministic/statistical detectors produce review signals. AI may contextualize them but does not conclude fraud or impose discipline.

## Natural-language analytics

The intended chain is:
`question → authorized query → deterministic metrics → evidence → LLM explanation`.

## Quality target

Material financial assertions target `unsupported_claim_rate = 0`. C16.5 adds a formal ground-truth evaluation harness.

## Not implemented

- production dashboard/UI;
- accountant-approved Grupo Erick DRE taxonomy;
- persistent analytical warehouse;
- autonomous management actions.
