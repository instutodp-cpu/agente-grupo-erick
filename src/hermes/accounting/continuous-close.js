'use strict';

const CLOSE_STATES=Object.freeze([
 'OPEN','INGESTING','RECONCILING','EXCEPTIONS_PENDING','READY_FOR_REVIEW',
 'HUMAN_REVIEW','READY_TO_CLOSE','CLOSED','LOCKED'
]);

function required(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function createClosePeriod(i={}){
 for(const f of ['closePeriodId','tenantId','companyId','competence']) required(i[f],f);
 return Object.freeze({
  closePeriodId:i.closePeriodId,tenantId:i.tenantId,companyId:i.companyId,
  establishmentId:i.establishmentId??null,competence:i.competence,
  status:i.status??'OPEN',tasks:Object.freeze([...(i.tasks??[])]),
  blockers:Object.freeze([...(i.blockers??[])]),warnings:Object.freeze([...(i.warnings??[])]),
  reconciliationCoverageBps:i.reconciliationCoverageBps??0,
  evidenceCompletenessBps:i.evidenceCompletenessBps??0,
  unexplainedVarianceCents:i.unexplainedVarianceCents??0,
  unresolvedMaterialExceptions:i.unresolvedMaterialExceptions??0
 });
}
function readiness(close){
 const metrics=[close.reconciliationCoverageBps,close.evidenceCompletenessBps];
 metrics.forEach(v=>{if(!Number.isSafeInteger(v)||v<0||v>10000)throw new Error('readiness metric must be 0..10000 bps');});
 const scoreBps=Math.floor((metrics[0]+metrics[1])/2);
 const hardBlockers=[
  ...(close.blockers??[]),
  ...(close.unresolvedMaterialExceptions>0?['MATERIAL_EXCEPTIONS']:[]),
  ...(close.unexplainedVarianceCents!==0?['UNEXPLAINED_VARIANCE']:[])
 ];
 return Object.freeze({scoreBps,ready:hardBlockers.length===0&&scoreBps===10000,hardBlockers:Object.freeze(hardBlockers)});
}
function transitionClose(current,next,context={}){
 if(!CLOSE_STATES.includes(current)||!CLOSE_STATES.includes(next))throw new Error('unsupported close state');
 if(current==='LOCKED')throw new Error('LOCKED_PERIOD_REQUIRES_REOPEN_REQUEST');
 if(current==='CLOSED'&&next!=='LOCKED')throw new Error('CLOSED_PERIOD_REQUIRES_CONTROLLED_REOPEN');
 if(next==='READY_TO_CLOSE'&&context.humanReviewed!==true)throw new Error('HUMAN_REVIEW_REQUIRED');
 if(next==='CLOSED'&&(context.ready!==true||context.humanApproved!==true))throw new Error('CLOSE_APPROVAL_REQUIRED');
 return next;
}
function handleLateEvidence({periodStatus,evidenceId}){
 required(evidenceId,'evidenceId');
 if(['CLOSED','LOCKED'].includes(periodStatus)){
  return Object.freeze({action:'CREATE_REOPEN_REQUEST',evidenceId,mutateClosedPeriod:false});
 }
 return Object.freeze({action:'RECONCILE_CURRENT_PERIOD',evidenceId,mutateClosedPeriod:true});
}
function createReopenRequest(i={}){
 for(const f of ['requestId','closePeriodId','reason','requestedBy'])required(i[f],f);
 return Object.freeze({...i,status:'PENDING_HUMAN_APPROVAL'});
}
function assertSegregation({preparerId,reviewerId,approverId}){
 [preparerId,reviewerId,approverId].forEach((v,n)=>required(v,['preparerId','reviewerId','approverId'][n]));
 if(new Set([preparerId,reviewerId,approverId]).size!==3)throw new Error('SEGREGATION_OF_DUTIES_VIOLATION');
 return true;
}
function createClosePackage(i={}){
 for(const f of ['packageId','closePeriodId','createdAt','evidenceManifestHash'])required(i[f],f);
 return Object.freeze({...i,immutable:true});
}
module.exports={CLOSE_STATES,createClosePeriod,readiness,transitionClose,handleLateEvidence,createReopenRequest,assertSegregation,createClosePackage};
