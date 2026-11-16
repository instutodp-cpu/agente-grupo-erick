'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createInventoryMovement,
  rollForward,
  assessGoodsReceipt,
  reconcilePurchaseFiveWay,
  reconcileInventory,
  createTransfer,
  lossSignal,
  assertInventoryWrite
} = require('../src/hermes/accounting/inventory-purchasing');

const movementBase = {
  tenantId: 'tenant-a',
  companyId: 'company-a',
  establishmentId: 'store-a',
  sku: 'sku-1',
  occurredAt: '2026-10-02'
};

test('inventory roll-forward is deterministic and preserves scope', () => {
  const base = createInventoryMovement({
    ...movementBase,
    movementId: 'm1',
    movementType: 'PURCHASE',
    quantityMilliUnits: 10000,
    unitCostCents: 1250,
    evidenceIds: ['e1']
  });
  const sale = createInventoryMovement({
    ...movementBase,
    movementId: 'm2',
    movementType: 'SALE',
    quantityMilliUnits: 3000
  });
  const loss = createInventoryMovement({
    ...movementBase,
    movementId: 'm3',
    movementType: 'LOSS_DAMAGE',
    quantityMilliUnits: 1000
  });
  assert.equal(rollForward(5000, [base, sale, loss]), 11000);
  assert.equal(base.companyId, 'company-a');
  assert.ok(Object.isFrozen(base));
  assert.ok(Object.isFrozen(base.evidenceIds));
});

test('inventory rejects invalid quantities, dates, and movement types', () => {
  assert.throws(
    () => createInventoryMovement({
      ...movementBase,
      movementId: 'bad',
      movementType: 'PURCHASE',
      quantityMilliUnits: 1.5
    }),
    /safe integer/
  );
  assert.throws(
    () => createInventoryMovement({
      ...movementBase,
      movementId: 'bad-date',
      movementType: 'PURCHASE',
      quantityMilliUnits: 1,
      occurredAt: '2026-02-30'
    }),
    /ISO date/
  );
  assert.throws(
    () => createInventoryMovement({
      ...movementBase,
      movementId: 'bad-type',
      movementType: 'UNKNOWN',
      quantityMilliUnits: 1
    }),
    /unsupported/
  );
});

test('inventory roll-forward fails closed on unsafe overflow', () => {
  assert.throws(
    () => rollForward(Number.MAX_SAFE_INTEGER, [{
      movementType: 'PURCHASE',
      quantityMilliUnits: 1
    }]),
    /exceeds safe integer/
  );
});

test('goods receipt distinguishes all states', () => {
  assert.equal(
    assessGoodsReceipt({
      orderedMilliUnits: 10000,
      receivedMilliUnits: 10000
    }),
    'COMPLETE'
  );
  assert.equal(
    assessGoodsReceipt({
      orderedMilliUnits: 10000,
      receivedMilliUnits: 8000
    }),
    'PARTIAL'
  );
  assert.equal(
    assessGoodsReceipt({
      orderedMilliUnits: 10000,
      receivedMilliUnits: 11000
    }),
    'OVER_RECEIVED'
  );
  assert.equal(
    assessGoodsReceipt({
      orderedMilliUnits: 10000,
      receivedMilliUnits: 0,
      rejected: true
    }),
    'REJECTED'
  );
});

test('five-way purchase reconciliation requires every leg', () => {
  const matched = reconcilePurchaseFiveWay({
    purchaseOrderMatched: true,
    fiscalDocumentMatched: true,
    goodsReceiptMatched: true,
    payableMatched: true,
    inventoryMatched: true
  });
  assert.equal(matched.status, 'MATCHED');
  assert.equal(matched.authority, 'ANALYZE');

  const review = reconcilePurchaseFiveWay({
    purchaseOrderMatched: true,
    fiscalDocumentMatched: true
  });
  assert.equal(review.status, 'NEEDS_REVIEW');
  assert.deepEqual(review.failedChecks, [
    'goodsReceiptMatched',
    'payableMatched',
    'inventoryMatched'
  ]);
});

test('theoretical, physical, and ERP stock remain separate', () => {
  const match = reconcileInventory({
    theoreticalMilliUnits: 10000,
    physicalMilliUnits: 10000,
    erpMilliUnits: 10000
  });
  assert.equal(match.status, 'MATCHED');

  const review = reconcileInventory({
    theoreticalMilliUnits: 10000,
    physicalMilliUnits: 9900,
    erpMilliUnits: 10000
  });
  assert.equal(review.status, 'NEEDS_REVIEW');
  assert.equal(review.physicalVarianceMilliUnits, -100);
});

test('transfer requires tenant scope, distinct endpoints, and explicit conflict', () => {
  const partial = createTransfer({
    transferId: 'tr-1',
    tenantId: 'tenant-a',
    companyId: 'company-a',
    sku: 'sku-1',
    fromEstablishmentId: 'store-a',
    toEstablishmentId: 'store-b',
    dispatchedMilliUnits: 10000,
    receivedMilliUnits: 8000,
    evidenceIds: ['transfer-e1']
  });
  assert.equal(partial.status, 'PARTIALLY_RECEIVED');
  assert.ok(Object.isFrozen(partial.evidenceIds));

  const conflict = createTransfer({
    transferId: 'tr-2',
    tenantId: 'tenant-a',
    companyId: 'company-a',
    sku: 'sku-1',
    fromEstablishmentId: 'store-a',
    toEstablishmentId: 'store-b',
    dispatchedMilliUnits: 10000,
    receivedMilliUnits: 12000
  });
  assert.equal(conflict.status, 'CONFLICT');
  assert.throws(
    () => createTransfer({
      transferId: 'tr-3',
      tenantId: 'tenant-a',
      companyId: 'company-a',
      sku: 'sku-1',
      fromEstablishmentId: 'store-a',
      toEstablishmentId: 'store-a',
      dispatchedMilliUnits: 100
    }),
    /must differ/
  );
});

test('loss signal is evidence-bound and never declares fraud', () => {
  const signal = lossSignal({
    signalId: 'loss-1',
    tenantId: 'tenant-a',
    companyId: 'company-a',
    establishmentId: 'store-a',
    sku: 'sku-1',
    severity: 'HIGH',
    evidenceIds: ['e-loss']
  });
  assert.equal(signal.fraudConclusion, false);
  assert.equal(signal.requiresHumanReview, true);
  assert.ok(Object.isFrozen(signal.evidenceIds));
});

test('inventory write-back is fail-closed', () => {
  assert.throws(
    () => assertInventoryWrite(),
    (error) => error.code === 'CAPABILITY_NOT_GRANTED'
  );
});
