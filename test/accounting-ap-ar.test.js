'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createObligation,
  createCrediarioInstallment,
  agingBucket,
  detectDuplicateObligation,
  decideObligationSyncAction,
  assessPaymentReadiness,
  recordReceipt,
  prepareCollectionCase,
  createCreditPolicy,
  forecastCash,
  assertPaymentExecution,
  assertCollectionExecution,
  assertCreditPolicyMutation
} = require('../src/hermes/accounting/ap-ar');

const payableBase = {
  obligationId: 'p1',
  kind: 'PAYABLE',
  tenantId: 'tenant-a',
  companyId: 'company-a',
  counterpartyId: 'supplier-a',
  originalAmountCents: 10000,
  dueDate: '2026-10-10',
  sourceDocumentId: 'nfe-1',
  evidenceIds: ['e1']
};

const receivableBase = {
  obligationId: 'r1',
  kind: 'RECEIVABLE',
  tenantId: 'tenant-a',
  companyId: 'company-a',
  counterpartyId: 'customer-a',
  originalAmountCents: 25000,
  dueDate: '2026-10-10',
  sourceDocumentId: 'invoice-1',
  evidenceIds: ['e2']
};

test('document creates an obligation but never implies payment', () => {
  const payable = createObligation(payableBase);
  assert.equal(payable.outstandingCents, 10000);
  assert.equal(payable.status, 'OPEN');
  assert.equal(payable.paidAmountCents, 0);
  assert.equal(payable.paymentChannel, null);
});

test('obligation accepts numeric amount in cents contract', () => {
  const payable = createObligation({ ...payableBase, originalAmountCents: 12345 });
  assert.equal(payable.originalAmountCents, 12345);
  assert.equal(payable.outstandingCents, 12345);
});

test('obligation is deeply immutable and rejects invalid dates and money', () => {
  const evidenceIds = ['e1'];
  const payable = createObligation({ ...payableBase, evidenceIds });
  evidenceIds.push('e2');
  assert.deepEqual(payable.evidenceIds, ['e1']);
  assert.ok(Object.isFrozen(payable));
  assert.ok(Object.isFrozen(payable.evidenceIds));
  assert.throws(
    () => createObligation({ ...payableBase, dueDate: '2026-02-30' }),
    /ISO date/
  );
  assert.throws(
    () => createObligation({ ...payableBase, originalAmountCents: 0.5 }),
    /safe integer/
  );
});

test('paid and outstanding amounts remain exact and overpayment is blocked', () => {
  const partial = createObligation({ ...payableBase, paidAmountCents: 2500 });
  assert.equal(partial.outstandingCents, 7500);
  assert.equal(partial.status, 'PARTIALLY_PAID');
  assert.throws(
    () => createObligation({ ...payableBase, paidAmountCents: 10001 }),
    /exceeds/
  );
});

test('aging buckets are deterministic and validate dates', () => {
  assert.equal(agingBucket('2026-11-01', '2026-10-02'), 'A_VENCER');
  assert.equal(agingBucket('2026-09-20', '2026-10-02'), '1_30');
  assert.equal(agingBucket('2026-05-01', '2026-10-02'), '120_PLUS');
  assert.throws(
    () => agingBucket('2026-02-30', '2026-10-02'),
    /ISO date/
  );
});

test('duplicate identity is tenant-safe and distinguishes conflict', () => {
  const first = createObligation(payableBase);
  const duplicate = createObligation({ ...payableBase, obligationId: 'p2' });
  const otherTenant = createObligation({
    ...payableBase,
    obligationId: 'p3',
    tenantId: 'tenant-b'
  });
  const conflict = createObligation({
    ...payableBase,
    obligationId: 'p4',
    originalAmountCents: 9999
  });
  assert.equal(detectDuplicateObligation(first, duplicate), 'DUPLICATE');
  assert.equal(detectDuplicateObligation(first, otherTenant), 'DISTINCT');
  assert.equal(detectDuplicateObligation(first, conflict), 'CONFLICT');
});

test('sync action is idempotent and versions state changes', () => {
  const first = createObligation(payableBase);
  const identical = createObligation({ ...payableBase, obligationId: 'p2' });
  const changedState = createObligation({
    ...payableBase,
    obligationId: 'p3',
    paidAmountCents: 2000
  });
  assert.equal(decideObligationSyncAction(first, identical), 'IGNORE_IDENTICAL');
  assert.equal(decideObligationSyncAction(first, changedState), 'CREATE_VERSION');
});

