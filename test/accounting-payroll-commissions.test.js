'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createEmploymentContract,createPayrollEvent,createCommissionPlan,
  calculateCommission,reconcileCommission,createSalesIntegritySignal,
  createLaborProvision,assessPayrollReadiness,createPayrollPreview,
  assertTerminationEffect
}=require('../src/hermes/accounting/payroll-commissions');

const scope={
  tenantId:'tenant-a',
  companyId:'company-a',
  employeeId:'employee-a',
  contractId:'contract-a',
  competence:'2026-10'
};

test('employment contract enforces tenant scope and date range',()=>{
  const contract=createEmploymentContract({
    contractId:scope.contractId,tenantId:scope.tenantId,employeeId:scope.employeeId,
    companyId:scope.companyId,establishmentId:'store-a',role:'seller',
    effectiveFrom:'2026-01-01',effectiveUntil:'2026-12-31'
  });
  assert.equal(contract.employeeId,'employee-a');
  assert.equal(Object.isFrozen(contract),true);
  assert.throws(
    ()=>createEmploymentContract({
      ...contract,effectiveFrom:'2026-12-31',effectiveUntil:'2026-01-01'
    }),
    error=>error.code==='INVALID_CONTRACT_RANGE'
  );
});

test('commission uses a versioned plan and safe integer arithmetic',()=>{
  const plan=createCommissionPlan({
    planId:'sales-plan',version:'2026.1',tenantId:scope.tenantId,
    companyId:scope.companyId,effectiveFrom:'2026-01-01',
    basisPoints:250
  });
  const result=calculateCommission({
    eligibleSalesCents:100020,plan,tenantId:scope.tenantId,
    companyId:scope.companyId,occurredAt:'2026-10-02'
  });
  assert.equal(result.commissionCents,2501);
  assert.equal(result.planVersion,'2026.1');
  assert.throws(
    ()=>calculateCommission({
      eligibleSalesCents:100020,plan,tenantId:'tenant-b',
      companyId:scope.companyId,occurredAt:'2026-10-02'
    }),
    error=>error.code==='SCOPE_MISMATCH'
  );
});

test('commission mismatch becomes a payroll exception',()=>{
  const result=reconcileCommission({expectedCents:2500,payrollCents:2499});
  assert.equal(result.varianceCents,-1);
  assert.equal(result.status,'PAYROLL_EXCEPTION');
  assert.equal(result.requiresHumanReview,true);
});

test('payroll events keep labor components distinct',()=>{
  const salary=createPayrollEvent({
    ...scope,eventId:'salary-1',eventType:'SALARY',amountCents:150000,source:'SYNTHETIC_PAYROLL',
    evidenceIds:['evidence-1']
  });
  const fgts=createPayrollEvent({
    ...scope,eventId:'fgts-1',eventType:'FGTS',amountCents:12000,source:'SYNTHETIC_RULE'
  });
  assert.equal(salary.eventType,'SALARY');
  assert.equal(fgts.eventType,'FGTS');
  assert.notEqual(salary.eventType,fgts.eventType);
  assert.throws(
    ()=>createPayrollEvent({...scope,eventId:'bad',eventType:'UNKNOWN',amountCents:1,source:'SYNTHETIC'}),
    error=>error.code==='UNSUPPORTED_EVENT_TYPE'
  );
});

test('sales assignment anomaly is never automatic fraud or discipline',()=>{
  const signal=createSalesIntegritySignal({
    signalId:'signal-1',tenantId:scope.tenantId,companyId:scope.companyId,
    employeeIds:['employee-a','employee-b'],saleIds:['sale-1'],evidenceIds:['evidence-2']
  });
  assert.equal(signal.fraudConclusion,false);
  assert.equal(signal.disciplinaryDecision,false);
  assert.equal(signal.requiresHumanReview,true);
  assert.equal(Object.isFrozen(signal),true);
});

test('labor provisions remain explicitly provisions',()=>{
  const provision=createLaborProvision({
    provisionId:'provision-1',tenantId:scope.tenantId,companyId:scope.companyId,
    employeeId:scope.employeeId,competence:scope.competence,
    provisionType:'THIRTEENTH_SALARY',amountCents:10000,ruleVersion:'rule-1'
  });
  assert.equal(provision.valueState,'PROVISION');
  assert.throws(
    ()=>createLaborProvision({
      provisionId:'bad',tenantId:scope.tenantId,companyId:scope.companyId,
      employeeId:scope.employeeId,competence:'2026-13',
      provisionType:'VACATION',amountCents:1,ruleVersion:'rule-1'
    }),
    error=>error.code==='INVALID_COMPETENCE'
  );
});

test('payroll readiness and preview fail closed',()=>{
  const blocked=assessPayrollReadiness({
    contractResolved:true,timeFactsResolved:true,salesFactsResolved:true,
    rulesEffective:true,evidenceComplete:true,deterministicCalculationPassed:false
  });
  assert.equal(blocked.status,'BLOCKED');
  assert.ok(blocked.blockers.includes('CALCULATION_NOT_DETERMINISTIC'));

  const ready=assessPayrollReadiness({
    contractResolved:true,timeFactsResolved:true,salesFactsResolved:true,
    rulesEffective:true,evidenceComplete:true,deterministicCalculationPassed:true,
    scopeResolved:true
  });
  const event=createPayrollEvent({
    ...scope,eventId:'salary-preview',eventType:'SALARY',amountCents:150000,
    source:'SYNTHETIC_PAYROLL'
  });
  const preview=createPayrollPreview({
    previewId:'preview-1',tenantId:scope.tenantId,companyId:scope.companyId,
    competence:scope.competence,events:[event],readiness:ready
  });
  assert.equal(preview.status,'READY_FOR_REVIEW');
  assert.equal(preview.simulationOnly,true);
  assert.equal(preview.paymentEffect,'NONE');
  assert.equal(Object.isFrozen(preview),true);
});

test('termination effect requires approved state and human approval',()=>{
  assert.throws(
    ()=>assertTerminationEffect({state:'READY_FOR_REVIEW',humanApproved:true}),
    error=>error.code==='TERMINATION_NOT_APPROVED'
  );
  assert.throws(
    ()=>assertTerminationEffect({state:'APPROVED'}),
    error=>error.code==='APPROVAL_REQUIRED'
  );
  assert.equal(assertTerminationEffect({state:'APPROVED',humanApproved:true}),true);
});
