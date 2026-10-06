'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SETA_ADAPTER_POLICY, normalizeSetaRecord, decideSyncAction,
  assertReadOnlyOperation, assertTransportConfigured
} = require('../src/hermes/accounting/seta-read-adapter');

const base = {
  kind:'sale', id:'sale-1', tenantId:'t1', companyId:'c1', establishmentId:'s1',
  sourceId:'seta-sale-123', occurredAt:'2026-10-02T10:00:00-03:00',
  sourceUpdatedAt:'2026-10-02T10:01:00-03:00', payload:{netAmountCents:19990}
};

test('C3 policy is strictly read only', () => {
  assert.equal(SETA_ADAPTER_POLICY.mode, 'READ_ONLY');
  assert.equal(SETA_ADAPTER_POLICY.create, false);
  assert.equal(SETA_ADAPTER_POLICY.directDbWrite, false);
  assert.throws(() => assertReadOnlyOperation('update'), e => e.code === 'CAPABILITY_NOT_GRANTED');
});

test('normalizes Seta facts without losing store or provenance', () => {
  const r = normalizeSetaRecord(base);
  assert.equal(r.entityType, 'Sale');
  assert.equal(r.establishmentId, 's1');
  assert.equal(r.sourceSystem, 'seta');
  assert.equal(r.sourceReference, 'seta-sale-123');
  assert.equal(r.authorityLevel, 'READ');
  assert.equal(r.payload.payloadHash.length, 64);
});

test('identical payload is idempotently ignored and changed payload creates a version', () => {
  const a = normalizeSetaRecord(base);
  const b = normalizeSetaRecord({...base});
  const c = normalizeSetaRecord({...base,payload:{netAmountCents:20000}});
  assert.equal(decideSyncAction(a,b), 'IGNORE_IDENTICAL');
  assert.equal(decideSyncAction(a,c), 'CREATE_VERSION');
});

test('unsupported source kinds fail closed', () => {
  assert.throws(() => normalizeSetaRecord({...base,kind:'mystery'}), /unsupported Seta record kind/);
});

test('official transport cannot be invented', () => {
  assert.throws(() => assertTransportConfigured({}), e => e.code === 'DISCOVERY_REQUIRED');
  assert.equal(assertTransportConfigured({officialEndpoint:'https://official.example',authStrategy:'documented'}), true);
});
