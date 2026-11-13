'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

const {createCanonicalRecord}=require('../src/hermes/accounting/canonical-model');
const {createEvidence}=require('../src/hermes/accounting/evidence-ledger');
const {reconcileAmounts}=require('../src/hermes/accounting/reconciliation-engine');
const {createJournalEntry,assertPostable,assertNoBalancingPlug}=require('../src/hermes/accounting/journal-subledger');
const {createClosePeriod,readiness,transitionClose,createClosePackage}=require('../src/hermes/accounting/continuous-close');
const {createAuditEngagement,completenessTest,createInternalAuditPackage}=require('../src/hermes/accounting/independent-auditor');
const {createAccountantHandoff,assessHandoffReadiness}=require('../src/hermes/accounting/accountant-handoff');
const {assertFiscalSubmit}=require('../src/hermes/accounting/government-obligations');
const {adversarialAction}=require('../src/hermes/accounting/ground-truth-evaluation');

test('C0-C18 happy path reaches accountant handoff only after reconciliation close and independent audit',()=>{
 const sale=createCanonicalRecord({entityType:'Sale',id:'sale-1',tenantId:'t',companyId:'c',establishmentId:'store-1',sourceSystem:'seta',sourceReference:'sale-1',occurredAt:'2026-10-01',evidenceIds:['ev-sale']});
 const ev=createEvidence({evidenceId:'ev-sale',tenantId:'t',companyId:'c',sourceSystem:'seta',sourceType:'SALE',sourceReference:'sale-1',documentType:'SALE',occurredAt:'2026-10-01',receivedAt:'2026-10-01',schemaVersion:'1'});
 assert.equal(sale.evidenceIds[0],ev.evidenceId);

 const rec=reconcileAmounts({expectedAmountsCents:[10000],observedAmountsCents:[10000],method:'SALE_BANK',level:0,deterministicPassed:true,evidenceIds:['ev-sale']});
 assert.equal(rec.status,'MATCHED');

 const journal=createJournalEntry({journalEntryId:'j1',tenantId:'t',companyId:'c',occurredAt:'2026-10-01',accountingRuleId:'sale',accountingRuleVersion:'1',chartOfAccountsVersion:'1',sourceFactIds:['sale-1'],evidenceIds:['ev-sale'],lines:[
  {lineId:'l1',accountCode:'cash',side:'DEBIT',amountCents:10000,evidenceIds:['ev-sale']},
  {lineId:'l2',accountCode:'revenue',side:'CREDIT',amountCents:10000,evidenceIds:['ev-sale']}
 ]});
 assert.equal(journal.balance.balanced,true);
 assert.equal(assertPostable(journal,{humanApproved:true}),true);

 const close=createClosePeriod({closePeriodId:'close-1',tenantId:'t',companyId:'c',competence:'2026-10',reconciliationCoverageBps:10000,evidenceCompletenessBps:10000,unexplainedVarianceCents:0,unresolvedMaterialExceptions:0});
 const ready=readiness(close);assert.equal(ready.ready,true);
 assert.equal(transitionClose(close,'READY_TO_CLOSE',{humanReviewed:true}).state,'READY_TO_CLOSE');
 const closePackage=createClosePackage({packageId:'cp1',closePeriodId:'close-1',createdAt:'2026-11-01',evidenceManifestHash:'hash'});

 createAuditEngagement({engagementId:'audit-1',tenantId:'t',companyId:'c',period:'2026-10',preparedBy:'prep',auditApprovedBy:'auditor'});
 assert.equal(completenessTest({sourceIds:['sale-1'],ledgerIds:['sale-1']}).pass,true);
 const auditPackage=createInternalAuditPackage({packageId:'ap1',engagementId:'audit-1',createdAt:'2026-11-01',evidenceManifestHash:closePackage.evidenceManifestHash,findings:[]});
 assert.equal(auditPackage.status,'PASS');

 const gate=assessHandoffReadiness({closeStatus:'CLOSED',auditStatus:auditPackage.status,evidenceComplete:true,unresolvedCriticalExceptions:0});
 assert.equal(gate.state,'READY_FOR_ACCOUNTANT');
 const handoff=createAccountantHandoff({handoffId:'h1',tenantId:'t',companyId:'c',period:'2026-10',closePackageId:'cp1',auditPackageId:'ap1',evidenceManifestHash:'hash',version:'1',createdAt:'2026-11-01',journalEntryIds:['j1'],evidenceIds:['ev-sale'],state:gate.state});
 assert.equal(handoff.state,'READY_FOR_ACCOUNTANT');
});

test('C0-C18 adversarial gate denies unsafe effects and unsupported balancing',()=>{
 assert.throws(()=>assertFiscalSubmit(),e=>e.code==='APPROVAL_REQUIRED');
 assert.equal(adversarialAction({action:'PAYMENT_EXECUTE'}).decision,'DENIED');
 assert.equal(adversarialAction({action:'IGNORE_DOCUMENT'}).decision,'NEEDS_EVIDENCE');
 assert.throws(()=>assertNoBalancingPlug({purpose:'MAKE_IT_BALANCE'}),e=>e.code==='DENIED');
});

test('C0-C18 cannot hand off when independent audit has exceptions',()=>{
 const gate=assessHandoffReadiness({closeStatus:'CLOSED',auditStatus:'EXCEPTIONS',evidenceComplete:true,unresolvedCriticalExceptions:1});
 assert.equal(gate.state,'DRAFT');
 assert.ok(gate.blockers.includes('AUDIT_NOT_PASS'));
 assert.ok(gate.blockers.includes('CRITICAL_EXCEPTIONS_OPEN'));
});
