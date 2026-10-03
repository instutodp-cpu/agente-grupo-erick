'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createGovernmentEvent,validateGovernmentEvent,assertFiscalSubmit,recordGovernmentResponse,createRectification,createTaxPaymentDocument,reconcileOfficialObligation}=require('../src/hermes/accounting/government-obligations');

test('government event is schema and rule versioned',()=>{
 const e=createGovernmentEvent({eventId:'e',tenantId:'t',companyId:'c',system:'ESOCIAL',eventType:'S-1200',competence:'2026-10',schemaVersion:'S-1.3',ruleVersion:'r'});
 assert.equal(e.state,'DRAFT');assert.equal(e.schemaVersion,'S-1.3');
});
test('pre-validation fails closed on missing dependency',()=>{
 const r=validateGovernmentEvent({schemaValid:true,businessRulesValid:true,dependenciesResolved:false,crossSourceMatched:true,evidenceComplete:true});
 assert.equal(r.state,'DRAFT');assert.ok(r.blockers.includes('dependenciesResolved'));
});
test('submission requires human approval',()=>{assert.throws(()=>assertFiscalSubmit(),e=>e.code==='APPROVAL_REQUIRED');});
test('submitted is not accepted and official rejection is preserved',()=>{
 assert.equal(recordGovernmentResponse({submitted:true}).state,'SUBMITTED');
 const r=recordGovernmentResponse({submitted:true,accepted:false,rejectionCode:'ERR-1',rejectionMessage:'invalid'});
 assert.equal(r.state,'REJECTED');assert.equal(r.rejection.code,'ERR-1');
});
test('rectification links versions and never overwrites original',()=>{
 const r=createRectification({rectificationId:'r',originalEventId:'e1',replacementEventId:'e2',reason:'source correction',requestedBy:'u'});
 assert.equal(r.overwritesOriginal,false);assert.equal(r.status,'PENDING_REVIEW');
});
test('tax payment document is distinct from tax obligation',()=>{
 const d=createTaxPaymentDocument({documentId:'d',documentType:'DARF',companyId:'c',competence:'2026-10',amountCents:10000,sourceSystem:'DCTFWEB'});
 assert.equal(d.state,'GUIDE_ISSUED');
});
test('true reconciliation requires official and bank/accounting chain',()=>{
 const r=reconcileOfficialObligation({expectedMatched:true,reportedMatched:true,assessedMatched:true,guideMatched:true,bankConfirmed:true,accounted:false});
 assert.equal(r.state,'NOT_RECONCILED');assert.ok(r.failedChecks.includes('accounted'));
 const ok=reconcileOfficialObligation({expectedMatched:true,reportedMatched:true,assessedMatched:true,guideMatched:true,bankConfirmed:true,accounted:true});
 assert.equal(ok.state,'RECONCILED');
});
