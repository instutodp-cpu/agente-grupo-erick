# C4 — NF-e/NFC-e Fiscal Document Intake

C4 establishes the fiscal-document ingestion boundary. It does not connect to SEFAZ yet.

## Pipeline

```text
RECEIVED
→ PRESERVED
→ SIGNATURE_CHECK
→ SCHEMA_CHECK
→ BUSINESS_VALIDATION
→ NORMALIZED
→ ENTITY_RESOLUTION
→ RECONCILIATION
→ READY_FOR_ACCOUNTING
```

Signature/schema uncertainty routes to `QUARANTINED`, not to best-effort acceptance.

## Original evidence

The received XML is preserved with SHA-256. Normalization and later accounting facts must reference the preserved source; they do not replace it.

For the same access key:
- same hash → `IGNORE_IDENTICAL`;
- different hash → `CRITICAL_CONFLICT`.

## Fiscal events

Cancellation, correction letter and recipient-manifestation events are separate linked records. They never overwrite the original NF-e/NFC-e.

Recipient manifestation actions such as Ciência, Confirmação, Desconhecimento and Operação não Realizada are classified as `FISCAL_SUBMIT` and therefore require the C0 human-approval boundary.

## Future official transport

A later integration layer may use official NF-e Ambiente Nacional distribution by company CNPJ/NSU and a credential broker for certificates. C4 deliberately contains no certificate, secret, endpoint credential or transmission code.

## Not implemented

- SEFAZ network calls;
- certificate handling;
- schema/XSD download;
- tax correctness calculation;
- recipient manifestation submission;
- persistence;
- automatic accounting entry.
