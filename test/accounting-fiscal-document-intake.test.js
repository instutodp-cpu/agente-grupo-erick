'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  preserveFiscalDocument,
  validateFiscalEnvelope,
  decideFiscalIngestion,
  createFiscalEvent,
  manifestationAuthority
} = require('../src/hermes/accounting/fiscal-document-intake');

const base = {
  documentId: 'doc-1',
  tenantId: 't1',
  companyId: 'c1',
  establishmentId: 's1',
  documentType: 'NFE',
  accessKey: '35261000000000000000550010000000011000000010',
  originalXml: '<NFe>original</NFe>',
  receivedAt: '2026-10-02T20:00:00-03:00',
  schemaVersion: '4.00'
};

test('preserves original fiscal document with stable hash', () => {
  const document = preserveFiscalDocument(base);
  assert.equal(document.state, 'PRESERVED');
  assert.equal(document.originalXml, base.originalXml);
  assert.equal(document.documentHash.length, 64);
  assert.ok(Object.isFrozen(document));
});

test('preservation rejects unsupported types, malformed keys and invalid timestamps', () => {
  assert.throws(
    () => preserveFiscalDocument({ ...base, documentType: 'CTE' }),
    /unsupported fiscal document type/
  );
  assert.throws(
    () => preserveFiscalDocument({ ...base, accessKey: 'not-a-key' }),
    /accessKey must contain 44 digits/
  );
  assert.throws(
    () => preserveFiscalDocument({ ...base, receivedAt: 'not-a-date' }),
    /receivedAt must be an ISO timestamp/
  );
});

test('signature or schema uncertainty quarantines document', () => {
  const document = preserveFiscalDocument(base);
  assert.equal(
    validateFiscalEnvelope(document, { signatureValid: false, schemaValid: true }).state,
    'QUARANTINED'
  );
  assert.equal(
    validateFiscalEnvelope(document, { signatureValid: true, schemaValid: false }).state,
    'QUARANTINED'
  );
  assert.equal(
    validateFiscalEnvelope(document, { signatureValid: true, schemaValid: true }).state,
    'BUSINESS_VALIDATION'
  );
  assert.equal(validateFiscalEnvelope(document, {}).reason, 'INVALID_OR_UNVERIFIED_SIGNATURE');
});

test('same access key and same hash is idempotent; changed bytes are critical conflict', () => {
  const first = preserveFiscalDocument(base);
  const identical = preserveFiscalDocument({ ...base, documentId: 'doc-2' });
  const changed = preserveFiscalDocument({
    ...base,
    documentId: 'doc-3',
    originalXml: '<NFe>changed</NFe>'
  });
  assert.equal(decideFiscalIngestion(first, identical), 'IGNORE_IDENTICAL');
  assert.equal(decideFiscalIngestion(first, changed), 'CRITICAL_CONFLICT');
  assert.equal(decideFiscalIngestion(null, first), 'CREATE');
});

test('fiscal events are linked and do not overwrite original document', () => {
  const document = preserveFiscalDocument(base);
  const evidenceIds = ['evidence-1'];
  const event = createFiscalEvent({
    eventId: 'ev-1',
    documentId: document.documentId,
    eventType: 'CANCELLATION',
    occurredAt: '2026-10-02T21:00:00-03:00',
    sourceReference: 'protocol-1',
    evidenceIds
  });
  evidenceIds.push('evidence-2');
  assert.deepEqual(event.evidenceIds, ['evidence-1']);
  assert.equal(event.documentId, 'doc-1');
  assert.equal(event.eventType, 'CANCELLATION');
});

test('fiscal event timestamps and unknown events fail closed', () => {
  assert.throws(
    () => createFiscalEvent({
      eventId: 'ev-2',
      documentId: 'doc-1',
      eventType: 'CANCELLATION',
      occurredAt: 'invalid',
      sourceReference: 'protocol-2'
    }),
    /occurredAt must be an ISO timestamp/
  );
  assert.throws(
    () => createFiscalEvent({
      eventId: 'ev-3',
      documentId: 'doc-1',
      eventType: 'UNKNOWN',
      occurredAt: '2026-10-02T21:00:00-03:00',
      sourceReference: 'protocol-3'
    }),
    /unsupported fiscal event type/
  );
});

test('recipient manifestation is FISCAL_SUBMIT authority', () => {
  assert.equal(manifestationAuthority('SCIENCE'), 'FISCAL_SUBMIT');
  assert.equal(manifestationAuthority('CONFIRMATION'), 'FISCAL_SUBMIT');
  assert.equal(manifestationAuthority('CANCELLATION'), 'ANALYZE');
});
