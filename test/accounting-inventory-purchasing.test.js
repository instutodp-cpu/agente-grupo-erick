'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {createInventoryMovement,rollForward,assessGoodsReceipt,reconcilePurchaseFiveWay,reconcileInventory,createTransfer,lossSignal}=require('../src/hermes/accounting/inventory-purchasing');

test('inventory roll-forward is deterministic',()=>{
 const base={tenantId:'t',companyId:'c',establishmentId:'s',sku:'sku',occurredAt:'2026-10-02'};
 const ms=[
  createInventoryMovement({...base,movementId:'1',movementType:'PURCHASE',quantityMilliUnits:10000}),
  createInventoryMovement({...base,movementId:'2',movementType:'SALE',quantityMilliUnits:3000}),
  createInventoryMovement({...base,movementId:'3',movementType:'LOSS_DAMAGE',quantityMilliUnits:1000})
 ];
 assert.equal(rollForward(5000,ms),11000);
});
test('goods receipt distinguishes partial and over-received',()=>{
 assert.equal(assessGoodsReceipt({orderedMilliUnits:10000,receivedMilliUnits:8000}),'PARTIAL');
 assert.equal(assessGoodsReceipt({orderedMilliUnits:10000,receivedMilliUnits:11000}),'OVER_RECEIVED');
});
test('five-way purchase reconciliation fails visibly',()=>{
 assert.equal(reconcilePurchaseFiveWay({purchaseOrderMatched:true,fiscalDocumentMatched:true,goodsReceiptMatched:true,payableMatched:true,inventoryMatched:true}).status,'MATCHED');
 const r=reconcilePurchaseFiveWay({purchaseOrderMatched:true});
 assert.equal(r.status,'NEEDS_REVIEW'); assert.ok(r.failedChecks.includes('inventoryMatched'));
});
test('physical ERP and theoretical stock remain separate',()=>{
 const r=reconcileInventory({theoreticalMilliUnits:10000,physicalMilliUnits:9900,erpMilliUnits:10000});
 assert.equal(r.status,'NEEDS_REVIEW'); assert.equal(r.physicalVarianceMilliUnits,-100);
});
test('store transfer requires bilateral coherence',()=>{
 assert.equal(createTransfer({transferId:'tr',sku:'x',fromEstablishmentId:'a',toEstablishmentId:'b',dispatchedMilliUnits:10000,receivedMilliUnits:8000}).status,'PARTIALLY_RECEIVED');
 assert.equal(createTransfer({transferId:'tr2',sku:'x',fromEstablishmentId:'a',toEstablishmentId:'b',dispatchedMilliUnits:10000,receivedMilliUnits:12000}).status,'CONFLICT');
});
test('loss signal never declares fraud',()=>{
 const s=lossSignal({severity:'HIGH'});
 assert.equal(s.fraudConclusion,false); assert.equal(s.requiresHumanReview,true);
});
