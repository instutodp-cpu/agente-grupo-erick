# Hermes Core Business Domains Mission

## Objective
Turn the existing read-only contracts for compras, financeiro and treinamento into domain-specific, tested capabilities without bypassing Simulation First or protected authority.

## Audited baseline
- Intent-router availability exists for all three domains, but remains `planned`.
- `INTERNAL_BUSINESS_API_READ_ONLY.md` defines read-only business queries including `purchase_summary`, `financial_summary` and `training_progress_summary`.
- `PERMISSION_MATRIX.md` governs all three domains; compras and financeiro are high review, treinamento is medium review.
- `domain-mock-adapter-registry.js` provides mock adapters for all three domains.
- Generic adapter/boundary tests exist and prove the shared contract boundary only.
- No domain-specific real DataStore implementation was found in the audited repository baseline.

## Readiness classification
For the combined core-business-domains scope:
- planned: true
- contracted: true
- implemented: false
- tested: false
- proven_e2e: false
- operational: false

Generic mock/boundary tests do not promote domain-specific implementation or testing.

## Execution order
1. Compras: define deterministic read model and implement read-only DataStore adapter against simulation fixtures.
2. Financeiro: define deterministic read model with stricter sensitive-data/review policy and simulation fixtures.
3. Treinamento: define deterministic read model and simulation fixtures.
4. Add domain-specific contract and behavior tests for each.
5. Reconcile intent-router/capability metadata only after implementation evidence exists.
6. Run named CI/self-audit gate after each coherent increment.
7. Attempt bounded E2E only after implementation + tests are green.

## Safety boundary
- No purchase creation/cancellation.
- No payment, transfer, financial mutation or approval.
- No customer messaging.
- No production publication.
- No secrets or permission changes.
- No merge authority.
- Real external/DataStore execution remains denied until separately evidenced and authorized.

## Completion evidence
Each domain advances only with exact repository evidence for contract, implementation and tests. E2E and operational states require separate runtime evidence and may not be inferred from mocks, fixtures or CI.
