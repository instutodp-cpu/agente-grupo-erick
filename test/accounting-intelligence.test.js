'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createMetric,createDre,assertNoViewMix,createMaterialAssertion,decomposeDrivers,createAnomaly,createCfoBrief}=require('../src/hermes/accounting/accounting-intelligence');

test('metric carries freshness coverage reconciliation and evidence count',()=>{
 const m=createMetric({metricId:'m',name:'revenue',period:'2026-10',view:'ACTUAL',valueCents:10000,dataFreshness:'2026-10-02T12:00:00Z',coverageBps:9900,reconciliationStatus:'PARTIAL',evidenceIds:['e1']});
 assert.equal(m.evidenceCount,1);assert.equal(m.coverageBps,9900);
});
test('actual forecast and final cannot be silently mixed',()=>{
 const a={view:'ACTUAL'},f={view:'FORECAST'};assert.throws(()=>assertNoViewMix([a,f]),e=>e.code==='VIEW_MIX_DENIED');
 assert.equal(assertNoViewMix([a,{view:'ACTUAL'}]),true);
});
test('material financial assertion without evidence is denied',()=>{
 assert.throws(()=>createMaterialAssertion({assertionId:'a',text:'margin fell',period:'2026-10',view:'ACTUAL',dataFreshness:'now',coverageBps:10000,reconciliationStatus:'MATCHED'}),e=>e.code==='EVIDENCE_REQUIRED');
});
test('driver decomposition exposes unexplained change',()=>{
 const d=decomposeDrivers({currentCents:13000,priorCents:10000,drivers:[{name:'volume',impactCents:2000},{name:'price',impactCents:500}]});
 assert.equal(d.changeCents,3000);assert.equal(d.unexplainedCents,500);
});
test('DRE supports scoped deterministic lines',()=>{
 const d=createDre({period:'2026-10',scopeType:'STORE',scopeId:'barreiros',view:'ACTUAL',lines:[{name:'Revenue',valueCents:100000},{name:'COGS',valueCents:-60000}]});
 assert.equal(d.lines.length,2);assert.equal(d.scopeType,'STORE');
});
test('anomaly is a signal and never automatic fraud conclusion',()=>{
 const a=createAnomaly({anomalyId:'x',signalType:'DISCOUNT_SPIKE',period:'2026-10',detectorType:'STATISTICAL'});
 assert.equal(a.requiresHumanReview,true);assert.equal(a.fraudConclusion,false);
});
test('CFO brief accepts only evidence-backed assertions',()=>{
 const b=createCfoBrief({briefId:'b',period:'2026-10-02',generatedAt:'now',assertions:[{assertionId:'a',text:'cash need in 7 days',period:'2026-10-02',view:'FORECAST',dataFreshness:'now',coverageBps:10000,reconciliationStatus:'MATCHED',evidenceIds:['tax-1']}]});
 assert.equal(b.unsupportedClaimRate,0);
});
