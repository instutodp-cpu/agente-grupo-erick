'use strict';

const { createCanonicalRecord } = require('./canonical-model');
const { stableHash } = require('./evidence-ledger');

const SETA_ADAPTER_POLICY = Object.freeze({
  adapterId: 'seta_read_v1',
  mode: 'READ_ONLY',
  create: false,
  update: false,
  delete: false,
  execute: false,
  directDbWrite: false,
  sourceOfTruth: 'SETA',
  localCopy: 'EVIDENCE_CACHE',
  failClosed: true,
  auditRequired: true,
  transportStatus: 'DISCOVERY_REQUIRED'
});

const ENTITY_MAP = Object.freeze({
  store: 'Establishment',
  sale: 'Sale',
  purchase: 'Purchase',
  receivable: 'Receivable',
  payable: 'Payable',
  inventory_movement: 'InventoryMovement',
  goods_receipt: 'GoodsReceipt',
  fiscal_document: 'FiscalDocument',
  payment: 'Payment',
  counterparty: 'Counterparty'
});

function assertReadOnlyOperation(operation) {
  if (operation !== 'read') {
    const err = new Error('SETA_WRITE_DENIED');
    err.code = 'CAPABILITY_NOT_GRANTED';
    throw err;
  }
}

function normalizeSetaRecord(input = {}) {
  assertReadOnlyOperation(input.operation ?? 'read');
  const entityType = ENTITY_MAP[input.kind];
  if (!entityType) throw new Error(`unsupported Seta record kind: ${input.kind}`);
  if (!input.sourceUpdatedAt) throw new Error('sourceUpdatedAt is required');
  const payloadHash = stableHash(input.payload ?? {});
  return createCanonicalRecord({
    entityType,
    id: input.id,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    sourceSystem: 'seta',
    sourceReference: input.sourceId,
    occurredAt: input.occurredAt,
    competence: input.competence ?? null,
    authorityLevel: 'READ',
    evidenceIds: input.evidenceIds ?? [],
    payload: {
      ...(input.payload ?? {}),
      sourceUpdatedAt: input.sourceUpdatedAt,
      ingestedAt: input.ingestedAt ?? null,
      payloadHash
    }
  });
}

function decideSyncAction(previous, incoming) {
  if (!previous) return 'CREATE_VERSION';
  const oldHash = previous.payload?.payloadHash;
  const newHash = incoming.payload?.payloadHash;
  if (!oldHash || !newHash) throw new Error('payloadHash required for sync decision');
  if (oldHash === newHash) return 'IGNORE_IDENTICAL';
  return 'CREATE_VERSION';
}

function assertTransportConfigured(config = {}) {
  if (!config.officialEndpoint || !config.authStrategy) {
    const err = new Error('SETA_TRANSPORT_DISCOVERY_REQUIRED');
    err.code = 'DISCOVERY_REQUIRED';
    throw err;
  }
  return true;
}

module.exports = {
  SETA_ADAPTER_POLICY,
  ENTITY_MAP,
  assertReadOnlyOperation,
  normalizeSetaRecord,
  decideSyncAction,
  assertTransportConfigured
};
