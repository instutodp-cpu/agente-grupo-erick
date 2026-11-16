'use strict';

const TAX_STATES=Object.freeze([
  'FORECAST','EXPECTED','ASSESSED','GUIDE_ISSUED','PAID','RECONCILED'
]);
const TAX_SOURCES=Object.freeze([
  'ESOCIAL','EFD_REINF','MIT','PGDAS_D','STATE','MUNICIPAL','OTHER'
]);
const SCENARIOS=Object.freeze(['CURRENT','EXPECTED','CONSERVATIVE','STRESS']);
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const COMPETENCE_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
const TRANSITIONS=Object.freeze({
  FORECAST:Object.freeze(['EXPECTED']),
  EXPECTED:Object.freeze(['ASSESSED']),
  ASSESSED:Object.freeze(['GUIDE_ISSUED']),
  GUIDE_ISSUED:Object.freeze(['PAID']),
  PAID:Object.freeze(['RECONCILED']),
  RECONCILED:Object.freeze([])
});

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
function safeCents(value,field){
  if(!Number.isSafeInteger(value)||value<0)throw failure('INVALID_CENTS',field+' must be a non-negative safe integer');
  return value;
}
function strictDate(value,field){
  if(typeof value!=='string'||!DATE_RE.test(value))throw failure('INVALID_DATE',field+' must be YYYY-MM-DD');
  const date=new Date(value+'T00:00:00.000Z');
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)
    throw failure('INVALID_DATE',field+' is not a calendar date');
  return value;
}
function strictCompetence(value){
  if(typeof value!=='string'||!COMPETENCE_RE.test(value))
    throw failure('INVALID_COMPETENCE','competence must be YYYY-MM');
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
function createTaxObligation(input={}){
  const taxObligationId=requiredString(input.taxObligationId,'taxObligationId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const taxType=requiredString(input.taxType,'taxType');
  const competence=strictCompetence(input.competence);
  const source=requiredString(input.source,'source');
  const ruleVersion=requiredString(input.ruleVersion,'ruleVersion');
  const state=input.state===undefined?'FORECAST':input.state;
  if(!TAX_SOURCES.includes(source))throw failure('UNSUPPORTED_TAX_SOURCE','unsupported tax source');
  if(!TAX_STATES.includes(state))throw failure('UNSUPPORTED_TAX_STATE','unsupported tax state');
  if(input.amountCents!==undefined&&input.amountCents!==null)safeCents(input.amountCents,'amountCents');
  const dueDate=input.dueDate===undefined||input.dueDate===null
    ? null : strictDate(input.dueDate,'dueDate');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({
    ...input,taxObligationId,tenantId,companyId,taxType,competence,source,
    ruleVersion,state,dueDate,evidenceIds
  });
}
function transitionTaxState(current,next){
  if(!TAX_STATES.includes(current)||!TAX_STATES.includes(next))
    throw failure('UNSUPPORTED_TAX_STATE','unsupported tax state');
  if(!TRANSITIONS[current].includes(next))
    throw failure('TAX_STATE_TRANSITION_NOT_ALLOWED','tax state transition is not allowed');
  return next;
}
function createSimpleTaxForecast(input={}){
  const forecastId=requiredString(input.forecastId,'forecastId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const competence=strictCompetence(input.competence);
  const ruleVersion=requiredString(input.ruleVersion,'ruleVersion');
  safeCents(input.currentRevenueCents,'currentRevenueCents');
  safeCents(input.rbt12Cents,'rbt12Cents');
  if(!SCENARIOS.includes(input.scenario))throw failure('UNSUPPORTED_SCENARIO','unsupported scenario');
  if(input.estimatedDasCents!==undefined&&input.estimatedDasCents!==null)
    safeCents(input.estimatedDasCents,'estimatedDasCents');
  return deepFreeze({
    ...input,forecastId,tenantId,companyId,competence,ruleVersion,
    valueState:'FORECAST',officialAssessment:false,simulationOnly:true
  });
}
function reconcileAssessment(input={}){
  const forecastCents=safeCents(input.forecastCents,'forecastCents');
  const assessedCents=safeCents(input.assessedCents,'assessedCents');
  const toleranceCents=input.toleranceCents===undefined?0:safeCents(input.toleranceCents,'toleranceCents');
  const varianceCents=assessedCents-forecastCents;
  return deepFreeze({
    forecastCents,assessedCents,toleranceCents,varianceCents,
    status:Math.abs(varianceCents)<=toleranceCents?'MATCHED':'TAX_EXCEPTION',
    requiresHumanReview:Math.abs(varianceCents)>toleranceCents
  });
}
function toSafeNumber(value,field){
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw failure('OVERFLOW',field+' exceeds safe integer range');
  return Number(value);
}
function cashForecast(obligations=[],asOf,scope={}){
  if(!Array.isArray(obligations))throw failure('INVALID_LIST','obligations must be an array');
  const tenantId=requiredString(scope.tenantId,'scope.tenantId');
  const companyId=requiredString(scope.companyId,'scope.companyId');
  const base=strictDate(asOf,'asOf');
  const baseMs=Date.parse(base+'T00:00:00.000Z');
  const horizons=[7,14,30,60,90];
  const seen=new Set();
  const totals=Object.fromEntries(horizons.map(horizon=>[horizon,0n]));
  for(const obligation of obligations){
    if(!obligation||typeof obligation!=='object')throw failure('INVALID_OBLIGATION','obligation must be an object');
    if(obligation.tenantId!==tenantId||obligation.companyId!==companyId)
      throw failure('SCOPE_MISMATCH','tax obligation is outside forecast scope');
    if(seen.has(obligation.taxObligationId))throw failure('DUPLICATE_ID','duplicate tax obligation');
    seen.add(obligation.taxObligationId);
    if(obligation.state==='PAID'||obligation.state==='RECONCILED'||obligation.dueDate===null||obligation.amountCents===null||obligation.amountCents===undefined)continue;
    const due=strictDate(obligation.dueDate,'dueDate');
    const days=Math.ceil((Date.parse(due+'T00:00:00.000Z')-baseMs)/86400000);
    if(days<0)continue;
    const amount=safeCents(obligation.amountCents,'amountCents');
    for(const horizon of horizons)if(days<=horizon)totals[horizon]+=BigInt(amount);
  }
  return deepFreeze(Object.fromEntries(horizons.map(horizon=>[
    horizon,toSafeNumber(totals[horizon],'cashForecast')
  ])));
}
function assertGuideOrPaymentEffect(input={}){
  const action=requiredString(input.action,'action');
  if(action!=='GUIDE_ISSUE'&&action!=='PAYMENT_EXECUTE')
    throw failure('UNSUPPORTED_EFFECT','unsupported tax effect');
  if(input.state!=='APPROVED')throw failure('TAX_EFFECT_NOT_APPROVED','tax effect requires APPROVED state');
  if(input.humanApproved!==true)throw failure('APPROVAL_REQUIRED','tax effect requires human approval');
  return true;
}
function assertDaeSemantics(input={}){
  if(input.daeAsTaxType===true||String(input.taxType||'').toUpperCase()==='DAE')
    throw failure('DAE_IS_COLLECTION_DOCUMENT','DAE is a collection document, not a tax type');
  return true;
}
module.exports={
  TAX_STATES,TAX_SOURCES,SCENARIOS,createTaxObligation,transitionTaxState,
  createSimpleTaxForecast,reconcileAssessment,cashForecast,
  assertGuideOrPaymentEffect,assertDaeSemantics
};
