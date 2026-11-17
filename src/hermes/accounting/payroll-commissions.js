'use strict';

const PAYROLL_EVENT_TYPES=Object.freeze([
  'SALARY','COMMISSION','OVERTIME','ABSENCE','DSR','VACATION','VACATION_BONUS',
  'THIRTEENTH_SALARY','BONUS','BENEFIT','INSS','FGTS','IRRF','ADVANCE',
  'DEDUCTION','TERMINATION','PRO_LABORE'
]);
const PROVISION_TYPES=Object.freeze([
  'VACATION','VACATION_BONUS','THIRTEENTH_SALARY','FGTS','INSS'
]);
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const COMPETENCE_RE=/^\d{4}-(0[1-9]|1[0-2])$/;

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
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)throw failure('INVALID_DATE',field+' is not a calendar date');
  return value;
}
function strictCompetence(value){
  if(typeof value!=='string'||!COMPETENCE_RE.test(value))throw failure('INVALID_COMPETENCE','competence must be YYYY-MM');
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
function createEmploymentContract(input={}){
  const contractId=requiredString(input.contractId,'contractId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const employeeId=requiredString(input.employeeId,'employeeId');
  const companyId=requiredString(input.companyId,'companyId');
  const establishmentId=requiredString(input.establishmentId,'establishmentId');
  const role=requiredString(input.role,'role');
  const effectiveFrom=strictDate(input.effectiveFrom,'effectiveFrom');
  const effectiveUntil=input.effectiveUntil===undefined||input.effectiveUntil===null
    ? null : strictDate(input.effectiveUntil,'effectiveUntil');
  if(effectiveUntil!==null&&effectiveUntil<effectiveFrom)
    throw failure('INVALID_CONTRACT_RANGE','effectiveUntil precedes effectiveFrom');
  return deepFreeze({
    ...input,contractId,tenantId,employeeId,companyId,establishmentId,role,
    effectiveFrom,effectiveUntil
  });
}
function createPayrollEvent(input={}){
  const eventId=requiredString(input.eventId,'eventId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const employeeId=requiredString(input.employeeId,'employeeId');
  const companyId=requiredString(input.companyId,'companyId');
  const contractId=requiredString(input.contractId,'contractId');
  const eventType=requiredString(input.eventType,'eventType');
  const competence=strictCompetence(input.competence);
  const source=requiredString(input.source,'source');
  safeCents(input.amountCents,'amountCents');
  if(!PAYROLL_EVENT_TYPES.includes(eventType))throw failure('UNSUPPORTED_EVENT_TYPE','unsupported payroll event type');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({
    ...input,eventId,tenantId,employeeId,companyId,contractId,eventType,
    competence,source,evidenceIds
  });
}
function createCommissionPlan(input={}){
  const planId=requiredString(input.planId,'planId');
  const version=requiredString(input.version,'version');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const effectiveFrom=strictDate(input.effectiveFrom,'effectiveFrom');
  const effectiveUntil=input.effectiveUntil===undefined||input.effectiveUntil===null
    ? null : strictDate(input.effectiveUntil,'effectiveUntil');
  const basisPoints=input.basisPoints;
  if(!Number.isSafeInteger(basisPoints)||basisPoints<0||basisPoints>10000)
    throw failure('INVALID_BASIS_POINTS','basisPoints must be an integer from 0 to 10000');
  if(effectiveUntil!==null&&effectiveUntil<effectiveFrom)
    throw failure('INVALID_PLAN_RANGE','effectiveUntil precedes effectiveFrom');
  return deepFreeze({
    ...input,planId,version,tenantId,companyId,effectiveFrom,effectiveUntil,basisPoints
  });
}
function assertPlanEffective(plan,occurredAt){
  const occurred=strictDate(occurredAt,'occurredAt');
  if(occurred<plan.effectiveFrom||(plan.effectiveUntil!==null&&occurred>plan.effectiveUntil))
    throw failure('PLAN_NOT_EFFECTIVE','commission plan is not effective for occurredAt');
  return true;
}
function toSafeNumber(value,field){
  if(value>BigInt(Number.MAX_SAFE_INTEGER))throw failure('OVERFLOW',field+' exceeds safe integer range');
  return Number(value);
}
function calculateCommission(input={}){
  const eligibleSalesCents=safeCents(input.eligibleSalesCents,'eligibleSalesCents');
  const plan=input.plan;
  if(!plan||typeof plan!=='object')throw failure('MISSING_PLAN','plan is required');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  if(plan.tenantId!==tenantId||plan.companyId!==companyId)
    throw failure('SCOPE_MISMATCH','commission plan scope does not match calculation');
  assertPlanEffective(plan,input.occurredAt);
  const numerator=BigInt(eligibleSalesCents)*BigInt(plan.basisPoints);
  const commission=toSafeNumber((numerator+5000n)/10000n,'commissionCents');
  return deepFreeze({
    commissionCents:commission,eligibleSalesCents,planId:plan.planId,
    planVersion:plan.version,basisPoints:plan.basisPoints,tenantId,companyId,
    occurredAt:input.occurredAt
  });
}
function reconcileCommission(input={}){
  const expectedCents=safeCents(input.expectedCents,'expectedCents');
  const payrollCents=safeCents(input.payrollCents,'payrollCents');
  const varianceCents=payrollCents-expectedCents;
  return deepFreeze({
    expectedCents,payrollCents,varianceCents,
    status:varianceCents===0?'MATCHED':'PAYROLL_EXCEPTION',
    requiresHumanReview:varianceCents!==0
  });
}
function createSalesIntegritySignal(input={}){
  const signalId=requiredString(input.signalId,'signalId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const employeeIds=uniqueStrings(input.employeeIds,'employeeIds');
  const saleIds=uniqueStrings(input.saleIds,'saleIds');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({
    signalId,tenantId,companyId,employeeIds,saleIds,evidenceIds,
    signalType:'SALES_ASSIGNMENT_ANOMALY',
    requiresHumanReview:true,fraudConclusion:false,disciplinaryDecision:false
  });
}
function createLaborProvision(input={}){
  const provisionId=requiredString(input.provisionId,'provisionId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const employeeId=requiredString(input.employeeId,'employeeId');
  const competence=strictCompetence(input.competence);
  const provisionType=requiredString(input.provisionType,'provisionType');
  const ruleVersion=requiredString(input.ruleVersion,'ruleVersion');
  safeCents(input.amountCents,'amountCents');
  if(!PROVISION_TYPES.includes(provisionType))throw failure('UNSUPPORTED_PROVISION_TYPE','unsupported provision type');
  return deepFreeze({
    ...input,provisionId,tenantId,companyId,employeeId,competence,
    provisionType,ruleVersion,valueState:'PROVISION'
  });
}
function assessPayrollReadiness(input={}){
  const blockers=[];
  const checks=[
    ['CONTRACT_NOT_RESOLVED','contractResolved'],
    ['TIME_FACTS_NOT_RESOLVED','timeFactsResolved'],
    ['SALES_FACTS_NOT_RESOLVED','salesFactsResolved'],
    ['RULES_NOT_EFFECTIVE','rulesEffective'],
    ['EVIDENCE_INCOMPLETE','evidenceComplete'],
    ['CALCULATION_NOT_DETERMINISTIC','deterministicCalculationPassed']
  ];
  for(const [blocker,key] of checks)if(input[key]!==true)blockers.push(blocker);
  if(input.scopeResolved===false)blockers.push('SCOPE_NOT_RESOLVED');
  return deepFreeze({
    status:blockers.length?'BLOCKED':'READY_FOR_REVIEW',
    blockers
  });
}
function createPayrollPreview(input={}){
  const previewId=requiredString(input.previewId,'previewId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const competence=strictCompetence(input.competence);
  if(!Array.isArray(input.events)||input.events.length===0)
    throw failure('MISSING_EVENTS','events must contain at least one payroll event');
  const events=input.events.map(event=>{
    if(event.tenantId!==tenantId||event.companyId!==companyId||event.competence!==competence)
      throw failure('SCOPE_MISMATCH','payroll event is outside preview scope');
    return event;
  });
  const employeeIds=uniqueStrings(events.map(event=>event.employeeId),'employeeIds');
  const blockers=input.readiness?.status==='READY_FOR_REVIEW'?[]:['READINESS_NOT_MET'];
  return deepFreeze({
    previewId,tenantId,companyId,competence,
    eventIds:events.map(event=>event.eventId),employeeIds,
    status:blockers.length?'BLOCKED':'READY_FOR_REVIEW',
    blockers,simulationOnly:true,paymentEffect:'NONE'
  });
}
function assertTerminationEffect(input={}){
  if(input.state!=='APPROVED')throw failure('TERMINATION_NOT_APPROVED','termination requires APPROVED state');
  if(input.humanApproved!==true)throw failure('APPROVAL_REQUIRED','termination requires human approval');
  return true;
}
module.exports={
  PAYROLL_EVENT_TYPES,PROVISION_TYPES,createEmploymentContract,createPayrollEvent,
  createCommissionPlan,calculateCommission,reconcileCommission,
  createSalesIntegritySignal,createLaborProvision,assessPayrollReadiness,
  createPayrollPreview,assertTerminationEffect
};
