'use strict';

const ANALYTIC_VIEWS=Object.freeze(['ACTUAL','FORECAST','FINAL']);
const DETECTOR_TYPES=Object.freeze(['DETERMINISTIC','STATISTICAL']);
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const INSTANT_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function deepFreeze(value,seen=new Set()){
  if(value===null||typeof value!=='object'||seen.has(value))return value;
  seen.add(value);
  for(const key of Reflect.ownKeys(value))deepFreeze(value[key],seen);
  return Object.freeze(value);
}
function failure(code,message){
  const error=new Error(message||code);
  error.code=code;
  return error;
}
function requiredString(value,field){
  if(typeof value!=='string'||value.trim()==='')throw failure('REQUIRED_FIELD',field+' is required');
  return value;
}
function safeInteger(value,field){
  if(!Number.isSafeInteger(value))throw failure('INVALID_INTEGER',field+' must be a safe integer');
  return value;
}
function strictDate(value,field){
  if(typeof value!=='string'||!DATE_RE.test(value))throw failure('INVALID_DATE',field+' must be YYYY-MM-DD');
  const date=new Date(value+'T00:00:00.000Z');
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)
    throw failure('INVALID_DATE',field+' is not a calendar date');
  return value;
}
function strictInstant(value,field){
  if(typeof value!=='string'||!INSTANT_RE.test(value))throw failure('INVALID_INSTANT',field+' must be an ISO UTC instant');
  if(Number.isNaN(new Date(value).getTime()))throw failure('INVALID_INSTANT',field+' is not a valid UTC instant');
  return value;
}
function validView(value){
  if(!ANALYTIC_VIEWS.includes(value))throw failure('UNSUPPORTED_ANALYTIC_VIEW','unsupported analytic view');
  return value;
}
function uniqueStrings(values,field){
  if(values===undefined)return [];
  if(!Array.isArray(values))throw failure('INVALID_LIST',field+' must be an array');
  const result=[];
  const seen=new Set();
  for(const value of values){
    requiredString(value,field+' item');
    if(seen.has(value))throw failure('DUPLICATE_ID',field+' contains duplicates');
    seen.add(value);
    result.push(value);
  }
  return result;
}
function coverage(value){
  if(!Number.isSafeInteger(value)||value<0||value>10000)
    throw failure('INVALID_COVERAGE','coverageBps must be 0..10000');
  return value;
}
function createMetric(input={}){
  const metricId=requiredString(input.metricId,'metricId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const name=requiredString(input.name,'name');
  const period=requiredString(input.period,'period');
  const view=validView(input.view);
  const dataFreshness=strictInstant(input.dataFreshness,'dataFreshness');
  const reconciliationStatus=requiredString(input.reconciliationStatus,'reconciliationStatus');
  const valueCents=safeInteger(input.valueCents,'valueCents');
  const coverageBps=coverage(input.coverageBps);
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({
    ...input,metricId,tenantId,companyId,name,period,view,dataFreshness,
    reconciliationStatus,valueCents,coverageBps,evidenceIds,
    evidenceCount:evidenceIds.length
  });
}
function createDre(input={}){
  const period=requiredString(input.period,'period');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const scopeType=requiredString(input.scopeType,'scopeType');
  const scopeId=requiredString(input.scopeId,'scopeId');
  const view=validView(input.view);
  if(!Array.isArray(input.lines)||input.lines.length===0)
    throw failure('MISSING_DRE_LINES','DRE requires at least one line');
  const lineIds=new Set();
  const lines=input.lines.map((line,index)=>{
    const lineId=requiredString(line.lineId||String(index+1),'line.lineId');
    if(lineIds.has(lineId))throw failure('DUPLICATE_ID','DRE line IDs must be unique');
    lineIds.add(lineId);
    return deepFreeze({
      ...line,lineId,name:requiredString(line.name,'line.name'),
      valueCents:safeInteger(line.valueCents,'line.valueCents')
    });
  });
  return deepFreeze({
    ...input,period,tenantId,companyId,scopeType,scopeId,view,lines
  });
}
function assertNoViewMix(metrics=[]){
  if(!Array.isArray(metrics))throw failure('INVALID_LIST','metrics must be an array');
  const views=new Set(metrics.map(metric=>validView(metric.view)));
  if(views.size>1)throw failure('VIEW_MIX_DENIED','ACTUAL, FORECAST and FINAL cannot be silently mixed');
  return true;
}
function createMaterialAssertion(input={}){
  const assertionId=requiredString(input.assertionId,'assertionId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const text=requiredString(input.text,'text');
  const period=requiredString(input.period,'period');
  const view=validView(input.view);
  const dataFreshness=strictInstant(input.dataFreshness,'dataFreshness');
  const reconciliationStatus=requiredString(input.reconciliationStatus,'reconciliationStatus');
  const coverageBps=coverage(input.coverageBps);
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  if(evidenceIds.length===0)throw failure('EVIDENCE_REQUIRED','material assertion requires evidence');
  return deepFreeze({
    ...input,assertionId,tenantId,companyId,text,period,view,dataFreshness,
    reconciliationStatus,coverageBps,evidenceIds,evidenceCount:evidenceIds.length
  });
}
function signedSafeNumber(value,field){
  if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER))
    throw failure('OVERFLOW',field+' exceeds safe integer range');
  return Number(value);
}
function decomposeDrivers(input={}){
  const currentCents=safeInteger(input.currentCents,'currentCents');
  const priorCents=safeInteger(input.priorCents,'priorCents');
  if(!Array.isArray(input.drivers))throw failure('INVALID_LIST','drivers must be an array');
  const drivers=input.drivers.map(driver=>deepFreeze({
    ...driver,name:requiredString(driver.name,'driver.name'),
    impactCents:safeInteger(driver.impactCents,'driver.impactCents')
  }));
  const explained=drivers.reduce((sum,driver)=>sum+BigInt(driver.impactCents),0n);
  const change=BigInt(currentCents)-BigInt(priorCents);
  return deepFreeze({
    changeCents:signedSafeNumber(change,'changeCents'),
    explainedCents:signedSafeNumber(explained,'explainedCents'),
    unexplainedCents:signedSafeNumber(change-explained,'unexplainedCents'),
    drivers
  });
}
function createAnomaly(input={}){
  const anomalyId=requiredString(input.anomalyId,'anomalyId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const signalType=requiredString(input.signalType,'signalType');
  const period=requiredString(input.period,'period');
  const detectorType=requiredString(input.detectorType,'detectorType');
  if(!DETECTOR_TYPES.includes(detectorType))throw failure('UNSUPPORTED_DETECTOR','unsupported detector type');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({
    ...input,anomalyId,tenantId,companyId,signalType,period,detectorType,
    evidenceIds,requiresHumanReview:true,fraudConclusion:false,disciplinaryDecision:false
  });
}
function createCfoBrief(input={}){
  const briefId=requiredString(input.briefId,'briefId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const period=requiredString(input.period,'period');
  const generatedAt=strictInstant(input.generatedAt,'generatedAt');
  if(!Array.isArray(input.assertions))throw failure('INVALID_LIST','assertions must be an array');
  const assertionIds=new Set();
  const assertions=input.assertions.map(assertion=>{
    const normalized=createMaterialAssertion({...assertion,tenantId,companyId});
    if(assertionIds.has(normalized.assertionId))throw failure('DUPLICATE_ID','brief assertion IDs must be unique');
    assertionIds.add(normalized.assertionId);
    return normalized;
  });
  return deepFreeze({
    ...input,briefId,tenantId,companyId,period,generatedAt,assertions,
    unsupportedClaimRate:0,simulationOnly:true
  });
}
module.exports={
  ANALYTIC_VIEWS,DETECTOR_TYPES,createMetric,createDre,assertNoViewMix,
  createMaterialAssertion,decomposeDrivers,createAnomaly,createCfoBrief
};
