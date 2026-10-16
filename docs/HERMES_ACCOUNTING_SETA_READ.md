# C3 — Seta Read Adapter Foundation

C3 introduces the boundary between Linx/Seta facts and the Hermes Accounting canonical model.

## Security posture

The adapter is `READ_ONLY`.

```text
adapter_id = seta_read_v1
mode = READ_ONLY
create/update/delete/execute = false
direct_db_write = false
source_of_truth = SETA
local_copy = EVIDENCE_CACHE
fail_closed = true
audit_required = true
transport_status = DISCOVERY_REQUIRED
```

No official Grupo Erick Seta endpoint or authentication contract is assumed by this layer. Until documented official transport is confirmed, connection attempts must fail with `DISCOVERY_REQUIRED`.

## Initial mapping

Seta stores, sales, purchases, receivables/crediário, payables, inventory movements, goods receipts, fiscal-document references, payments and counterparties map into C1 canonical entities.

Unknown record kinds fail closed rather than being guessed.

## Sync semantics

Every normalized fact carries:
- source id/reference;
- source update timestamp;
- ingestion timestamp when supplied;
- deterministic SHA-256 payload hash;
- company and store dimensions;
- evidence references.

Same source payload/hash is ignored idempotently. A changed payload creates a new version; it must not silently overwrite history.

## Transport preference

When transport discovery is performed later, prefer:
1. official Linx/Seta API;
2. homologated integration;
3. authorized read-only database/export when necessary.

Direct database writes are forbidden by this adapter.

## Not implemented in C3

- credentials;
- production endpoint;
- polling scheduler;
- database persistence;
- webhook;
- Seta write operations;
- chat/runtime exposure.
