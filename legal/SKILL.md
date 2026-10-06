# Hermes Legal Super-Skill v1

Status: foundation / simulation-first / fail-closed.

## Mission
Transform a legal or compliance objective into an evidence-backed LegalMission:
intake -> source discovery -> authority verification -> analysis -> draft -> independent review -> approval -> controlled execution -> receipt -> reconciliation -> learning.

## Invariants
1. Evolution, not recreation: reuse Hermes missions, approvals, audit, idempotency, RLS, receipts and reconciliation.
2. Facts, internal documents, legal authorities, precedents, inference and recommendations remain distinguishable.
3. Material legal claims require traceable evidence and source provenance.
4. Authority is jurisdiction-aware and temporal-aware; superseded or future rules cannot silently govern an analysis.
5. Open-web discovery never outranks verified official authority merely because it is semantically similar.
6. Drafting and independent review are separate logical runs.
7. Skills request capabilities; provider credentials remain gateway-only.
8. External binding or judicial-effect actions require explicit human authorization and fail closed.
9. No filing, signature, settlement, termination, admission, binding notice or other external legal-effect action is enabled by this foundation.
10. Missing, conflicting or insufficient evidence must be surfaced; abstention is a valid outcome.
11. Confidentiality, tenant isolation, minimization and purpose limitation are foundational.
12. Simulation precedes activation; activation requires explicit readiness evidence.

## Capability families
research-authority; matter-management; document-intelligence; contract-intelligence; process-intelligence; deadline-obligation; drafting; review-risk; compliance; corporate-legal; litigation; executive-intelligence.

## Evidence classes
FACT | INTERNAL_DOCUMENT | LEGAL_AUTHORITY | PRECEDENT | INFERENCE | RECOMMENDATION

## Legal effect classes
none | advisory | internal | external_nonbinding | external_binding | judicial

## Foundation boundary
J01 defines contracts, capability inventory, invariants and deterministic validation only. It performs no provider call and mutates no external state.
