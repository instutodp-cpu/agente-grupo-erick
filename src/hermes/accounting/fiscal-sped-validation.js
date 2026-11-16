'use strict';

const FISCAL_OBLIGATION_STATES=Object.freeze([
  'FORECAST','PREPARING','VALIDATING','READY_FOR_REVIEW','APPROVED',
  'SUBMITTED','ACCEPTED','REJECTED','PAID','RECONCILED'
]);
const TAX_CLASSIFICATION_FIELDS=Object.freeze([
  'cfop','ncm','cest','cst','csosn','origin','icms','ipi','pis','cofins','ibs','cbs'
]);
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const COMPETENCE_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
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
function strictDate(value,field){
  if(typeof value!=='string'||!DATE_RE.test(value))throw failure('INVALID_DATE',field+' must be YYYY-MM-DD');
  const date=new Date(value+'T00:00:00.000Z');
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)throw failure('INVALID_DATE',field+' is not a calendar date');
  return value;
}
function strictInstantOrDate(value,field){
  if(typeof value!=='string')throw failure('INVALID_DATE',field+' must be an ISO date or UTC instant');
  if(DATE_RE.test(value))return strictDate(value,field);
  if(!INSTANT_RE.test(value))throw failure('INVALID_DATE',field+' must be YYYY-MM-DD or an ISO UTC instant');
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))throw failure('INVALID_DATE',field+' is not a valid UTC instant');
  return value;
}
function strictCompetence(value){
  if(typeof value!=='string'||!COMPETENCE_RE.test(value))throw failure('INVALID_COMPETENCE','competence must be YYYY-MM');
  return value;
}
function datePart(value,field){
  return strictInstantOrDate(value,field).slice(0,10);
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
function createFiscalRule(input={}){
  const rule={
    ruleId:requiredString(input.ruleId,'ruleId'),
    version:requiredString(input.version,'version'),
    authority:requiredString(input.authority,'authority'),
    officialSource:requiredString(input.officialSource,'officialSource'),
    effectiveFrom:strictDate(input.effectiveFrom,'effectiveFrom'),
    effectiveUntil:input.effectiveUntil===undefined||input.effectiveUntil===null
      ? null : strictDate(input.effectiveUntil,'effectiveUntil'),
    schemaHash:requiredString(input.schemaHash,'schemaHash')
  };
  if(rule.effectiveUntil!==null&&rule.effectiveUntil<rule.effectiveFrom)
    throw failure('INVALID_RULE_RANGE','effectiveUntil precedes effectiveFrom');
  return deepFreeze(rule);
}
function validateRuleEffective(rule,instant){
  if(!rule||typeof rule!=='object')throw failure('MISSING_OFFICIAL_RULE','official fiscal rule is required');
  const from=strictDate(rule.effectiveFrom,'effectiveFrom');
  const until=rule.effectiveUntil===undefined||rule.effectiveUntil===null
    ? null : strictDate(rule.effectiveUntil,'effectiveUntil');
  const occurred=datePart(instant,'occurredAt');
  if(until!==null&&until<from)throw failure('INVALID_RULE_RANGE','effectiveUntil precedes effectiveFrom');
  if(occurred<from||(until!==null&&occurred>until))
    throw failure('RULE_NOT_EFFECTIVE','fiscal rule is not effective for occurredAt');
  return true;
}
function validateFiscalClassification(input={}){
  const issues=[];
  if(input.documentValidity!=='VALID')issues.push('DOCUMENT_NOT_VALID');
  if(input.occurredAt===undefined){
    issues.push('MISSING_OCCURRED_AT');
  }else{
    try{strictInstantOrDate(input.occurredAt,'occurredAt');}
    catch(error){issues.push(error.code||'INVALID_OCCURRED_AT');}
  }
  if(!input.rule){
    issues.push('MISSING_OFFICIAL_RULE');
  }else{
    try{validateRuleEffective(input.rule,input.occurredAt);}
    catch(error){issues.push(error.code||'INVALID_FISCAL_RULE');}
  }
  const requiredFields=Array.isArray(input.requiredFields)?input.requiredFields:[];
  const classification=input.classification&&typeof input.classification==='object'
    ? input.classification : {};
  for(const field of requiredFields){
    if(!TAX_CLASSIFICATION_FIELDS.includes(field)){
      issues.push('INVALID_REQUIRED_FIELD:'+String(field));
    }else if(classification[field]===undefined||classification[field]===null||classification[field]===''){
      issues.push('MISSING_'+field.toUpperCase());
    }
  }
  const source=String(input.classificationSource||input.proposedBy||'').toUpperCase();
  if(source==='LLM'||source==='AI')issues.push('CLASSIFICATION_NEEDS_REVIEW');
  return deepFreeze({
    status:issues.length?'BLOCKED':'VALIDATED',
    issues
  });
}
function crossCheckFiscal(input={}){
  const checks=Object.freeze([
    'fiscalToPurchase','fiscalToInventory','fiscalToPayable','fiscalToJournal'
  ]);
  const failedChecks=checks.filter(key=>input[key]!==true);
  return deepFreeze({
    status:failedChecks.length?'NEEDS_REVIEW':'MATCHED',
    failedChecks
  });
}
function createFiscalObligation(input={}){
  const obligationId=requiredString(input.obligationId,'obligationId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const obligationType=requiredString(input.obligationType,'obligationType');
  const competence=strictCompetence(input.competence);
  const ruleVersion=requiredString(input.ruleVersion,'ruleVersion');
  const state=input.state===undefined?'FORECAST':input.state;
  if(!FISCAL_OBLIGATION_STATES.includes(state))throw failure('INVALID_STATE','unknown fiscal obligation state');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({
    ...input,obligationId,tenantId,companyId,obligationType,competence,ruleVersion,
    state,evidenceIds
  });
}
function assessFiscalReadiness(input={}){
  const blockers=[];
  const requiredChecks=[
    ['SCHEMA_NOT_VALIDATED','schemaValidated'],
    ['BUSINESS_RULES_NOT_VALIDATED','businessValidated'],
    ['CROSS_CHECKS_NOT_MATCHED','crossChecksMatched'],
    ['EVIDENCE_INCOMPLETE','evidenceComplete']
  ];
  for(const [blocker,key] of requiredChecks)if(input[key]!==true)blockers.push(blocker);
  if(input.classificationValidated===false)blockers.push('FISCAL_CLASSIFICATION_NOT_VALIDATED');
  return deepFreeze({
    state:blockers.length?'VALIDATING':'READY_FOR_REVIEW',
    blockers
  });
}
function createPreSpedPackage(input={}){
  const packageId=requiredString(input.packageId,'packageId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const competence=strictCompetence(input.competence);
  const blockers=[];
  if(input.classificationResult?.status!=='VALIDATED')blockers.push('CLASSIFICATION_NOT_VALIDATED');
  if(input.crossCheckResult?.status!=='MATCHED')blockers.push('CROSS_CHECKS_NOT_MATCHED');
  if(input.readiness?.state!=='READY_FOR_REVIEW')blockers.push('READINESS_NOT_MET');
  return deepFreeze({
    packageId,tenantId,companyId,competence,
    status:blockers.length?'BLOCKED':'READY_FOR_REVIEW',
    blockers,
    simulationOnly:true,
    submissionEffect:'NONE'
  });
}
function assertFiscalSubmit(input={}){
  if(input.state!=='APPROVED')throw failure('FISCAL_NOT_APPROVED','fiscal submission requires APPROVED state');
  if(input.humanApproved!==true)throw failure('APPROVAL_REQUIRED','fiscal submission requires human approval');
  return true;
}
function recordSubmissionResult(input={}){
  if(input.submitted!==true)return deepFreeze({
    state:'APPROVED',rejectionCode:null,simulationOnly:true
  });
  if(input.accepted===true)return deepFreeze({
    state:'ACCEPTED',rejectionCode:null,simulationOnly:true
  });
  if(input.accepted===false){
    const rejectionCode=requiredString(input.rejectionCode,'rejectionCode');
    return deepFreeze({state:'REJECTED',rejectionCode,simulationOnly:true});
  }
  return deepFreeze({state:'SUBMITTED',rejectionCode:null,simulationOnly:true});
}
module.exports={
  FISCAL_OBLIGATION_STATES,TAX_CLASSIFICATION_FIELDS,createFiscalRule,
  validateRuleEffective,validateFiscalClassification,crossCheckFiscal,
  createFiscalObligation,assessFiscalReadiness,createPreSpedPackage,
  assertFiscalSubmit,recordSubmissionResult
};
