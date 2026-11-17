'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createGovernmentEvent,transitionGovernmentEvent,validateGovernmentEvent,
  assertFiscalSubmit,recordGovernmentResponse,createRectification,
  createTaxPaymentDocument,reconcileOfficialObligation
}=require('../src/hermes/accounting/government-obligations');

const scope={tenantId:'tenant-a',companyId:'company-a'};

test('government event is scoped and schema/rule versioned',()=>{
  const event=createGovernmentEvent({
    eventId:'event-1',...scope,system:'ESOCIAL',eventType:'S-1200',
    competence:'2026-10',schemaVersion:'S-1.3',ruleVersion:'rule-1',
    payloadHash:'sha256:synthetic',evidenceIds:['evidence-1']
  });
  assert.equal(event.state,'DRAFT');
  assert.equal(event.schemaVersion,'S-1.3');
  assert.equal(Object.isFrozen(event),true);
});

test('government lifecycle cannot skip stages',()=>{
  assert.equal(transitionGovernmentEvent('DRAFT','VALIDATED'),'VALIDATED');
  assert.throws(
    ()=>transitionGovernmentEvent('DRAFT','APPROVED'),
    error=>error.code==='EVENT_STATE_TRANSITION_NOT_ALLOWED'
  );
  assert.equal(transitionGovernmentEvent('PROCESSING','ACCEPTED'),'ACCEPTED');
});

test('pre-validation fails closed on missing dependency',()=>{
  const result=validateGovernmentEvent({
    schemaValid:true,businessRulesValid:true,dependenciesResolved:false,
    crossSourceMatched:true,evidenceComplete:true
  });
  assert.equal(result.state,'DRAFT');
  assert.ok(result.blockers.includes('DEPENDENCIES_UNRESOLVED'));
  assert.equal(validateGovernmentEvent({
    schemaValid:true,businessRulesValid:true,dependenciesResolved:true,
    crossSourceMatched:true,evidenceComplete:true
  }).state,'VALIDATED');
});

test('submission requires approved state and human approval',()=>{
  assert.throws(
    ()=>assertFiscalSubmit({state:'READY_FOR_REVIEW',humanApproved:true}),
    error=>error.code==='FISCAL_NOT_APPROVED'
  );
  assert.throws(
    ()=>assertFiscalSubmit({state:'APPROVED'}),
    error=>error.code==='APPROVAL_REQUIRED'
  );
  assert.equal(assertFiscalSubmit({state:'APPROVED',humanApproved:true}),true);
});

test('submitted is not accepted and official rejection is preserved',()=>{
  assert.equal(recordGovernmentResponse({submitted:false}).state,'READY_TO_SUBMIT');
  assert.equal(recordGovernmentResponse({submitted:true}).state,'SUBMITTED');
  const rejected=recordGovernmentResponse({
    submitted:true,accepted:false,rejectionCode:'ERR-SYNTH-1',rejectionMessage:'invalid'
  });
  assert.equal(rejected.state,'REJECTED');
  assert.equal(rejected.rejection.code,'ERR-SYNTH-1');
  assert.equal(rejected.simulationOnly,true);
  assert.throws(
    ()=>recordGovernmentResponse({submitted:true,accepted:false}),
    error=>error.code==='REQUIRED_FIELD'
  );
});

test('rectification links versions and never overwrites original',()=>{
  const result=createRectification({
    rectificationId:'rect-1',...scope,originalEventId:'event-1',
    replacementEventId:'event-2',reason:'synthetic source correction',requestedBy:'reviewer'
  });
  assert.equal(result.overwritesOriginal,false);
  assert.equal(result.status,'PENDING_REVIEW');
  assert.throws(
    ()=>createRectification({
      rectificationId:'bad',...scope,originalEventId:'event-1',
      replacementEventId:'event-1',reason:'bad',requestedBy:'reviewer'
    }),
    error=>error.code==='RECTIFICATION_VERSION_REQUIRED'
  );
});

test('payment document is distinct and starts as guide issued',()=>{
  const document=createTaxPaymentDocument({
    documentId:'doc-1',...scope,documentType:'DARF',
    competence:'2026-10',amountCents:10000,sourceSystem:'DCTFWEB'
  });
  assert.equal(document.state,'GUIDE_ISSUED');
  assert.throws(
    ()=>createTaxPaymentDocument({
      documentId:'bad',...scope,documentType:'DARF',
      competence:'2026-10',amountCents:10000,sourceSystem:'DCTFWEB',state:'PAID'
    }),
    error=>error.code==='PAYMENT_DOCUMENT_NOT_ISSUED'
  );
});

test('true reconciliation requires the full official and bank/accounting chain',()=>{
  const result=reconcileOfficialObligation({
    expectedMatched:true,reportedMatched:true,assessedMatched:true,
    guideMatched:true,bankConfirmed:true,accounted:false
  });
  assert.equal(result.state,'NOT_RECONCILED');
  assert.ok(result.failedChecks.includes('accounted'));
  const complete=reconcileOfficialObligation({
    expectedMatched:true,reportedMatched:true,assessedMatched:true,
    guideMatched:true,bankConfirmed:true,accounted:true
  });
  assert.equal(complete.state,'RECONCILED');
});
