'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createMetric,createDre,assertNoViewMix,createMaterialAssertion,
  decomposeDrivers,createAnomaly,createCfoBrief
}=require('../src/hermes/accounting/accounting-intelligence');

const scope={tenantId:'tenant-a',companyId:'company-a'};
const freshness='2026-10-02T12:00:00Z';

test('metric carries scope, freshness, coverage, reconciliation and evidence count',()=>{
  const metric=createMetric({
    metricId:'metric-1',...scope,name:'revenue',period:'2026-10',
    view:'ACTUAL',valueCents:10000,dataFreshness:freshness,
    coverageBps:9900,reconciliationStatus:'PARTIAL',evidenceIds:['evidence-1']
  });
  assert.equal(metric.evidenceCount,1);
  assert.equal(metric.coverageBps,9900);
  assert.equal(Object.isFrozen(metric),true);
});

test('actual forecast and final cannot be silently mixed',()=>{
  assert.throws(
    ()=>assertNoViewMix([{view:'ACTUAL'},{view:'FORECAST'}]),
    error=>error.code==='VIEW_MIX_DENIED'
  );
  assert.equal(assertNoViewMix([{view:'ACTUAL'},{view:'ACTUAL'}]),true);
});

test('material assertion without evidence is denied',()=>{
  assert.throws(
    ()=>createMaterialAssertion({
      assertionId:'assertion-1',...scope,text:'margin fell',
      period:'2026-10',view:'ACTUAL',dataFreshness:freshness,
      coverageBps:10000,reconciliationStatus:'MATCHED'
    }),
    error=>error.code==='EVIDENCE_REQUIRED'
  );
});

test('driver decomposition exposes unexplained change with safe arithmetic',()=>{
  const result=decomposeDrivers({
    currentCents:13000,priorCents:10000,
    drivers:[{name:'volume',impactCents:2000},{name:'price',impactCents:500}]
  });
  assert.equal(result.changeCents,3000);
  assert.equal(result.unexplainedCents,500);
  assert.throws(
    ()=>decomposeDrivers({
      currentCents:Number.MAX_SAFE_INTEGER,priorCents:0,
      drivers:[{name:'overflow',impactCents:Number.MAX_SAFE_INTEGER}]
    }),
    error=>error.code==='OVERFLOW'
  );
});

test('DRE supports scoped deterministic lines',()=>{
  const dre=createDre({
    period:'2026-10',...scope,scopeType:'STORE',scopeId:'store-a',
    view:'ACTUAL',
    lines:[
      {lineId:'revenue',name:'Revenue',valueCents:100000},
      {lineId:'cogs',name:'COGS',valueCents:-60000}
    ]
  });
  assert.equal(dre.lines.length,2);
  assert.equal(dre.scopeType,'STORE');
  assert.equal(Object.isFrozen(dre.lines[0]),true);
});

test('anomaly is a signal and never automatic fraud conclusion',()=>{
  const anomaly=createAnomaly({
    anomalyId:'anomaly-1',...scope,signalType:'DISCOUNT_SPIKE',
    period:'2026-10',detectorType:'STATISTICAL',evidenceIds:['evidence-2']
  });
  assert.equal(anomaly.requiresHumanReview,true);
  assert.equal(anomaly.fraudConclusion,false);
  assert.equal(anomaly.disciplinaryDecision,false);
});

test('CFO brief accepts only evidence-backed scoped assertions',()=>{
  const brief=createCfoBrief({
    briefId:'brief-1',...scope,period:'2026-10-02',
    generatedAt:freshness,
    assertions:[{
      assertionId:'assertion-1',text:'cash need in 7 days',period:'2026-10-02',
      view:'FORECAST',dataFreshness:freshness,coverageBps:10000,
      reconciliationStatus:'MATCHED',evidenceIds:['tax-1']
    }]
  });
  assert.equal(brief.unsupportedClaimRate,0);
  assert.equal(brief.simulationOnly,true);
  assert.equal(Object.isFrozen(brief),true);
});
