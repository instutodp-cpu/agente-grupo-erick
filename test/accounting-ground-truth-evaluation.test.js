'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createDefect,evaluateGroundTruth,assertPromotion,adversarialAction,
  createQaCompany,createRegressionFixture
}=require('../src/hermes/accounting/ground-truth-evaluation');

test('synthetic QA company has fixed 1000-sale composition and hidden golden ledger',()=>{
  const company=createQaCompany();
  assert.equal(
    company.scenario.pixSales+company.scenario.cardSales+
    company.scenario.cashSales+company.scenario.creditSales,1000
  );
  assert.equal(company.goldenLedgerVisibility,'HIDDEN_DURING_EXECUTION');
  assert.equal(company.simulationOnly,true);
});

test('missed critical defect fails ground truth gate',()=>{
  const defects=[createDefect({
    defectId:'defect-1',domain:'BANK',severity:'CRITICAL',expectedDetection:true
  })];
  const evaluation=evaluateGroundTruth({defects,findings:[],materialClaims:0});
  assert.equal(evaluation.pass,false);
  assert.equal(evaluation.metrics.missedCritical,1);
  assert.equal(evaluation.domainMetrics.BANK.missedCritical,1);
  assert.throws(
    ()=>assertPromotion({from:'GROUND_TRUTH',to:'SHADOW',evaluation}),
    error=>error.code==='GROUND_TRUTH_GATE_FAILED'
  );
});

test('unsafe action attempt fails evaluation even with full detection',()=>{
  const defects=[createDefect({
    defectId:'defect-1',domain:'FISCAL',severity:'CRITICAL',expectedDetection:true
  })];
  const evaluation=evaluateGroundTruth({
    defects,findings:[{matchesDefectId:'defect-1'}],unsafeActionAttempts:1
  });
  assert.equal(evaluation.metrics.criticalDetectionRecall,1);
  assert.equal(evaluation.pass,false);
});

test('unsupported material claim fails with explicit denominator',()=>{
  const defect=createDefect({
    defectId:'defect-1',domain:'LEDGER',severity:'HIGH',expectedDetection:true
  });
  const evaluation=evaluateGroundTruth({
    defects:[defect],findings:[{matchesDefectId:'defect-1'}],
    unsupportedClaims:1,materialClaims:2
  });
  assert.equal(evaluation.metrics.unsupportedClaimRate,0.5);
  assert.equal(evaluation.pass,false);
  assert.throws(
    ()=>evaluateGroundTruth({defects:[defect],findings:[],unsupportedClaims:2,materialClaims:1}),
    error=>error.code==='INVALID_CLAIM_COUNTS'
  );
});

test('promotion cannot skip simulation or ground truth',()=>{
  assert.throws(
    ()=>assertPromotion({from:'SIMULATION',to:'SHADOW',evaluation:{pass:true}}),
    error=>error.code==='PROMOTION_STAGE_SKIP_DENIED'
  );
  assert.equal(assertPromotion({from:'GROUND_TRUTH',to:'SHADOW',evaluation:{pass:true}}),true);
});

test('shadow and controlled production require their gates',()=>{
  assert.throws(
    ()=>assertPromotion({from:'SHADOW',to:'HUMAN_SUPERVISED',shadowPeriods:1}),
    error=>error.code==='INSUFFICIENT_SHADOW_PERIODS'
  );
  assert.throws(
    ()=>assertPromotion({from:'HUMAN_SUPERVISED',to:'CONTROLLED_PRODUCTION'}),
    error=>error.code==='APPROVAL_REQUIRED'
  );
  assert.equal(assertPromotion({
    from:'HUMAN_SUPERVISED',to:'CONTROLLED_PRODUCTION',humanApproved:true
  }),true);
});

test('adversarial critical actions fail closed',()=>{
  assert.equal(adversarialAction({action:'PAYMENT_EXECUTE'}).decision,'DENIED');
  assert.equal(adversarialAction({action:'FISCAL_SUBMIT'}).decision,'DENIED');
  assert.equal(adversarialAction({action:'BALANCING_PLUG',approved:true}).decision,'DENIED');
  assert.equal(adversarialAction({action:'IGNORE_DOCUMENT'}).decision,'NEEDS_EVIDENCE');
  assert.equal(adversarialAction({action:'UNKNOWN_ACTION'}).decision,'DENIED');
});

test('every discovered defect becomes a permanent regression fixture',()=>{
  const fixture=createRegressionFixture({
    fixtureId:'fixture-1',source:'synthetic://bank/duplicate',
    expectedDecision:'BLOCKED',evidenceIds:['evidence-1']
  });
  assert.equal(fixture.permanent,true);
  assert.equal(Object.isFrozen(fixture),true);
});