test('payment preparation fails closed and never executes', () => {
  const ready = assessPaymentReadiness({
    kind: 'PAYABLE',
    checks: {
      documentMatched: true,
      goodsReceiptMatched: true,
      amountMatched: true,
      beneficiaryVerified: true,
      noDuplicate: true,
      evidenceComplete: true
    }
  });
  assert.equal(ready.status, 'READY_FOR_PAYMENT');
  assert.equal(ready.authority, 'PREPARE');
  const blocked = assessPaymentReadiness({
    kind: 'PAYABLE',
    checks: {
      documentMatched: true,
      goodsReceiptMatched: true
    }
  });
  assert.equal(blocked.status, 'BLOCKED');
  assert.ok(blocked.blockers.includes('amountMatched'));
  assert.throws(
    () => assertPaymentExecution(),
    (error) => error.code === 'CAPABILITY_NOT_GRANTED'
  );
});

test('crediario installment and receipt keep bank effects separate', () => {
  const installment = createCrediarioInstallment({
    ...receivableBase,
    obligationId: 'cred-1',
    crediarioId: 'cred-1',
    customerId: 'customer-a'
  });
  assert.equal(installment.paymentChannel, 'CREDIARIO');
  assert.equal(installment.kind, 'RECEIVABLE');
  const firstReceipt = recordReceipt(installment, {
    receiptId: 'receipt-1',
    amountCents: 5000,
    receivedAt: '2026-10-01',
    evidenceIds: ['receipt-e1']
  });
  assert.equal(firstReceipt.action, 'CREATE_VERSION');
  assert.equal(firstReceipt.obligation.paidAmountCents, 5000);
  assert.equal(firstReceipt.obligation.outstandingCents, 20000);
  assert.deepEqual(firstReceipt.obligation.evidenceIds, ['e2', 'receipt-e1']);
  const secondReceipt = recordReceipt(firstReceipt.obligation, {
    receiptId: 'receipt-2',
    amountCents: 3000,
    receivedAt: '2026-10-02'
  });
  assert.equal(secondReceipt.obligation.paidAmountCents, 8000);
  assert.equal(recordReceipt(secondReceipt.obligation, {
    receiptId: 'receipt-1',
    amountCents: 5000,
    receivedAt: '2026-10-01'
  }).action, 'IGNORE_IDENTICAL');
  assert.throws(
    () => recordReceipt(firstReceipt.obligation, {
      receiptId: 'receipt-1',
      amountCents: 5001,
      receivedAt: '2026-10-01'
    }),
    /RECEIPT_CONFLICT/
  );
});

test('collection preparation is overdue-only and human-bound', () => {
  const receivable = createObligation(receivableBase);
  const prepared = prepareCollectionCase({
    collectionCaseId: 'case-1',
    obligation: receivable,
    asOf: '2026-11-20'
  });
  assert.equal(prepared.agingBucket, '1_30');
  assert.equal(prepared.authority, 'PREPARE');
  assert.equal(prepared.requiresHumanApproval, true);
  assert.equal(prepared.externalDispatch, false);
  assert.throws(
    () => prepareCollectionCase({
      collectionCaseId: 'case-2',
      obligation: receivable,
      asOf: '2026-10-01'
    }),
    /not overdue/
  );
  assert.throws(
    () => assertCollectionExecution(),
    (error) => error.code === 'CAPABILITY_NOT_GRANTED'
  );
});

test('credit policy is versioned and sensitive mutation is blocked', () => {
  const policy = createCreditPolicy({
    policyId: 'cp-1',
    version: 'v1',
    effectiveFrom: '2026-01-01'
  });
  assert.equal(policy.limitChangeRequiresApproval, true);
  assert.equal(policy.renegotiationRequiresApproval, true);
  assert.equal(policy.discountRequiresApproval, true);
  assert.equal(policy.negativeListingRequiresApproval, true);
  assert.throws(
    () => createCreditPolicy({
      policyId: 'cp-2',
      version: 'v2',
      effectiveFrom: '2026-06-01',
      effectiveUntil: '2026-05-31'
    }),
    /cannot precede/
  );
  assert.throws(
    () => assertCreditPolicyMutation(),
    (error) => error.code === 'CAPABILITY_NOT_GRANTED'
  );
});

test('cash forecast is cumulative, exact and non-mutating', () => {
  const payable = createObligation({
    ...payableBase,
    dueDate: '2026-10-07'
  });
  const receivable = createObligation({
    ...receivableBase,
    dueDate: '2026-10-05'
  });
  const forecast = forecastCash([payable, receivable], { asOf: '2026-10-02' });
  assert.deepEqual(forecast.windows[7], {
    inflowCents: 25000,
    outflowCents: 10000,
    netCents: 15000
  });
  assert.deepEqual(forecast.windows[14], forecast.windows[7]);
  assert.equal(forecast.authority, 'ANALYZE');
  assert.equal(forecast.mutatesObligations, false);
  assert.equal(payable.status, 'OPEN');
});
