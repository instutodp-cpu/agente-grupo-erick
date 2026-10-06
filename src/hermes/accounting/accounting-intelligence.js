'use strict';

const ANALYTIC_VIEWS=Object.freeze(['ACTUAL','FORECAST','FINAL']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function int(v,f){if(!Number.isSafeInteger(v))throw new Error(`${f} must be a safe integer`);}

function createMetric(i={}){
 for(const f of ['metricId','name','period','view','valueCents','dataFreshness','coverageBps','reconciliationStatus'])req(i[f],f);
 if(!ANALYTIC_VIEWS.includes(i.view))throw new Error('unsupported analytic view');
 int(i.valueCents,'valueCents');
 if(!Number.isSafeInteger(i.coverageBps)||i.coverageBps<0||i.coverageBps>10000)throw new Error('coverageBps must be 0..10000');
 const evidenceIds=Object.freeze([...(i.evidenceIds??[])]);
 return Object.freeze({...i,evidenceIds,evidenceCount:evidenceIds.length});
}
function createDre(i={}){
 for(const f of ['period','scopeType','scopeId','view'])req(i[f],f);
 if(!ANALYTIC_VIEWS.includes(i.view))throw new Error('unsupported analytic view');
 const lines=Object.freeze([...(i.lines??[])].map(x=>{req(x.name,'line.name');int(x.valueCents,'line.valueCents');return Object.freeze({...x});}));
 return Object.freeze({...i,lines});
}
function assertNoViewMix(metrics=[]){
 const views=new Set(metrics.map(x=>x.view));
 if(views.size>1){const e=new Error('ACTUAL_FORECAST_FINAL_MUST_NOT_BE_SILENTLY_MIXED');e.code='VIEW_MIX_DENIED';throw e;}
 return true;
}
function createMaterialAssertion(i={}){
 for(const f of ['assertionId','text','period','view','dataFreshness','coverageBps','reconciliationStatus'])req(i[f],f);
 if(!ANALYTIC_VIEWS.includes(i.view))throw new Error('unsupported analytic view');
 const evidenceIds=Object.freeze([...(i.evidenceIds??[])]);
 if(evidenceIds.length===0){const e=new Error('MATERIAL_ASSERTION_REQUIRES_EVIDENCE');e.code='EVIDENCE_REQUIRED';throw e;}
 return Object.freeze({...i,evidenceIds,evidenceCount:evidenceIds.length});
}
function decomposeDrivers({currentCents,priorCents,drivers=[]}={}){
 int(currentCents,'currentCents');int(priorCents,'priorCents');
 const normalized=Object.freeze(drivers.map(d=>{req(d.name,'driver.name');int(d.impactCents,'driver.impactCents');return Object.freeze({...d});}));
 const explained=normalized.reduce((s,d)=>s+d.impactCents,0),change=currentCents-priorCents;
 return Object.freeze({changeCents:change,explainedCents:explained,unexplainedCents:change-explained,drivers:normalized});
}
function createAnomaly(i={}){
 for(const f of ['anomalyId','signalType','period','detectorType'])req(i[f],f);
 if(!['DETERMINISTIC','STATISTICAL'].includes(i.detectorType))throw new Error('unsupported detector type');
 return Object.freeze({...i,requiresHumanReview:true,fraudConclusion:false,evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
function createCfoBrief(i={}){
 for(const f of ['briefId','period','generatedAt'])req(i[f],f);
 const assertions=Object.freeze([...(i.assertions??[])].map(createMaterialAssertion));
 return Object.freeze({...i,assertions,unsupportedClaimRate:0});
}
module.exports={ANALYTIC_VIEWS,createMetric,createDre,assertNoViewMix,createMaterialAssertion,decomposeDrivers,createAnomaly,createCfoBrief};
