'use strict';

const { stableHash } = require('./evidence-ledger');

const FISCAL_PIPELINE_STATES = Object.freeze([
  'RECEIVED','PRESERVED','SIGNATURE_CHECK','SCHEMA_CHECK','BUSINESS_VALIDATION',
  'NORMALIZED','ENTITY_RESOLUTION','RECONCILIATION','READY_FOR_ACCOUNTING','QUARANTINED'
]);

const FISCAL_EVENT_TYPES = Object.freeze([
  'CANCELLATION','CORRECTION_LETTER','SCIENCE','CONFIRMATION',
  'UNKNOWN_OPERATION','OPERATION_NOT_PERFORMED'
]);

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
}

function preserveFiscalDocument(input = {}) {
  for (const field of ['documentId','tenantId','companyId','documentType','accessKey','originalXml','receivedAt']) {
    required(input[field], field);
  }
  if (!['NFE','NFCE'].includes(input.documentType)) throw new Error('unsupported fiscal document type');

  return Object.freeze({
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
    protocol: input.protocol ?? null,
    state: 'PRESERVED'
  });
}

function validateFiscalEnvelope(document, checks = {}) {
  if (checks.signatureValid !== true) {
    return Object.freeze({state:'QUARANTINED', reason:'INVALID_OR_UNVERIFIED_SIGNATURE'});
  }
  if (checks.schemaValid !== true) {
    return Object.freeze({state:'QUARANTINED', reason:'INVALID_OR_UNVERIFIED_SCHEMA'});
  }
  return Object.freeze({state:'BUSINESS_VALIDATION', reason:null});
}

function decideFiscalIngestion(previous, incoming) {
  if (!previous) return 'CREATE';
  if (previous.accessKey !== incoming.accessKey) return 'CREATE';
  if (previous.documentHash === incoming.documentHash) return 'IGNORE_IDENTICAL';
  return 'CRITICAL_CONFLICT';
}

function createFiscalEvent(input = {}) {
  for (const field of ['eventId','documentId','eventType','occurredAt','sourceReference']) required(input[field], field);
  if (!FISCAL_EVENT_TYPES.includes(input.eventType)) throw new Error('unsupported fiscal event type');
  return Object.freeze({
    eventId: input.eventId,
    documentId: input.documentId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    sourceReference: input.sourceReference,
    evidenceIds: Object.freeze([...(input.evidenceIds ?? [])])
  });
}

function manifestationAuthority(eventType) {
  if (['SCIENCE','CONFIRMATION','UNKNOWN_OPERATION','OPERATION_NOT_PERFORMED'].includes(eventType)) {
    return 'FISCAL_SUBMIT';
  }
  return 'ANALYZE';
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
