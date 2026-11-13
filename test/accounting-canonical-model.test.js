'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCOUNTING_ENTITY_TYPES,
  AUTHORITY_LEVELS,
  VALUE_STATES,
  createCanonicalRecord
} = require('../src/hermes/accounting/canonical-model');

const base = {
  entityType: 'Sale',
  id: 'sale-1',
  tenantId: 'tenant-1',
  companyId: 'company-1',
  establishmentId: 'store-1',
  sourceSystem: 'seta',
  sourceReference: '123',
  occurredAt: '2026-10-02T12:00:00-03:00',
  evidenceIds: ['evidence-1'],
  payload: { amountCents: 10000 }
};

test('canonical model exposes governed enums', () => {
  assert.ok(ACCOUNTING_ENTITY_TYPES.includes('FiscalDocument'));
  assert.ok(ACCOUNTING_ENTITY_TYPES.includes('PayrollEvent'));
  assert.deepEqual(AUTHORITY_LEVELS, ['READ','ANALYZE','PREPARE','WRITE','MONEY','FISCAL_SUBMIT']);
  assert.deepEqual(VALUE_STATES, ['FORECAST','EXPECTED','ASSESSED','PAID','RECONCILED']);
});

test('creates a canonical accounting record with safe defaults', () => {
  const record = createCanonicalRecord(base);
  assert.equal(record.schemaVersion, 'accounting-canonical-v1');
  assert.equal(record.authorityLevel, 'READ');
  assert.equal(record.valueState, null);
  assert.equal(record.payload.amountCents, 10000);
});

test('rejects unknown entity types', () => {
  assert.throws(() => createCanonicalRecord({...base, entityType: 'InventedThing'}), /unsupported accounting entityType/);
});

test('rejects unknown authority levels and value states', () => {
  assert.throws(() => createCanonicalRecord({...base, authorityLevel: 'AUTO_PAY'}), /unsupported authorityLevel/);
  assert.throws(() => createCanonicalRecord({...base, valueState: 'PROBABLY_PAID'}), /unsupported valueState/);
});

test('requires provenance fields', () => {
  assert.throws(() => createCanonicalRecord({...base, sourceReference: ''}), /sourceReference/);
  assert.throws(() => createCanonicalRecord({...base, occurredAt: 'not-a-date'}), /ISO timestamp/);
});

test('does not mutate caller payload or evidence arrays', () => {
  const input = {...base, evidenceIds: ['e1'], payload: { amountCents: 1 }};
  const record = createCanonicalRecord(input);
  input.evidenceIds.push('e2');
  input.payload.amountCents = 2;
  assert.deepEqual(record.evidenceIds, ['e1']);
  assert.equal(record.payload.amountCents, 1);
});
