'use strict';

const GOVERNMENT_SYSTEMS=Object.freeze(['ESOCIAL','EFD_REINF','DCTFWEB','FGTS_DIGITAL']);
const EVENT_STATES=Object.freeze([
  'DRAFT','VALIDATED','READY_FOR_REVIEW','APPROVED','READY_TO_SUBMIT',
  'SUBMITTED','PROCESSING','ACCEPTED','REJECTED'
]);
const COMPETENCE_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
const TRANSITIONS=Object.freeze({
  DRAFT:Object.freeze(['VALIDATED']),
  VALIDATED:Object.freeze(['READY_FOR_REVIEW']),
  READY_FOR_REVIEW:Object.freeze(['APPROVED']),
  APPROVED:Object.freeze(['READY_TO_SUBMIT']),
  READY_TO_SUBMIT:Object.freeze(['SUBMITTED']),
  SUBMITTED:Object.freeze(['PROCESSING','ACCEPTED','REJECTED']),
  PROCESSING:Object.freeze(['ACCEPTED','REJECTED']),
  ACCEPTED:Object.freeze([]),
  REJECTED:Object.freeze([])
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
function strictCompetence(value){
  if(typeof value!=='string'||!COMPETENCE_RE.test(value))
    throw failure('INVALID_COMPETENCE','competence must be YYYY-MM');
  return value;
}
function safeCents(value,field){
  if(!Number.isSafeInteger(value)||value<0)throw failure('INVALID_CENTS',field+' must be a non-negative safe integer');
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
function createGovernmentEvent(input={}){
  const eventId=requiredString(input.eventId,'eventId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const system=requiredString(input.system,'system');
  const eventType=requiredString(input.eventType,'eventType');
  const competence=strictCompetence(input.competence);
  const schemaVersion=requiredString(input.schemaVersion,'schemaVersion');
  const ruleVersion=requiredString(input.ruleVersion,'ruleVersion');
  const payloadHash=requiredString(input.payloadHash,'payloadHash');
  const state=input.state===undefined?'DRAFT':input.state;
  if(!GOVERNMENT_SYSTEMS.includes(system))throw failure('UNSUPPORTED_GOVERNMENT_SYSTEM','unsupported government system');
  if(!EVENT_STATES.includes(state))throw failure('UNSUPPORTED_EVENT_STATE','unsupported event state');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({
    ...input,eventId,tenantId,companyId,system,eventType,competence,
    schemaVersion,ruleVersion,payloadHash,state,evidenceIds
  });
}
function transitionGovernmentEvent(current,next){
  if(!EVENT_STATES.includes(current)||!EVENT_STATES.includes(next))
    throw failure('UNSUPPORTED_EVENT_STATE','unsupported event state');
  if(!TRANSITIONS[current].includes(next))
    throw failure('EVENT_STATE_TRANSITION_NOT_ALLOWED','event state transition is not allowed');
  return next;
}
function validateGovernmentEvent(input={}){
  const blockers=[];
  const checks=[
    ['SCHEMA_INVALID','schemaValid'],
    ['BUSINESS_RULES_INVALID','businessRulesValid'],
    ['DEPENDENCIES_UNRESOLVED','dependenciesResolved'],
    ['CROSS_SOURCE_NOT_MATCHED','crossSourceMatched'],
    ['EVIDENCE_INCOMPLETE','evidenceComplete']
  ];
  for(const [blocker,key] of checks)if(input[key]!==true)blockers.push(blocker);
  return deepFreeze({
    state:blockers.length?'DRAFT':'VALIDATED',
    blockers
  });
}
function assertFiscalSubmit(input={}){
  if(input.humanApproved!==true)
    throw failure('APPROVAL_REQUIRED','fiscal submission requires human approval');
  if(input.state!=='APPROVED')
    throw failure('FISCAL_NOT_APPROVED','fiscal submission requires APPROVED state');
  return true;
}
function recordGovernmentResponse(input={}){
  if(input.submitted!==true)return deepFreeze({
    state:'READY_TO_SUBMIT',protocol:null,rejection:null,simulationOnly:true
  });
  if(input.accepted===true)return deepFreeze({
    state:'ACCEPTED',protocol:input.protocol??null,rejection:null,simulationOnly:true
  });
  if(input.accepted===false){
    const rejectionCode=requiredString(input.rejectionCode,'rejectionCode');
    return deepFreeze({
      state:'REJECTED',protocol:input.protocol??null,
      rejection:{code:rejectionCode,message:input.rejectionMessage??null},
      simulationOnly:true
    });
  }
  return deepFreeze({
    state:input.processing===true?'PROCESSING':'SUBMITTED',
    protocol:input.protocol??null,rejection:null,simulationOnly:true
  });
}
function createRectification(input={}){
  const rectificationId=requiredString(input.rectificationId,'rectificationId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const originalEventId=requiredString(input.originalEventId,'originalEventId');
  const replacementEventId=requiredString(input.replacementEventId,'replacementEventId');
  const reason=requiredString(input.reason,'reason');
  const requestedBy=requiredString(input.requestedBy,'requestedBy');
  if(originalEventId===replacementEventId)
    throw failure('RECTIFICATION_VERSION_REQUIRED','rectification must create a new event version');
  return deepFreeze({
    rectificationId,tenantId,companyId,originalEventId,replacementEventId,
    reason,requestedBy,status:'PENDING_REVIEW',overwritesOriginal:false
  });
}
function createTaxPaymentDocument(input={}){
  const documentId=requiredString(input.documentId,'documentId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const documentType=requiredString(input.documentType,'documentType');
  const competence=strictCompetence(input.competence);
  const sourceSystem=requiredString(input.sourceSystem,'sourceSystem');
  const amountCents=safeCents(input.amountCents,'amountCents');
  const state=input.state===undefined?'GUIDE_ISSUED':input.state;
  if(state!=='GUIDE_ISSUED')throw failure('PAYMENT_DOCUMENT_NOT_ISSUED','new payment document must start GUIDE_ISSUED');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({
    ...input,documentId,tenantId,companyId,documentType,competence,
    sourceSystem,amountCents,state,evidenceIds
  });
}
function reconcileOfficialObligation(input={}){
  const checks=[
    'expectedMatched','reportedMatched','assessedMatched',
    'guideMatched','bankConfirmed','accounted'
  ];
  const failedChecks=checks.filter(key=>input[key]!==true);
  return deepFreeze({
    state:failedChecks.length?'NOT_RECONCILED':'RECONCILED',
    failedChecks
  });
}
module.exports={
  GOVERNMENT_SYSTEMS,EVENT_STATES,createGovernmentEvent,
  transitionGovernmentEvent,validateGovernmentEvent,assertFiscalSubmit,
  recordGovernmentResponse,createRectification,createTaxPaymentDocument,
  reconcileOfficialObligation
};
