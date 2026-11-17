'use strict';

const { stableHash } = require('./evidence-ledger');
const { cloneAndFreeze } = require('./immutability');

const FISCAL_PIPELINE_STATES = Object.freeze([
  'RECEIVED',
  'PRESERVED',
  'SIGNATURE_CHECK',
  'SCHEMA_CHECK',
  'BUSINESS_VALIDATION',
  'NORMALIZED',
  'ENTITY_RESOLUTION',
  'RECONCILIATION',
  'READY_FOR_ACCOUNTING',
  'QUARANTINED'
]);

const FISCAL_EVENT_TYPES = Object.freeze([
  'CANCELLATION',
  'CORRECTION_LETTER',
  'SCIENCE',
  'CONFIRMATION',
  'UNKNOWN_OPERATION',
  'OPERATION_NOT_PERFORMED'
]);

const RECIPIENT_MANIFESTATIONS = Object.freeze([
  'SCIENCE',
  'CONFIRMATION',
  'UNKNOWN_OPERATION',
  'OPERATION_NOT_PERFORMED'
]);

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
}

function requireIsoTimestamp(value, field) {
  required(value, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO timestamp`);
  }
}

function assertPreservedDocument(document, field = 'document') {
  if (!document || typeof document !== 'object') {
    throw new Error(`${field} is required`);
  }
  required(document.accessKey, `${field}.accessKey`);
  required(document.documentHash, `${field}.documentHash`);
}

function preserveFiscalDocument(input = {}) {
  for (const field of [
    'documentId',
    'tenantId',
    'companyId',
    'documentType',
    'accessKey',
    'originalXml',
    'receivedAt'
  ]) {
    required(input[field], field);
  }
  if (!['NFE', 'NFCE'].includes(input.documentType)) {
    throw new Error('unsupported fiscal document type');
  }
  if (!/^\d{44}$/.test(input.accessKey)) {
    throw new Error('accessKey must contain 44 digits');
  }
  requireIsoTimestamp(input.receivedAt, 'receivedAt');

  return cloneAndFreeze({
    documentId: input.documentId,
    tenantId: input.tenantId,
    companyId: input.companyId,
    establishmentId: input.establishmentId ?? null,
    documentType: input.documentType,
    accessKey: input.accessKey,
    documentHash: stableHash(input.originalXml),
    originalXml: input.originalXml,
    receivedAt: input.receivedAt,
    schemaVersion: input.schemaVersion ?? null,
    protocol: cloneAndFreeze(input.protocol ?? null),
    state: 'PRESERVED'
  });
}

function validateFiscalEnvelope(document, checks = {}) {
  assertPreservedDocument(document);
  if (checks.signatureValid !== true) {
    return Object.freeze({
      state: 'QUARANTINED',
      reason: 'INVALID_OR_UNVERIFIED_SIGNATURE'
    });
  }
  if (checks.schemaValid !== true) {
    return Object.freeze({
      state: 'QUARANTINED',
      reason: 'INVALID_OR_UNVERIFIED_SCHEMA'
    });
  }
  return Object.freeze({ state: 'BUSINESS_VALIDATION', reason: null });
}

function decideFiscalIngestion(previous, incoming) {
  assertPreservedDocument(incoming, 'incoming');
  if (previous == null) return 'CREATE';
  assertPreservedDocument(previous, 'previous');
  if (previous.accessKey !== incoming.accessKey) return 'CREATE';
  if (previous.documentHash === incoming.documentHash) return 'IGNORE_IDENTICAL';
  return 'CRITICAL_CONFLICT';
}

function createFiscalEvent(input = {}) {
  for (const field of [
    'eventId',
    'documentId',
    'eventType',
    'occurredAt',
    'sourceReference'
  ]) {
    required(input[field], field);
  }
  if (!FISCAL_EVENT_TYPES.includes(input.eventType)) {
    throw new Error('unsupported fiscal event type');
  }
  requireIsoTimestamp(input.occurredAt, 'occurredAt');
  if (input.evidenceIds !== undefined && !Array.isArray(input.evidenceIds)) {
    throw new Error('evidenceIds must be an array');
  }
  const evidenceIds = input.evidenceIds ?? [];
  for (const evidenceId of evidenceIds) required(evidenceId, 'evidenceId');

  return cloneAndFreeze({
    eventId: input.eventId,
    documentId: input.documentId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    sourceReference: input.sourceReference,
    evidenceIds
  });
}

function manifestationAuthority(eventType) {
  if (!FISCAL_EVENT_TYPES.includes(eventType)) {
    throw new Error('unsupported fiscal event type');
  }
  return RECIPIENT_MANIFESTATIONS.includes(eventType)
    ? 'FISCAL_SUBMIT'
    : 'ANALYZE';
}

module.exports = {
  FISCAL_PIPELINE_STATES,
  FISCAL_EVENT_TYPES,
  preserveFiscalDocument,
  validateFiscalEnvelope,
  decideFiscalIngestion,
  createFiscalEvent,
  manifestationAuthority
};
