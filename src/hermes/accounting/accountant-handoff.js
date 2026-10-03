'use strict';

const HANDOFF_STATES=Object.freeze(['DRAFT','READY_FOR_ACCOUNTANT','DELIVERED','UNDER_REVIEW','CHANGES_REQUESTED','ACCEPTED','SUPERSEDED']);
const CHANGE_STATES=Object.freeze(['OPEN','ANALYZING','APPROVED','REJECTED','APPLIED','CLOSED']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function createAccountantHandoff(i={}){
 for(const f of ['handoffId','tenantId','companyId','period','closePackageId','auditPackageId','evidenceManifestHash','version','createdAt'])req(i[f],f);
 const exceptions=Object.freeze([...(i.exceptionIds??[])]);
 const journals=Object.freeze([...(i.journalEntryIds??[])]);
 const obligations=Object.freeze([...(i.obligationIds??[])]);
 const evidence=Object.freeze([...(i.evidenceIds??[])]);
 return Object.freeze({...i,state:i.state??'DRAFT',exceptionIds:exceptions,journalEntryIds:journals,obligationIds:obligations,evidenceIds:evidence,immutable:true});
}
function assessHandoffReadiness(i={}){
 const blockers=[];
 if(i.closeStatus!=='CLOSED'&&i.closeStatus!=='READY_TO_CLOSE')blockers.push('CLOSE_NOT_READY');
 if(i.auditStatus!=='PASS')blockers.push('AUDIT_NOT_PASS');
 if(i.evidenceComplete!==true)blockers.push('EVIDENCE_INCOMPLETE');
 if(i.unresolvedCriticalExceptions>0)blockers.push('CRITICAL_EXCEPTIONS_OPEN');
 return Object.freeze({state:blockers.length?'DRAFT':'READY_FOR_ACCOUNTANT',blockers:Object.freeze(blockers)});
}
function createAccountantChangeRequest(i={}){
 for(const f of ['changeRequestId','handoffId','requestedBy','requestedAt','reason','targetType','targetId'])req(i[f],f);
 return Object.freeze({...i,state:'OPEN',requiresEvidence:true,mutatesClosedPeriod:false});
}
function applyAccountantChange({request,humanApproved=false,newVersionId,evidenceIds=[]}={}){
 req(request,'request');req(newVersionId,'newVersionId');
 if(humanApproved!==true){const e=new Error('ACCOUNTANT_CHANGE_REQUIRES_APPROVAL');e.code='APPROVAL_REQUIRED';throw e;}
 if(evidenceIds.length===0){const e=new Error('ACCOUNTANT_CHANGE_REQUIRES_EVIDENCE');e.code='EVIDENCE_REQUIRED';throw e;}
 return Object.freeze({changeRequestId:request.changeRequestId,state:'APPLIED',newVersionId,evidenceIds:Object.freeze([...evidenceIds]),overwritesPrevious:false});
}
function transitionHandoff(current,next){
 const allowed={
  DRAFT:['READY_FOR_ACCOUNTANT'],READY_FOR_ACCOUNTANT:['DELIVERED'],DELIVERED:['UNDER_REVIEW'],
  UNDER_REVIEW:['CHANGES_REQUESTED','ACCEPTED'],CHANGES_REQUESTED:['UNDER_REVIEW'],ACCEPTED:['SUPERSEDED'],SUPERSEDED:[]
 };
 if(!(allowed[current]??[]).includes(next))throw new Error('HANDOFF_TRANSITION_NOT_ALLOWED');
 return next;
}
function createAccountantComment(i={}){
 for(const f of ['commentId','handoffId','authorId','createdAt','text'])req(i[f],f);
 return Object.freeze({...i,evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
module.exports={HANDOFF_STATES,CHANGE_STATES,createAccountantHandoff,assessHandoffReadiness,createAccountantChangeRequest,applyAccountantChange,transitionHandoff,createAccountantComment};
