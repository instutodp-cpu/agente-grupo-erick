'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createTaxObligation,transitionTaxState,createSimpleTaxForecast,
  reconcileAssessment,cashForecast,assertGuideOrPaymentEffect,assertDaeSemantics
}=require('../src/hermes/accounting/tax-forecasting');

const scope={tenantId:'tenant-a',companyId:'company-a'};

test('forecast is tenant scoped and explicitly not official assessment',()=>{
  const forecast=createSimpleTaxForecast({
    forecastId:'forecast-1',...scope,competence:'2026-10',
    currentRevenueCents:1000000,rbt12Cents:12000000,
    ruleVersion:'rule-1',scenario:'CURRENT',estimatedDasCents:60000
  });
  assert.equal(forecast.valueState,'FORECAST');
  assert.equal(forecast.officialAssessment,false);
  assert.equal(forecast.simulationOnly,true);
  assert.equal(Object.isFrozen(forecast),true);
});

test('tax lifecycle cannot skip stages',()=>{
  assert.equal(transitionTaxState('FORECAST','EXPECTED'),'EXPECTED');
  assert.throws(
    ()=>transitionTaxState('FORECAST','PAID'),
    error=>error.code==='TAX_STATE_TRANSITION_NOT_ALLOWED'
  );
  assert.equal(transitionTaxState('GUIDE_ISSUED','PAID'),'PAID');
});

test('official assessment is reconciled against forecast',()=>{
  const result=reconcileAssessment({forecastCents:60000,assessedCents:60001});
  assert.equal(result.status,'TAX_EXCEPTION');
  assert.equal(result.varianceCents,1);
  assert.equal(result.requiresHumanReview,true);
});

test('cash forecast exposes safe 7 14 30 60 90 day horizons',()=>{
  const a=createTaxObligation({
    taxObligationId:'tax-a',...scope,taxType:'DAS',competence:'2026-10',
    source:'PGDAS_D',ruleVersion:'rule-1',state:'EXPECTED',
    amountCents:10000,dueDate:'2026-10-09'
  });
  const b=createTaxObligation({
    taxObligationId:'tax-b',...scope,taxType:'FGTS',competence:'2026-10',
    source:'ESOCIAL',ruleVersion:'rule-1',state:'EXPECTED',
    amountCents:5000,dueDate:'2026-11-01'
  });
  const result=cashForecast([a,b],'2026-10-02',scope);
  assert.equal(result[7],10000);
  assert.equal(result[14],10000);
  assert.equal(result[30],15000);
  assert.equal(result[90],15000);
  assert.equal(Object.isFrozen(result),true);
  assert.throws(
    ()=>cashForecast([a,{...b,tenantId:'tenant-b'}],'2026-10-02',scope),
    error=>error.code==='SCOPE_MISMATCH'
  );
});

test('invalid competence and source fail closed',()=>{
  assert.throws(
    ()=>createTaxObligation({
      taxObligationId:'bad',...scope,taxType:'DAS',competence:'2026-13',
      source:'PGDAS_D',ruleVersion:'rule-1'
    }),
    error=>error.code==='INVALID_COMPETENCE'
  );
  assert.throws(
    ()=>createTaxObligation({
      taxObligationId:'bad',...scope,taxType:'DAS',competence:'2026-10',
      source:'UNKNOWN',ruleVersion:'rule-1'
    }),
    error=>error.code==='UNSUPPORTED_TAX_SOURCE'
  );
});

test('guide issue and payment execution require approved state and human approval',()=>{
  assert.throws(
    ()=>assertGuideOrPaymentEffect({action:'GUIDE_ISSUE',state:'READY_FOR_REVIEW',humanApproved:true}),
    error=>error.code==='TAX_EFFECT_NOT_APPROVED'
  );
  assert.throws(
    ()=>assertGuideOrPaymentEffect({action:'PAYMENT_EXECUTE',state:'APPROVED'}),
    error=>error.code==='APPROVAL_REQUIRED'
  );
  assert.equal(assertGuideOrPaymentEffect({
    action:'GUIDE_ISSUE',state:'APPROVED',humanApproved:true
  }),true);
});

test('DAE is not modeled as a tax type',()=>{
  assert.throws(
    ()=>assertDaeSemantics({taxType:'DAE'}),
    error=>error.code==='DAE_IS_COLLECTION_DOCUMENT'
  );
});
