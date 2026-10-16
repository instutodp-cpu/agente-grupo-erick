# C12 — Fiscal / SPED Validation

C12 builds a pre-submission fiscal validation layer.

```text
SETA + FISCAL DOCUMENTS + INVENTORY + ACCOUNTING + RULE REGISTRY
→ FISCAL VALIDATION
→ EXCEPTIONS
→ PRE-SPED / PRE-OBLIGATION
→ HUMAN / ACCOUNTANT REVIEW
→ SUBMISSION (future authorized integration)
```

## Document validity != tax correctness

A valid signed/schema-compliant NF-e can still contain an incorrect tax classification. C12 therefore validates fiscal classification separately.

Relevant classification dimensions include CFOP, NCM, CEST, CST/CSOSN, origin, ICMS, IPI, PIS, COFINS, IBS and CBS as applicable.

## Rules

Every authoritative validation requires a versioned rule with authority, official source, effective dates and schema hash. An expired or not-yet-effective rule fails closed.

## Cross-checks

Fiscal facts are checked against purchase, inventory, payable and journal evidence. Fixes should target the originating fact/process rather than merely editing an output file.

## Obligation lifecycle

`FORECAST → PREPARING → VALIDATING → READY_FOR_REVIEW → APPROVED → SUBMITTED → ACCEPTED/REJECTED → PAID → RECONCILED`

Important:

```text
SUBMITTED != ACCEPTED
ASSESSED != PAID
PAID != RECONCILED
```

Official rejection codes/evidence are preserved.

## Authority

Hermes may READ, ANALYZE and PREPARE. `FISCAL_SUBMIT` requires explicit human approval.

## Not implemented

- SPED/PVA execution;
- government credentials;
- production submission;
- authoritative Grupo Erick tax classification rules;
- automatic source-system correction.
