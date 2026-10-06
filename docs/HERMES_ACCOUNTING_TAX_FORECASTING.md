# C14 — Taxes & Tax Forecasting

C14 separates tax forecasting from official assessment, payment and reconciliation.

```text
FORECAST → EXPECTED → ASSESSED → GUIDE_ISSUED → PAID → RECONCILED
```

A forecast never becomes an official liability merely because Hermes calculated it.

## Simples Nacional / DAS

Simples forecasting requires versioned official rules and inputs such as current-period revenue, RBT12, business segments/annex and applicable effective-rate logic. C14 stores deterministic forecast outputs but does not hard-code an authoritative tax table in this layer.

Official PGDAS-D assessment must later be reconciled against Hermes' expectation. Differences become tax exceptions.

## Payroll-derived taxes and charges

C13 supplies labor facts. C14 models expected obligations such as FGTS, previdenciary amounts and IRRF while preserving their source/lifecycle. C15 will connect official eSocial, EFD-Reinf, DCTFWeb and FGTS Digital flows.

## DAE

DAE is modeled as a collection/payment document where applicable, not as a tax type by itself.

## Sources

Supported obligation-source categories include eSocial, EFD-Reinf, MIT, PGDAS-D, state, municipal and other governed sources.

## Cash forecasting

Unpaid obligations feed deterministic 7/14/30/60/90-day cash horizons. Scenario names are CURRENT, EXPECTED, CONSERVATIVE and STRESS and remain simulations.

## Authority

Guide issuance and payment execution are consequential effects and require explicit human approval. This layer does not autonomously issue or pay tax guides.

## Core invariants

```text
FORECAST != ASSESSED
ASSESSED != PAID
PAID != RECONCILED
```

## Not implemented

- authoritative current Simples tables/rates;
- PGDAS-D submission;
- DCTFWeb/MIT submission;
- FGTS Digital integration;
- tax guide payment execution.
