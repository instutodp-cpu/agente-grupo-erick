'use strict';

const CAPABILITIES=Object.freeze(['FINANCIAL_EXECUTION','FISCAL_SUBMISSION']);
const ATTEMPT_STATES=Object.freeze(['RESERVED','RUNNING','SUCCEEDED','FAILED','RECONCILED']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function createCapabilityFlag(i={}){
 for(const f of ['tenantId','capability','version','updatedBy','updatedAt'])req(i[f],f);
 if(!CAPABILITIES.includes(i.capability))throw new Error('unsupported capability');
 return Object.freeze({...i,enabled:i.enabled===true,realProviderEnabled:i.realProviderEnabled===true});
}
function assertCapabilityEnabled(flag){
 if(flag?.enabled!==true||flag?.realProviderEnabled!==true){const e=new Error('OPERATIONAL_CAPABILITY_DISABLED');e.code='CAPABILITY_DISABLED';throw e;}
 return true;
}
function createExecutionReservation(i={}){
 for(const f of ['tenantId','capability','idempotencyKey','operationId','ownerId','leaseUntil','createdAt'])req(i[f],f);
 if(!CAPABILITIES.includes(i.capability))throw new Error('unsupported capability');
 return Object.freeze({...i,state:'RESERVED'});
}
function reserveExecution({candidate,existingReservations=[],now}={}){
 req(candidate,'candidate');req(now,'now');
 const conflict=existingReservations.find(r=>r.tenantId===candidate.tenantId&&r.capability===candidate.capability&&r.idempotencyKey===candidate.idempotencyKey);
 if(conflict){const e=new Error('IDEMPOTENCY_RESERVATION_CONFLICT');e.code='CONFLICT';throw e;}
 return createExecutionReservation(candidate);
}
function acquireLease({reservation,ownerId,now,newLeaseUntil}={}){
 for(const [v,f] of [[reservation,'reservation'],[ownerId,'ownerId'],[now,'now'],[newLeaseUntil,'newLeaseUntil']])req(v,f);
 if(reservation.ownerId!==ownerId&&Date.parse(reservation.leaseUntil)>Date.parse(now)){const e=new Error('EXECUTION_LEASE_HELD');e.code='LOCKED';throw e;}
 return Object.freeze({...reservation,ownerId,leaseUntil:newLeaseUntil,state:'RUNNING'});
}
function createExecutionAttempt(i={}){
 for(const f of ['attemptId','tenantId','capability','operationId','idempotencyKey','startedAt'])req(i[f],f);
 return Object.freeze({...i,state:i.state??'RUNNING',auditRequired:true});
}
function completeExecutionAttempt(attempt,{success,completedAt,providerReference,failureCode}={}){
 req(attempt,'attempt');req(completedAt,'completedAt');
 if(success===true)return Object.freeze({...attempt,state:'SUCCEEDED',completedAt,providerReference});
 return Object.freeze({...attempt,state:'FAILED',completedAt,failureCode:failureCode??'UNKNOWN_FAILURE'});
}
function assertTenantIsolation({flag,reservation}={}){
 if(flag?.tenantId!==reservation?.tenantId){const e=new Error('TENANT_BOUNDARY_VIOLATION');e.code='DENIED';throw e;}
 return true;
}
module.exports={CAPABILITIES,ATTEMPT_STATES,createCapabilityFlag,assertCapabilityEnabled,createExecutionReservation,reserveExecution,acquireLease,createExecutionAttempt,completeExecutionAttempt,assertTenantIsolation};
