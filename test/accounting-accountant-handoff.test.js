'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createAccountantHandoff,assessHandoffReadiness,createAccountantChangeRequest,applyAccountantChange,transitionHandoff,createAccountantComment}=require('../src/hermes/accounting/accountant-handoff');

test('handoff package binds close audit evidence journals obligations and exceptions',()=>{
 const h=createAccountantHandoff({handoffId:'h',tenantId:'t',companyId:'c',period:'2026-10',closePackageId:'close',auditPackageId:'audit',evidenceManifestHash:'hash',version:'1',createdAt:'now',journalEntryIds:['j'],obligationIds:['o'],exceptionIds:['x'],evidenceIds:['e']});
 assert.equal(h.immutable,true);assert.equal(h.journalEntryIds[0],'j');
});
test('handoff readiness fails closed without audit pass or evidence',()=>{
 const r=assessHandoffReadiness({closeStatus:'CLOSED',auditStatus:'EXCEPTIONS',evidenceComplete:true,unresolvedCriticalExceptions:0});
 assert.equal(r.state,'DRAFT');assert.ok(r.blockers.includes('AUDIT_NOT_PASS'));
});
test('clean package becomes ready for accountant',()=>{
 const r=assessHandoffReadiness({closeStatus:'CLOSED',auditStatus:'PASS',evidenceComplete:true,unresolvedCriticalExceptions:0});
 assert.equal(r.state,'READY_FOR_ACCOUNTANT');
});
test('accountant change request never mutates closed period directly',()=>{
 const r=createAccountantChangeRequest({changeRequestId:'r',handoffId:'h',requestedBy:'accountant',requestedAt:'now',reason:'reclassify',targetType:'JOURNAL',targetId:'j'});
 assert.equal(r.mutatesClosedPeriod,false);assert.equal(r.requiresEvidence,true);
});
test('applying accountant change requires approval evidence and creates new version',()=>{
 const request=createAccountantChangeRequest({changeRequestId:'r',handoffId:'h',requestedBy:'a',requestedAt:'now',reason:'fix',targetType:'JOURNAL',targetId:'j'});
 assert.throws(()=>applyAccountantChange({request,humanApproved:true,newVersionId:'j2'}),e=>e.code==='EVIDENCE_REQUIRED');
 const a=applyAccountantChange({request,humanApproved:true,newVersionId:'j2',evidenceIds:['e']});assert.equal(a.overwritesPrevious,false);
});
test('handoff lifecycle prevents silent skipping',()=>{
 assert.equal(transitionHandoff('DRAFT','READY_FOR_ACCOUNTANT'),'READY_FOR_ACCOUNTANT');
 assert.throws(()=>transitionHandoff('DRAFT','ACCEPTED'),/NOT_ALLOWED/);
});
test('accountant comments are traceable records',()=>{
 const c=createAccountantComment({commentId:'c',handoffId:'h',authorId:'a',createdAt:'now',text:'review item',evidenceIds:['e']});assert.equal(c.evidenceIds.length,1);
});
