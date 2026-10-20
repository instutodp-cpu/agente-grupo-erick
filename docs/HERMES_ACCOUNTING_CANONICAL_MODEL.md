# C1 — Canonical Accounting Model

C1 defines the common language used by future Hermes Accounting adapters and engines. It does not connect to external systems and does not alter runtime routing.

## Canonical entities

The executable catalog lives in `src/hermes/accounting/canonical-model.js` and covers organizational, transactional, fiscal, banking, inventory, payroll, reconciliation, evidence, rule, approval, close and audit records.

Every canonical record carries, at minimum:

- `schemaVersion`;
- `entityType`;
- `id`;
- `tenantId`;
- `companyId`;
- optional `establishmentId`;
- `sourceSystem`;
- `sourceReference`;
- `occurredAt`;
- optional `competence`;
- `authorityLevel`;
- optional `valueState`;
- `evidenceIds`;
- domain-specific `payload`.

## Authority

The canonical model reuses the C0 authority vocabulary:

`READ | ANALYZE | PREPARE | WRITE | MONEY | FISCAL_SUBMIT`.

Unknown authority values fail closed.

## Value state

`FORECAST | EXPECTED | ASSESSED | PAID | RECONCILED`.

These states are deliberately separate. A forecast must not be promoted to an assessed liability or a paid/reconciled fact by inference.

## Money

Domain payloads should represent money in integer minor units (for BRL, cents) whenever Hermes performs deterministic arithmetic. Floating-point values must not become the authoritative calculation representation.

## Provenance

`sourceSystem` and `sourceReference` are mandatory. Evidence becomes a first-class contract in C2; C1 only reserves `evidenceIds` so adapters cannot normalize away provenance.

## Multi-company / multi-store

`tenantId + companyId + establishmentId` is preserved as a dimension boundary. Future adapters must not collapse stores into a single accounting entity merely because reporting is consolidated.

## Safety

C1 contains no:

- external connector;
- database migration;
- payment;
- fiscal submission;
- write to Seta/Linx;
- route integration;
- autonomous action.

It is a vocabulary and validation foundation only.
