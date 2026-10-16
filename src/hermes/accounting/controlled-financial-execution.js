'use strict';

const EXECUTION_STATES=Object.freeze(['DISABLED','VALIDATING','AUTHORIZED','SUBMITTING','SUBMITTED','CONFIRMED','FAILED','RECONCILED']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function createExecutionPolicy(i={}){
 for(const f of ['policyId','version','maxAmountCents','allowedDestinationRefs'])req(i[f],f);
 if(!Number.isSafeInteger(i.maxAmountCents)||i.maxAmountCents<=0)throw new Error('maxAmountCents must be positive safe integer');
 return Object.freeze({...i,featureEnabled:i.featureEnabled===true,realProviderEnabled:i.realProviderEnabled===true,allowedDestinationRefs:Object.freeze([...i.allowedDestinationRefs])});
}
function authorizeExecution({envelope,policy,now,approval,preparedBy}={}){
 req(envelope,'envelope');req(policy,'policy');req(now,'now');req(approval,'approval');req(preparedBy,'preparedBy');
 const blockers=[];
 if(policy.featureEnabled!==true)blockers.push('FEATURE_DISABLED');
 if(policy.realProviderEnabled!==true)blockers.push('REAL_PROVIDER_DISABLED');
 if(approval.status!=='APPROVED')blockers.push('APPROVAL_MISSING');
 if(approval.approvedBy===preparedBy)blockers.push('SEGREGATION_VIOLATION');
 if(Date.parse(now)>=Date.parse(envelope.expiresAt))blockers.push('ENVELOPE_EXPIRED');
 if(!policy.allowedDestinationRefs.includes(envelope.destinationAccountRef))blockers.push('DESTINATION_NOT_ALLOWLISTED');
 if(!Number.isSafeInteger(envelope.amountCents)||envelope.amountCents<=0||envelope.amountCents>policy.maxAmountCents)blockers.push('AMOUNT_OUT_OF_POLICY');
 if(!envelope.idempotencyKey)blockers.push('IDEMPOTENCY_KEY_REQUIRED');
 return Object.freeze({state:blockers.length?'DISABLED':'AUTHORIZED',blockers:Object.freeze(blockers)});
}
function reserveIdempotency({idempotencyKey,existingKeys=[]}={}){
 req(idempotencyKey,'idempotencyKey');
 if(existingKeys.includes(idempotencyKey)){const e=new Error('DUPLICATE_EXECUTION_DENIED');e.code='IDEMPOTENCY_CONFLICT';throw e;}
 return Object.freeze({idempotencyKey,reserved:true});
}
function createProviderSubmission(i={}){
 for(const f of ['executionId','instructionId','provider','idempotencyKey','submittedAt'])req(i[f],f);
 return Object.freeze({...i,state:'SUBMITTED',providerConfirmed:false});
}
function recordProviderConfirmation(submission,response={}){
 req(submission,'submission');req(response.providerReference,'providerReference');
 if(response.confirmed!==true)return Object.freeze({...submission,state:'FAILED',providerConfirmed:false,failureCode:response.failureCode??'UNCONFIRMED'});
 return Object.freeze({...submission,state:'CONFIRMED',providerConfirmed:true,providerReference:response.providerReference,confirmedAt:response.confirmedAt});
}
function reconcileExecution({submission,bankTransactionId,amountMatched,destinationMatched}={}){
 if(submission?.state!=='CONFIRMED')throw new Error('PROVIDER_CONFIRMATION_REQUIRED');
 req(bankTransactionId,'bankTransactionId');
 const pass=amountMatched===true&&destinationMatched===true;
 return Object.freeze({state:pass?'RECONCILED':'FAILED',bankTransactionId,amountMatched:amountMatched===true,destinationMatched:destinationMatched===true});
}
module.exports={EXECUTION_STATES,createExecutionPolicy,authorizeExecution,reserveIdempotency,createProviderSubmission,recordProviderConfirmation,reconcileExecution};
