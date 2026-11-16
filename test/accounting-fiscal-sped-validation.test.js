'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createFiscalRule,validateRuleEffective,validateFiscalClassification,
  crossCheckFiscal,createFiscalObligation,assessFiscalReadiness,
  createPreSpedPackage,assertFiscalSubmit,recordSubmissionResult
}=require('../src/hermes/accounting/fiscal-sped-validation');

const rule=createFiscalRule({
  ruleId:'rule-2026',
  version:'1',
  authority:'SYNTHETIC_OFFICIAL_REGISTRY',
  officialSource:'synthetic://fiscal/rule-2026',
  effectiveFrom:'2026-01-01',
  schemaHash:'sha256:synthetic-rule'
});

test('rule dates are strict and expired rules fail closed',()=>{
  assert.equal(validateRuleEffective(rule,'2026-10-02'),true);
  assert.throws(
    ()=>validateRuleEffective({...rule,effectiveUntil:'2026-09-30'},'2026-10-02'),
    error=>error.code==='RULE_NOT_EFFECTIVE'
  );
  assert.throws(
    ()=>createFiscalRule({...rule,effectiveFrom:'2026-02-30'}),
    error=>error.code==='INVALID_DATE'
  );
});

test('valid document is not enough for tax classification',()=>{
  const blocked=validateFiscalClassification({
    documentValidity:'VALID',
    occurredAt:'2026-10-02',
    rule,
    requiredFields:['cfop','ncm'],
    classification:{cfop:'5102'}
  });
  assert.equal(blocked.status,'BLOCKED');
  assert.ok(blocked.issues.includes('MISSING_NCM'));

  const valid=validateFiscalClassification({
    documentValidity:'VALID',
    occurredAt:'2026-10-02',
    rule,
    requiredFields:['cfop','ncm'],
    classification:{cfop:'5102',ncm:'12345678'}
  });
  assert.equal(valid.status,'VALIDATED');
});

test('AI or unknown classification source never self-validates',()=>{
  const result=validateFiscalClassification({
    documentValidity:'VALID',occurredAt:'2026-10-02',rule,
    requiredFields:['cfop'],classification:{cfop:'5102'},
    classificationSource:'LLM'
  });
  assert.equal(result.status,'BLOCKED');
  assert.ok(result.issues.includes('CLASSIFICATION_NEEDS_REVIEW'));
});

test('cross-check requires all four explicit matches',()=>{
  assert.equal(crossCheckFiscal({
    fiscalToPurchase:true,fiscalToInventory:true,
    fiscalToPayable:true,fiscalToJournal:true
  }).status,'MATCHED');
  const review=crossCheckFiscal({fiscalToPurchase:true});
  assert.equal(review.status,'NEEDS_REVIEW');
  assert.deepEqual(review.failedChecks,['fiscalToInventory','fiscalToPayable','fiscalToJournal']);
});

test('obligation is tenant scoped and competence is strict',()=>{
  const obligation=createFiscalObligation({
    obligationId:'obl-1',tenantId:'tenant-a',companyId:'company-a',
    obligationType:'SPED_SYNTHETIC',competence:'2026-10',ruleVersion:'1',
    evidenceIds:['ev-1']
  });
  assert.equal(obligation.state,'FORECAST');
  assert.equal(Object.isFrozen(obligation),true);
  assert.equal(Object.isFrozen(obligation.evidenceIds),true);
  assert.throws(
    ()=>createFiscalObligation({
      obligationId:'obl-2',tenantId:'tenant-a',companyId:'company-a',
      obligationType:'SPED_SYNTHETIC',competence:'2026-13',ruleVersion:'1'
    }),
    error=>error.code==='INVALID_COMPETENCE'
  );
});

test('readiness and pre-SPED package fail closed',()=>{
  const readiness=assessFiscalReadiness({
    schemaValidated:true,businessValidated:true,
    crossChecksMatched:true,evidenceComplete:false
  });
  assert.equal(readiness.state,'VALIDATING');
  assert.ok(readiness.blockers.includes('EVIDENCE_INCOMPLETE'));

  const ready=assessFiscalReadiness({
    schemaValidated:true,businessValidated:true,
    crossChecksMatched:true,evidenceComplete:true,
    classificationValidated:true
  });
  assert.equal(ready.state,'READY_FOR_REVIEW');

  const blocked=createPreSpedPackage({
    packageId:'pkg-1',tenantId:'tenant-a',companyId:'company-a',
    competence:'2026-10',
    classificationResult:{status:'BLOCKED'},
    crossCheckResult:{status:'MATCHED'},
    readiness:ready
  });
  assert.equal(blocked.status,'BLOCKED');

  const prepared=createPreSpedPackage({
    packageId:'pkg-2',tenantId:'tenant-a',companyId:'company-a',
    competence:'2026-10',
    classificationResult:{status:'VALIDATED'},
    crossCheckResult:{status:'MATCHED'},
    readiness:ready
  });
  assert.equal(prepared.status,'READY_FOR_REVIEW');
  assert.equal(prepared.simulationOnly,true);
  assert.equal(Object.isFrozen(prepared),true);
});

test('submit gate requires approval and approved state, with no effect',()=>{
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

test('submission states preserve submitted versus accepted versus rejected',()=>{
  assert.equal(recordSubmissionResult({submitted:false}).state,'APPROVED');
  assert.equal(recordSubmissionResult({submitted:true}).state,'SUBMITTED');
  assert.equal(recordSubmissionResult({submitted:true,accepted:true}).state,'ACCEPTED');
  const rejected=recordSubmissionResult({
    submitted:true,accepted:false,rejectionCode:'PVA-SYNTH-001'
  });
  assert.equal(rejected.state,'REJECTED');
  assert.equal(rejected.rejectionCode,'PVA-SYNTH-001');
  assert.equal(rejected.simulationOnly,true);
  assert.throws(
    ()=>recordSubmissionResult({submitted:true,accepted:false}),
    error=>error.code==='REQUIRED_FIELD'
  );
});
