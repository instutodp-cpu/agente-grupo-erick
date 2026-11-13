'use strict';

const FISCAL_GATEWAY_STATES=Object.freeze(['DISABLED','VALIDATING','AUTHORIZED','SUBMITTING','SUBMITTED','PROCESSING','ACCEPTED','REJECTED','RECONCILED']);
const SUPPORTED_SYSTEMS=Object.freeze(['ESOCIAL','EFD_REINF','DCTFWEB','FGTS_DIGITAL','NFE','NFSE','STATE','MUNICIPAL']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function createFiscalExecutionPolicy(i={}){
 for(const f of ['policyId','version','allowedSystems'])req(i[f],f);
 return Object.freeze({...i,featureEnabled:i.featureEnabled===true,realProviderEnabled:i.realProviderEnabled===true,allowedSystems:Object.freeze([...i.allowedSystems])});
}
function authorizeFiscalSubmission({envelope,policy,approval,preparedBy,now}={}){
 for(const [v,f] of [[envelope,'envelope'],[policy,'policy'],[approval,'approval'],[preparedBy,'preparedBy'],[now,'now']])req(v,f);
 const blockers=[];
 if(policy.featureEnabled!==true)blockers.push('FEATURE_DISABLED');
 if(policy.realProviderEnabled!==true)blockers.push('REAL_PROVIDER_DISABLED');
 if(!SUPPORTED_SYSTEMS.includes(envelope.system)||!policy.allowedSystems.includes(envelope.system))blockers.push('SYSTEM_NOT_ALLOWED');
 if(envelope.schemaValid!==true)blockers.push('SCHEMA_NOT_VALID');
 if(envelope.ruleEffective!==true)blockers.push('RULE_NOT_EFFECTIVE');
 if(envelope.businessValid!==true)blockers.push('BUSINESS_VALIDATION_FAILED');
 if(envelope.evidenceComplete!==true)blockers.push('EVIDENCE_INCOMPLETE');
 if(approval.status!=='APPROVED')blockers.push('APPROVAL_MISSING');
 if(approval.approvedBy===preparedBy)blockers.push('SEGREGATION_VIOLATION');
 if(Date.parse(now)>=Date.parse(envelope.expiresAt))blockers.push('ENVELOPE_EXPIRED');
 if(!envelope.idempotencyKey)blockers.push('IDEMPOTENCY_KEY_REQUIRED');
 return Object.freeze({state:blockers.length?'DISABLED':'AUTHORIZED',blockers:Object.freeze(blockers)});
}
function reserveFiscalIdempotency({idempotencyKey,existingKeys=[]}={}){
 req(idempotencyKey,'idempotencyKey');
 if(existingKeys.includes(idempotencyKey)){const e=new Error('DUPLICATE_FISCAL_SUBMISSION_DENIED');e.code='IDEMPOTENCY_CONFLICT';throw e;}
 return Object.freeze({idempotencyKey,reserved:true});
}
function createFiscalSubmission(i={}){
 for(const f of ['submissionId','obligationId','system','schemaVersion','ruleVersion','idempotencyKey','submittedAt'])req(i[f],f);
 return Object.freeze({...i,state:'SUBMITTED',accepted:false});
}
function recordProtocol(submission,response={}){
 req(submission,'submission');req(response.protocol,'protocol');
 return Object.freeze({...submission,state:response.processing===true?'PROCESSING':'SUBMITTED',protocol:response.protocol,receiptAt:response.receiptAt});
}
function recordOfficialFiscalResponse(submission,response={}){
 req(submission,'submission');req(response.status,'status');
 if(response.status==='ACCEPTED'){
  req(response.protocol,'protocol');
  return Object.freeze({...submission,state:'ACCEPTED',accepted:true,protocol:response.protocol,officialCode:response.officialCode,officialMessage:response.officialMessage});
 }
 if(response.status==='REJECTED'){
  req(response.officialCode,'officialCode');
  return Object.freeze({...submission,state:'REJECTED',accepted:false,officialCode:response.officialCode,officialMessage:response.officialMessage});
 }
 throw new Error('unsupported official fiscal response');
}
function reconcileFiscalSubmission({submission,officialObligationMatched,accounted}={}){
 if(submission?.state!=='ACCEPTED')throw new Error('OFFICIAL_ACCEPTANCE_REQUIRED');
 return Object.freeze({state:officialObligationMatched===true&&accounted===true?'RECONCILED':'ACCEPTED',officialObligationMatched:officialObligationMatched===true,accounted:accounted===true});
}
module.exports={FISCAL_GATEWAY_STATES,SUPPORTED_SYSTEMS,createFiscalExecutionPolicy,authorizeFiscalSubmission,reserveFiscalIdempotency,createFiscalSubmission,recordProtocol,recordOfficialFiscalResponse,reconcileFiscalSubmission};
