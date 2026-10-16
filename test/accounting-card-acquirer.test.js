'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createCardTransaction,createCardReceivable,auditMdr,createAnticipation,createChargeback}=require('../src/hermes/accounting/card-acquirer');

test('card transaction requires strong acquirer identity',()=>{
  const base={cardTransactionId:'ct1',tenantId:'t',companyId:'c',saleId:'s',acquirer:'a',grossCents:10000,installments:1,occurredAt:'2026-10-02'};
  assert.throws(()=>createCardTransaction(base),/NSU or authorizationCode/);
  assert.equal(createCardTransaction({...base,nsu:'123'}).grossCents,10000);
});

test('receivable keeps gross fee and expected net distinct',()=>{
  const r=createCardReceivable({receivableId:'r',cardTransactionId:'ct',installmentNumber:1,grossCents:10000,expectedNetCents:9700,expectedSettlementDate:'2026-11-02'});
  assert.equal(r.mdrCents,300);
  assert.equal(r.expectedNetCents,9700);
});

test('MDR audit uses versioned contract basis points',()=>{
  const r=createCardReceivable({receivableId:'r',cardTransactionId:'ct',installmentNumber:1,grossCents:10000,expectedNetCents:9700,expectedSettlementDate:'2026-11-02'});
  assert.equal(auditMdr(r,{version:'v1',mdrBasisPoints:300}).status,'MATCHED');
  assert.equal(auditMdr(r,{version:'v2',mdrBasisPoints:250}).status,'NEEDS_REVIEW');
});

test('anticipation is a separate economic event with exact arithmetic',()=>{
  const a=createAnticipation({anticipationId:'a1',receivableIds:['r1','r2'],grossCents:10000,feeCents:500,netCents:9500,occurredAt:'2026-10-02'});
  assert.equal(a.netCents,9500);
  assert.throws(()=>createAnticipation({...a,netCents:9499}),/arithmetic mismatch/);
});

test('chargeback preserves evidence and cannot imply autonomous external defense',()=>{
  const c=createChargeback({chargebackId:'cb',cardTransactionId:'ct',amountCents:1000,occurredAt:'2026-10-02',reasonCode:'DISPUTE'});
  assert.equal(c.externalDefenseAuthority,'PREPARE');
});
