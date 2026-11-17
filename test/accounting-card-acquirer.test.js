'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCardTransaction,
  createCardReceivable,
  auditMdr,
  createAnticipation,
  createChargeback
} = require('../src/hermes/accounting/card-acquirer');

const cardBase = {
  cardTransactionId: 'ct1',
  tenantId: 't',
  companyId: 'c',
  saleId: 's',
  acquirer: 'a',
  grossCents: 10000,
  installments: 1,
  occurredAt: '2026-10-02T10:00:00-03:00'
};

const receivableBase = {
  receivableId: 'r',
  cardTransactionId: 'ct',
  installmentNumber: 1,
  grossCents: 10000,
  expectedNetCents: 9700,
  expectedSettlementDate: '2026-11-02T10:00:00-03:00'
};

test('card transaction requires strong acquirer identity', () => {
  assert.throws(
    () => createCardTransaction(cardBase),
    /NSU or authorizationCode/
  );
  const transaction = createCardTransaction({ ...cardBase, nsu: '123' });
  assert.equal(transaction.grossCents, 10000);
  assert.ok(Object.isFrozen(transaction));
});

test('card transaction rejects invalid cents and timestamp', () => {
  assert.throws(
    () => createCardTransaction({ ...cardBase, nsu: '123', grossCents: 10.5 }),
    /non-negative safe integer/
  );
  assert.throws(
    () => createCardTransaction({ ...cardBase, nsu: '123', occurredAt: 'invalid' }),
    /occurredAt must be an ISO timestamp/
  );
});

test('receivable keeps gross fee and expected net distinct', () => {
  const receivable = createCardReceivable(receivableBase);
  assert.equal(receivable.mdrCents, 300);
  assert.equal(receivable.otherFeeCents, 0);
  assert.equal(receivable.expectedNetCents, 9700);
});

test('receivable requires exact fee arithmetic and valid status', () => {
  assert.throws(
    () => createCardReceivable({ ...receivableBase, otherFeeCents: 100 }),
    /arithmetic mismatch/
  );
  assert.throws(
    () => createCardReceivable({ ...receivableBase, status: 'UNKNOWN' }),
    /unsupported receivable status/
  );
});

test('MDR audit uses versioned contract basis points', () => {
  const receivable = createCardReceivable(receivableBase);
  assert.equal(
    auditMdr(receivable, { version: 'v1', mdrBasisPoints: 300 }).status,
    'MATCHED'
  );
  assert.equal(
    auditMdr(receivable, { version: 'v2', mdrBasisPoints: 250 }).status,
    'NEEDS_REVIEW'
  );
  assert.throws(
    () => auditMdr(receivable, { version: 'v3', mdrBasisPoints: 10001 }),
    /between 0 and 10000/
  );
});

test('anticipation is a separate event with exact arithmetic and detached IDs', () => {
  const receivableIds = ['r1', 'r2'];
  const anticipation = createAnticipation({
    anticipationId: 'a1',
    receivableIds,
    grossCents: 10000,
    feeCents: 500,
    netCents: 9500,
    occurredAt: '2026-10-02T10:00:00-03:00'
  });
  receivableIds.push('r3');
  assert.equal(anticipation.netCents, 9500);
  assert.deepEqual(anticipation.receivableIds, ['r1', 'r2']);
  assert.ok(Object.isFrozen(anticipation.receivableIds));
  assert.throws(
    () => createAnticipation({ ...anticipation, netCents: 9499 }),
    /arithmetic mismatch/
  );
});

test('chargeback preserves evidence and cannot imply autonomous external defense', () => {
  const evidenceIds = ['e1'];
  const chargeback = createChargeback({
    chargebackId: 'cb',
    cardTransactionId: 'ct',
    amountCents: 1000,
    occurredAt: '2026-10-02T10:00:00-03:00',
    reasonCode: 'DISPUTE',
    evidenceIds
  });
  evidenceIds.push('e2');
  assert.equal(chargeback.externalDefenseAuthority, 'PREPARE');
  assert.equal(chargeback.requiresHumanApproval, true);
  assert.deepEqual(chargeback.evidenceIds, ['e1']);
});

test('MDR audit keeps integer precision at the safe-cent boundary', () => {
  const grossCents = Number.MAX_SAFE_INTEGER;
  const expectedMdrCents = 900719925474;
  const receivable = createCardReceivable({
    receivableId: 'large-r',
    cardTransactionId: 'large-ct',
    installmentNumber: 1,
    grossCents,
    mdrCents: expectedMdrCents,
    expectedNetCents: grossCents - expectedMdrCents,
    expectedSettlementDate: '2026-11-02T10:00:00-03:00'
  });
  const audit = auditMdr(receivable, { version: 'boundary-v1', mdrBasisPoints: 1 });
  assert.equal(audit.expectedMdrCents, expectedMdrCents);
  assert.equal(audit.status, 'MATCHED');
});
