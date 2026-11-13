'use strict';

const PAYMENT_STATES=Object.freeze(['DRAFT','VALIDATING','READY_FOR_REVIEW','APPROVED','READY_TO_EXECUTE','EXECUTED','FAILED','RECONCILED']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function cents(v,f){if(!Number.isSafeInteger(v)||v<=0)throw new Error(`${f} must be a positive safe integer`);}
function createPaymentInstruction(i={}){
 for(const f of ['instructionId','tenantId','companyId','obligationId','beneficiaryId','amountCents','dueDate','destinationAccountRef','createdBy'])req(i[f],f);
 cents(i.amountCents,'amountCents');
 return Object.freeze({...i,state:'DRAFT',authority:'PREPARE',evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
function validatePaymentInstruction(i={}){
 const blockers=[];
 if(i.obligationMatched!==true)blockers.push('OBLIGATION_NOT_MATCHED');
 if(i.amountMatched!==true)blockers.push('AMOUNT_NOT_MATCHED');
 if(i.beneficiaryVerified!==true)blockers.push('BENEFICIARY_NOT_VERIFIED');
 if(i.destinationVerified!==true)blockers.push('DESTINATION_NOT_VERIFIED');
 if(i.duplicateCheckPassed!==true)blockers.push('DUPLICATE_RISK');
 if(i.evidenceComplete!==true)blockers.push('EVIDENCE_INCOMPLETE');
 if(i.dueDateValid!==true)blockers.push('DUE_DATE_INVALID');
 return Object.freeze({state:blockers.length?'VALIDATING':'READY_FOR_REVIEW',blockers:Object.freeze(blockers)});
}
function paymentIdentity(i={}){
 for(const f of ['companyId','obligationId','beneficiaryId','amountCents','dueDate','destinationAccountRef'])req(i[f],f);
 return [i.companyId,i.obligationId,i.beneficiaryId,i.amountCents,i.dueDate,i.destinationAccountRef].join('|');
}
function detectDuplicatePayment(candidate,existing=[]){
 const id=paymentIdentity(candidate);
 return Object.freeze({duplicate:existing.some(x=>paymentIdentity(x)===id),identity:id});
}
function createPaymentApproval(i={}){
 for(const f of ['approvalId','instructionId','preparedBy','approvedBy','approvedAt'])req(i[f],f);
 if(i.preparedBy===i.approvedBy)throw new Error('PAYMENT_SEGREGATION_OF_DUTIES_VIOLATION');
 return Object.freeze({...i,status:'APPROVED'});
}
function assertPaymentExecution(){
 const e=new Error('PAYMENT_EXECUTION_CAPABILITY_NOT_GRANTED_IN_C20');e.code='CAPABILITY_NOT_GRANTED';throw e;
}
function createExecutionEnvelope(i={}){
 for(const f of ['instructionId','approvalId','idempotencyKey','expiresAt'])req(i[f],f);
 return Object.freeze({...i,state:'READY_TO_EXECUTE',executionAuthorityGranted:false});
}
module.exports={PAYMENT_STATES,createPaymentInstruction,validatePaymentInstruction,paymentIdentity,detectDuplicatePayment,createPaymentApproval,assertPaymentExecution,createExecutionEnvelope};
