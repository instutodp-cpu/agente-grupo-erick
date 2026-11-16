'use strict';

const HANDOFF_STATES=Object.freeze([
  'DRAFT','READY_FOR_ACCOUNTANT','DELIVERED','UNDER_REVIEW',
  'CHANGES_REQUESTED','ACCEPTED','SUPERSEDED'
]);
const CHANGE_STATES=Object.freeze(['OPEN','ANALYZING','APPROVED','REJECTED','APPLIED','CLOSED']);
const COMPETENCE_RE=/^\d{4}-(0[1-9]|1[0-2])$/;
const INSTANT_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const TRANSITIONS=Object.freeze({
  DRAFT:'READY_FOR_ACCOUNTANT',
  READY_FOR_ACCOUNTANT:'DELIVERED',
  DELIVERED:'UNDER_REVIEW',
  UNDER_REVIEW:'CHANGES_REQUESTED',
  CHANGES_REQUESTED:'UNDER_REVIEW',
  ACCEPTED:'SUPERSEDED',
  SUPERSEDED:null
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
    throw failure('INVALID_COMPETENCE','period must be YYYY-MM');
  return value;
}
function strictInstant(value,field){
  if(typeof value!=='string'||!INSTANT_RE.test(value))
    throw failure('INVALID_INSTANT',field+' must be an ISO UTC instant');
  if(Number.isNaN(new Date(value).getTime()))throw failure('INVALID_INSTANT',field+' is invalid');
  return value;
}
function nonNegativeInteger(value,field){
  if(!Number.isSafeInteger(value)||value<0)throw failure('INVALID_COUNT',field+' must be a non-negative safe integer');
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
function createAccountantHandoff(input={}){
  const handoffId=requiredString(input.handoffId,'handoffId');
  const tenantId=requiredString(input.tenantId,'tenantId');
  const companyId=requiredString(input.companyId,'companyId');
  const period=strictCompetence(input.period);
  const closePackageId=requiredString(input.closePackageId,'closePackageId');
  const auditPackageId=requiredString(input.auditPackageId,'auditPackageId');
  const evidenceManifestHash=requiredString(input.evidenceManifestHash,'evidenceManifestHash');
  const version=requiredString(input.version,'version');
  const createdAt=strictInstant(input.createdAt,'createdAt');
  const exceptionIds=uniqueStrings(input.exceptionIds,'exceptionIds');
  const journalEntryIds=uniqueStrings(input.journalEntryIds,'journalEntryIds');
  const obligationIds=uniqueStrings(input.obligationIds,'obligationIds');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({
    ...input,handoffId,tenantId,companyId,period,closePackageId,auditPackageId,
    evidenceManifestHash,version,createdAt,state:'DRAFT',exceptionIds,
    journalEntryIds,obligationIds,evidenceIds,immutable:true
  });
}
function assessHandoffReadiness(input={}){
  const blockers=[];
  if(input.closeStatus!=='CLOSED'&&input.closeStatus!=='READY_TO_CLOSE')
    blockers.push('CLOSE_NOT_READY');
  if(input.auditStatus!=='PASS')blockers.push('AUDIT_NOT_PASS');
  if(input.evidenceComplete!==true)blockers.push('EVIDENCE_INCOMPLETE');
  const unresolved=nonNegativeInteger(input.unresolvedCriticalExceptions??0,'unresolvedCriticalExceptions');
  if(unresolved>0)blockers.push('CRITICAL_EXCEPTIONS_OPEN');
  return deepFreeze({
    state:blockers.length?'DRAFT':'READY_FOR_ACCOUNTANT',
    blockers
  });
}
function createAccountantChangeRequest(input={}){
  const changeRequestId=requiredString(input.changeRequestId,'changeRequestId');
  const handoffId=requiredString(input.handoffId,'handoffId');
  const requestedBy=requiredString(input.requestedBy,'requestedBy');
  const requestedAt=strictInstant(input.requestedAt,'requestedAt');
  const reason=requiredString(input.reason,'reason');
  const targetType=requiredString(input.targetType,'targetType');
  const targetId=requiredString(input.targetId,'targetId');
  return deepFreeze({
    ...input,changeRequestId,handoffId,requestedBy,requestedAt,reason,
    targetType,targetId,state:'OPEN',requiresEvidence:true,mutatesClosedPeriod:false
  });
}
function applyAccountantChange(input={}){
  const request=input.request;
  if(!request||typeof request!=='object')throw failure('REQUIRED_FIELD','request is required');
  const newVersionId=requiredString(input.newVersionId,'newVersionId');
  if(newVersionId===request.targetId)throw failure('NEW_VERSION_REQUIRED','change must create a new version');
  if(request.state!=='OPEN'&&request.state!=='APPROVED')
    throw failure('CHANGE_NOT_OPEN','change request is not applicable');
  if(input.humanApproved!==true)throw failure('APPROVAL_REQUIRED','accountant change requires approval');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  if(evidenceIds.length===0)throw failure('EVIDENCE_REQUIRED','accountant change requires evidence');
  return deepFreeze({
    changeRequestId:request.changeRequestId,state:'APPLIED',newVersionId,
    evidenceIds,overwritesPrevious:false
  });
}
function transitionHandoff(current,next){
  if(!HANDOFF_STATES.includes(current)||!HANDOFF_STATES.includes(next)||
     TRANSITIONS[current]!==next)
    throw failure('HANDOFF_TRANSITION_NOT_ALLOWED','handoff transition is not allowed');
  return next;
}
function createAccountantComment(input={}){
  const commentId=requiredString(input.commentId,'commentId');
  const handoffId=requiredString(input.handoffId,'handoffId');
  const authorId=requiredString(input.authorId,'authorId');
  const createdAt=strictInstant(input.createdAt,'createdAt');
  const text=requiredString(input.text,'text');
  const evidenceIds=uniqueStrings(input.evidenceIds,'evidenceIds');
  return deepFreeze({commentId,handoffId,authorId,createdAt,text,evidenceIds});
}
module.exports={
  HANDOFF_STATES,CHANGE_STATES,createAccountantHandoff,assessHandoffReadiness,
  createAccountantChangeRequest,applyAccountantChange,transitionHandoff,
  createAccountantComment
};
