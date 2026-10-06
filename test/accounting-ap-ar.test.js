'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createObligation,agingBucket,detectDuplicateObligation,assessPaymentReadiness,assertPaymentExecution,createCreditPolicy}=require('../src/hermes/accounting/ap-ar');

const payable={obligationId:'p1',kind:'PAYABLE',tenantId:'t',companyId:'c',counterpartyId:'sup',originalAmountCents:10000,dueDate:'2026-10-10',sourceDocumentId:'nfe1'};

test('document creates obligation but does not imply payment',()=>{
 const p=createObligation(payable);
 assert.equal(p.outstandingCents,10000);
 assert.equal(p.status,'OPEN');
});

test('partial payment remains explicit',()=>{
 const p=createObligation({...payable,paidAmountCents:2500});
 assert.equal(p.outstandingCents,7500);
 assert.equal(p.status,'PARTIALLY_PAID');
});

test('aging buckets are deterministic',()=>{
 assert.equal(agingBucket('2026-11-01','2026-10-02'),'A_VENCER');
 assert.equal(agingBucket('2026-09-20','2026-10-02'),'1_30');
 assert.equal(agingBucket('2026-05-01','2026-10-02'),'120_PLUS');
});

test('duplicate payable detection distinguishes conflict',()=>{
 const a=createObligation(payable);
 const b=createObligation({...payable,obligationId:'p2'});
 const c=createObligation({...payable,obligationId:'p3',originalAmountCents:9999});
 assert.equal(detectDuplicateObligation(a,b),'DUPLICATE');
 assert.equal(detectDuplicateObligation(a,c),'CONFLICT');
});

test('payment readiness fails closed on any missing check',()=>{
 const ready=assessPaymentReadiness({checks:{documentMatched:true,goodsReceiptMatched:true,amountMatched:true,beneficiaryVerified:true,noDuplicate:true,evidenceComplete:true}});
 assert.equal(ready.status,'READY_FOR_PAYMENT');
 assert.equal(ready.authority,'PREPARE');
 const blocked=assessPaymentReadiness({checks:{documentMatched:true}});
 assert.equal(blocked.status,'BLOCKED');
 assert.ok(blocked.blockers.includes('beneficiaryVerified'));
});

test('C8 never executes payment',()=>{
 assert.throws(()=>assertPaymentExecution(),e=>e.code==='CAPABILITY_NOT_GRANTED');
});

test('crediario policy makes sensitive effects approval-bound',()=>{
 const p=createCreditPolicy({policyId:'cp',version:'1',effectiveFrom:'2026-01-01'});
 assert.equal(p.limitChangeRequiresApproval,true);
 assert.equal(p.renegotiationRequiresApproval,true);
 assert.equal(p.negativeListingRequiresApproval,true);
});
