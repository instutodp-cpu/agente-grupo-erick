'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BANK_READ_POLICY,
  TRANSPORT_PRIORITY,
  assertBankReadOperation,
  createBankTransaction,
  createPixTransaction,
  sameBankTransaction,
  samePixTransaction,
  assertWebhookVerified
} = require('../src/hermes/accounting/bank-pix-intake');

const bankBase = {
  transactionId: 'b1',
  tenantId: 't1',
  companyId: 'c1',
  bankAccountId: 'a1',
  postedAt: '2026-10-02T10:00:00-03:00',
  direction: 'CREDIT',
  amountCents: 10000,
  sourceReference: 'ref1'
};

const pixBase = {
  pixId: 'p1',
  tenantId: 't1',
  companyId: 'c1',
  bankAccountId: 'a1',
  occurredAt: '2026-10-02T10:00:00-03:00',
  amountCents: 5000,
  direction: 'CREDIT',
  status: 'SETTLED',
  endToEndId: 'E123'
};

test('bank gateway grants reads but no money movement', () => {
  assert.equal(BANK_READ_POLICY.mode, 'READ_ONLY');
  assert.equal(BANK_READ_POLICY.paymentPrepare, false);
  assert.equal(BANK_READ_POLICY.paymentExecute, false);
  assert.equal(BANK_READ_POLICY.pixSend, false);
  assert.equal(BANK_READ_POLICY.refund, false);
  assert.equal(BANK_READ_POLICY.credentialsToLlm, false);
  assert.doesNotThrow(() => assertBankReadOperation('transactions.read'));
  assert.doesNotThrow(() => assertBankReadOperation('pix.read'));
  assert.throws(
    () => assertBankReadOperation('payment.execute'),
    error => error.code === 'CAPABILITY_NOT_GRANTED'
  );
});

test('bank transaction identity is deterministic and detached from record id', () => {
  const first = createBankTransaction(bankBase);
  const identical = createBankTransaction({ ...bankBase, transactionId: 'b2' });
  assert.ok(sameBankTransaction(first, identical));
});

test('bank transaction preserves scope and detaches evidence array', () => {
  const evidenceIds = ['evidence-1'];
  const transaction = createBankTransaction({ ...bankBase, evidenceIds });
  evidenceIds.push('evidence-2');
  assert.deepEqual(transaction.evidenceIds, ['evidence-1']);
  assert.ok(Object.isFrozen(transaction));
  assert.ok(Object.isFrozen(transaction.evidenceIds));
});

test('bank transaction rejects invalid money and dates', () => {
  assert.throws(
    () => createBankTransaction({ ...bankBase, amountCents: 10.5 }),
    /safe integer/
  );
  assert.throws(
    () => createBankTransaction({ ...bankBase, amountCents: -1 }),
    /safe integer/
  );
  assert.throws(
    () => createBankTransaction({ ...bankBase, postedAt: 'not-a-date' }),
    /postedAt must be an ISO timestamp/
  );
});

test('Pix requires a strong identifier and deduplicates by endToEndId', () => {
  const first = createPixTransaction(pixBase);
  const identical = createPixTransaction({ ...pixBase, pixId: 'p2' });
  assert.ok(samePixTransaction(first, identical));
  assert.throws(
    () => createPixTransaction({ ...pixBase, endToEndId: null, txid: null }),
    /endToEndId or txid/
  );
});

test('Pix txid identity is scoped to the bank account', () => {
  const first = createPixTransaction({ ...pixBase, endToEndId: null, txid: 'T123' });
  const same = createPixTransaction({ ...pixBase, pixId: 'p2', endToEndId: null, txid: 'T123' });
  const otherAccount = createPixTransaction({
    ...pixBase,
    pixId: 'p3',
    bankAccountId: 'a2',
    endToEndId: null,
    txid: 'T123'
  });
  assert.ok(samePixTransaction(first, same));
  assert.equal(samePixTransaction(first, otherAccount), false);
});

test('Pix rejects unsupported status, direction and invalid timestamp', () => {
  assert.throws(
    () => createPixTransaction({ ...pixBase, status: 'UNKNOWN' }),
    /unsupported Pix status/
  );
  assert.throws(
    () => createPixTransaction({ ...pixBase, direction: 'OTHER' }),
    /unsupported direction/
  );
  assert.throws(
    () => createPixTransaction({ ...pixBase, occurredAt: 'invalid' }),
    /occurredAt must be an ISO timestamp/
  );
});

test('unverified webhook fails closed', () => {
  assert.throws(
    () => assertWebhookVerified({ signatureVerified: false }),
    error => error.code === 'UNVERIFIED_SOURCE'
  );
  assert.equal(assertWebhookVerified({ signatureVerified: true }), true);
});

test('transport fallback never starts with browser scraping', () => {
  assert.deepEqual(
    TRANSPORT_PRIORITY,
    [
      'OFFICIAL_API',
      'AUTHORIZED_OPEN_FINANCE_API',
      'OFX',
      'CNAB_OR_STRUCTURED_FILE',
      'CONTROLLED_MANUAL'
    ]
  );
});
