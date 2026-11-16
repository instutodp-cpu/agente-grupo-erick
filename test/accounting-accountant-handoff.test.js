'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createAccountantHandoff,assessHandoffReadiness,createAccountantChangeRequest,
  applyAccountantChange,transitionHandoff,createAccountantComment
}=require('../src/hermes/accounting/accountant-handoff');

const scope={tenantId:'tenant-a',companyId:'company-a'};
const now='2026-10-02T12:00:00Z';

test('handoff package binds close audit journals obligations and evidence',()=>{
  const handoff=createAccountantHandoff({
    handoffId:'handoff-1',...scope,period:'2026-10',
    closePackageId:'close-1',auditPackageId:'audit-1',
    evidenceManifestHash:'hash-1',version:'1',createdAt:now,
    journalEntryIds:['journal-1'],obligationIds:['obligation-1'],
    exceptionIds:['exception-1'],evidenceIds:['evidence-1']
  });
  assert.equal(handoff.state,'DRAFT');
  assert.equal(handoff.immutable,true);
  assert.equal(Object.isFrozen(handoff),true);
  assert.throws(
    ()=>createAccountantHandoff({
      ...handoff,period:'2026-13',createdAt:now
    }),
    error=>error.code==='INVALID_COMPETENCE'
  );
});

test('handoff readiness fails closed without audit pass or evidence',()=>{
  const result=assessHandoffReadiness({
    closeStatus:'CLOSED',auditStatus:'EXCEPTIONS',
    evidenceComplete:true,unresolvedCriticalExceptions:0
  });
  assert.equal(result.state,'DRAFT');
  assert.ok(result.blockers.includes('AUDIT_NOT_PASS'));
});

test('clean package becomes ready for accountant',()=>{
  const result=assessHandoffReadiness({
    closeStatus:'CLOSED',auditStatus:'PASS',
    evidenceComplete:true,unresolvedCriticalExceptions:0
  });
  assert.equal(result.state,'READY_FOR_ACCOUNTANT');
});

test('accountant change request never mutates closed period directly',()=>{
  const request=createAccountantChangeRequest({
    changeRequestId:'change-1',handoffId:'handoff-1',
    requestedBy:'accountant',requestedAt:now,reason:'reclassify',
    targetType:'JOURNAL',targetId:'journal-1'
  });
  assert.equal(request.mutatesClosedPeriod,false);
  assert.equal(request.requiresEvidence,true);
});

test('applying accountant change requires approval evidence and new version',()=>{
  const request=createAccountantChangeRequest({
    changeRequestId:'change-1',handoffId:'handoff-1',
    requestedBy:'accountant',requestedAt:now,reason:'fix',
    targetType:'JOURNAL',targetId:'journal-1'
  });
  assert.throws(
    ()=>applyAccountantChange({request,humanApproved:true,newVersionId:'journal-2'}),
    error=>error.code==='EVIDENCE_REQUIRED'
  );
  assert.throws(
    ()=>applyAccountantChange({request,humanApproved:true,newVersionId:'journal-1',evidenceIds:['evidence-1']}),
    error=>error.code==='NEW_VERSION_REQUIRED'
  );
  const applied=applyAccountantChange({
    request,humanApproved:true,newVersionId:'journal-2',evidenceIds:['evidence-1']
  });
  assert.equal(applied.overwritesPrevious,false);
  assert.equal(applied.state,'APPLIED');
});

test('handoff lifecycle prevents silent skipping',()=>{
  assert.equal(transitionHandoff('DRAFT','READY_FOR_ACCOUNTANT'),'READY_FOR_ACCOUNTANT');
  assert.throws(
    ()=>transitionHandoff('DRAFT','ACCEPTED'),
    error=>error.code==='HANDOFF_TRANSITION_NOT_ALLOWED'
  );
});

test('accountant comments are traceable records',()=>{
  const comment=createAccountantComment({
    commentId:'comment-1',handoffId:'handoff-1',authorId:'accountant',
    createdAt:now,text:'review item',evidenceIds:['evidence-1']
  });
  assert.equal(comment.evidenceIds.length,1);
  assert.throws(
    ()=>createAccountantComment({
      commentId:'bad',handoffId:'handoff-1',authorId:'accountant',
      createdAt:'now',text:'invalid',evidenceIds:[]
    }),
    error=>error.code==='INVALID_INSTANT'
  );
});
