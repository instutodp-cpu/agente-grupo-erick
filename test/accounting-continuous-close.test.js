'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createClosePeriod,readiness,transitionClose,handleLateEvidence,createReopenRequest,assertSegregation,createClosePackage}=require('../src/hermes/accounting/continuous-close');

test('perfect score cannot override a blocker',()=>{
 const c=createClosePeriod({closePeriodId:'c',tenantId:'t',companyId:'co',competence:'2026-10',reconciliationCoverageBps:10000,evidenceCompletenessBps:10000,blockers:['BANK_NOT_RECONCILED']});
 const r=readiness(c);assert.equal(r.scoreBps,10000);assert.equal(r.ready,false);
});
test('material exception and unexplained cent block close',()=>{
 const c=createClosePeriod({closePeriodId:'c',tenantId:'t',companyId:'co',competence:'2026-10',reconciliationCoverageBps:10000,evidenceCompletenessBps:10000,unexplainedVarianceCents:1,unresolvedMaterialExceptions:1});
 const r=readiness(c);assert.equal(r.ready,false);assert.ok(r.hardBlockers.includes('UNEXPLAINED_VARIANCE'));
});
test('human review and approval gate final close',()=>{
 assert.throws(()=>transitionClose('HUMAN_REVIEW','READY_TO_CLOSE',{}),/HUMAN_REVIEW_REQUIRED/);
 assert.equal(transitionClose('HUMAN_REVIEW','READY_TO_CLOSE',{humanReviewed:true}),'READY_TO_CLOSE');
 assert.throws(()=>transitionClose('READY_TO_CLOSE','CLOSED',{ready:true}),/CLOSE_APPROVAL_REQUIRED/);
 assert.equal(transitionClose('READY_TO_CLOSE','CLOSED',{ready:true,humanApproved:true}),'CLOSED');
});
test('late evidence never silently mutates closed period',()=>{
 const x=handleLateEvidence({periodStatus:'CLOSED',evidenceId:'ev1'});
 assert.equal(x.action,'CREATE_REOPEN_REQUEST');assert.equal(x.mutateClosedPeriod,false);
});
test('reopen request requires human approval',()=>{
 assert.equal(createReopenRequest({requestId:'r',closePeriodId:'c',reason:'late evidence',requestedBy:'u'}).status,'PENDING_HUMAN_APPROVAL');
});
test('preparer reviewer and approver must differ',()=>{
 assert.equal(assertSegregation({preparerId:'a',reviewerId:'b',approverId:'c'}),true);
 assert.throws(()=>assertSegregation({preparerId:'a',reviewerId:'a',approverId:'c'}),/SEGREGATION/);
});
test('close package is immutable attestation input',()=>{
 const p=createClosePackage({packageId:'p',closePeriodId:'c',createdAt:'2026-10-02',evidenceManifestHash:'abc'});
 assert.equal(p.immutable,true);assert.ok(Object.isFrozen(p));
});
