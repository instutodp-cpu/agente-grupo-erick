'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createTaxObligation,transitionTaxState,createSimpleTaxForecast,reconcileAssessment,cashForecast,assertGuideOrPaymentEffect,assertDaeSemantics}=require('../src/hermes/accounting/tax-forecasting');

test('forecast is explicitly not official assessment',()=>{
 const f=createSimpleTaxForecast({forecastId:'f',companyId:'c',competence:'2026-10',currentRevenueCents:1000000,rbt12Cents:12000000,ruleVersion:'r1',scenario:'CURRENT',estimatedDasCents:60000});
 assert.equal(f.valueState,'FORECAST');assert.equal(f.officialAssessment,false);
});
test('tax lifecycle cannot skip assessed or guide stages',()=>{
 assert.equal(transitionTaxState('FORECAST','EXPECTED'),'EXPECTED');
 assert.throws(()=>transitionTaxState('FORECAST','PAID'),/NOT_ALLOWED/);
 assert.equal(transitionTaxState('GUIDE_ISSUED','PAID'),'PAID');
});
test('official assessment is reconciled against forecast',()=>{
 const r=reconcileAssessment({forecastCents:60000,assessedCents:60001});
 assert.equal(r.status,'TAX_EXCEPTION');assert.equal(r.varianceCents,1);
});
test('tax cash forecast exposes 7 14 30 60 90 day horizons',()=>{
 const a=createTaxObligation({taxObligationId:'a',tenantId:'t',companyId:'c',taxType:'DAS',competence:'2026-10',source:'PGDAS_D',ruleVersion:'r',state:'EXPECTED',amountCents:10000,dueDate:'2026-10-09'});
 const b=createTaxObligation({taxObligationId:'b',tenantId:'t',companyId:'c',taxType:'FGTS',competence:'2026-10',source:'ESOCIAL',ruleVersion:'r',state:'EXPECTED',amountCents:5000,dueDate:'2026-11-01'});
 const f=cashForecast([a,b],'2026-10-02');assert.equal(f[7],10000);assert.equal(f[30],15000);assert.equal(f[90],15000);
});
test('guide issue and payment execution require human approval',()=>{
 assert.throws(()=>assertGuideOrPaymentEffect({action:'GUIDE_ISSUE'}),e=>e.code==='APPROVAL_REQUIRED');
 assert.throws(()=>assertGuideOrPaymentEffect({action:'PAYMENT_EXECUTE'}),e=>e.code==='APPROVAL_REQUIRED');
});
test('DAE is not modeled as a tax type',()=>{assert.throws(()=>assertDaeSemantics({daeAsTaxType:true}),/COLLECTION_DOCUMENT/);});
