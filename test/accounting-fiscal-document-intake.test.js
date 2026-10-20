'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  preserveFiscalDocument, validateFiscalEnvelope, decideFiscalIngestion,
  createFiscalEvent, manifestationAuthority
} = require('../src/hermes/accounting/fiscal-document-intake');

const base = {
  documentId:'doc-1', tenantId:'t1', companyId:'c1', establishmentId:'s1',
  documentType:'NFE', accessKey:'35261000000000000000550010000000011000000010',
  originalXml:'<NFe>original</NFe>', receivedAt:'2026-10-02T20:00:00-03:00',
  schemaVersion:'4.00'
};

test('preserves original fiscal document with stable hash', () => {
  const d = preserveFiscalDocument(base);
  assert.equal(d.state, 'PRESERVED');
  assert.equal(d.originalXml, base.originalXml);
  assert.equal(d.documentHash.length, 64);
  assert.ok(Object.isFrozen(d));
});

test('signature or schema uncertainty quarantines document', () => {
  assert.equal(validateFiscalEnvelope(preserveFiscalDocument(base), {signatureValid:false,schemaValid:true}).state, 'QUARANTINED');
  assert.equal(validateFiscalEnvelope(preserveFiscalDocument(base), {signatureValid:true,schemaValid:false}).state, 'QUARANTINED');
  assert.equal(validateFiscalEnvelope(preserveFiscalDocument(base), {signatureValid:true,schemaValid:true}).state, 'BUSINESS_VALIDATION');
});

test('same access key and same hash is idempotent; changed bytes are critical conflict', () => {
  const a = preserveFiscalDocument(base);
  const b = preserveFiscalDocument({...base,documentId:'doc-2'});
  const c = preserveFiscalDocument({...base,documentId:'doc-3',originalXml:'<NFe>changed</NFe>'});
  assert.equal(decideFiscalIngestion(a,b), 'IGNORE_IDENTICAL');
  assert.equal(decideFiscalIngestion(a,c), 'CRITICAL_CONFLICT');
});

test('fiscal events are linked and do not overwrite original document', () => {
  const event = createFiscalEvent({
    eventId:'ev-1', documentId:'doc-1', eventType:'CANCELLATION',
    occurredAt:'2026-10-02T21:00:00-03:00', sourceReference:'protocol-1'
  });
  assert.equal(event.documentId, 'doc-1');
  assert.equal(event.eventType, 'CANCELLATION');
});

test('recipient manifestation is FISCAL_SUBMIT authority', () => {
  assert.equal(manifestationAuthority('SCIENCE'), 'FISCAL_SUBMIT');
  assert.equal(manifestationAuthority('CONFIRMATION'), 'FISCAL_SUBMIT');
  assert.equal(manifestationAuthority('CANCELLATION'), 'ANALYZE');
});
