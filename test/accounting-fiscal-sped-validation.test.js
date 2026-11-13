'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createFiscalRule,validateRuleEffective,validateFiscalClassification,crossCheckFiscal,assessFiscalReadiness,assertFiscalSubmit,recordSubmissionResult}=require('../src/hermes/accounting/fiscal-sped-validation');
const rule=createFiscalRule({ruleId:'r',version:'1',authority:'SEFAZ',officialSource:'official',effectiveFrom:'2026-01-01',schemaHash:'abc'});
test('official temporal rule is required and expiry fails closed',()=>{
 assert.equal(validateRuleEffective(rule,'2026-10-02'),true);
 assert.throws(()=>validateRuleEffective({...rule,effectiveUntil:'2026-09-30'},'2026-10-02'),e=>e.code==='RULE_NOT_EFFECTIVE');
});
test('valid XML does not imply correct tax classification',()=>{
 const r=validateFiscalClassification({documentValidity:'VALID',rule,occurredAt:'2026-10-02',requiredFields:['cfop','ncm'],classification:{cfop:'5102'}});
 assert.equal(r.status,'BLOCKED');assert.ok(r.issues.includes('MISSING_NCM'));
});
test('fiscal cross-check spans purchase inventory payable and journal',()=>{
 assert.equal(crossCheckFiscal({fiscalToPurchase:true,fiscalToInventory:true,fiscalToPayable:true,fiscalToJournal:true}).status,'MATCHED');
 assert.equal(crossCheckFiscal({fiscalToPurchase:true}).status,'NEEDS_REVIEW');
});
test('pre-SPED readiness fails closed',()=>{
 const x=assessFiscalReadiness({schemaValidated:true,businessValidated:true,crossChecksMatched:true,evidenceComplete:false});
 assert.equal(x.state,'VALIDATING');assert.ok(x.blockers.includes('EVIDENCE_INCOMPLETE'));
 assert.equal(assessFiscalReadiness({schemaValidated:true,businessValidated:true,crossChecksMatched:true,evidenceComplete:true}).state,'READY_FOR_REVIEW');
});
test('fiscal submission requires human approval',()=>{
 assert.throws(()=>assertFiscalSubmit(),e=>e.code==='APPROVAL_REQUIRED');
 assert.equal(assertFiscalSubmit({humanApproved:true}),true);
});
test('submitted is not accepted and rejection is preserved',()=>{
 assert.equal(recordSubmissionResult({submitted:true}).state,'SUBMITTED');
 const r=recordSubmissionResult({submitted:true,accepted:false,rejectionCode:'PVA-001'});
 assert.equal(r.state,'REJECTED');assert.equal(r.rejectionCode,'PVA-001');
});
