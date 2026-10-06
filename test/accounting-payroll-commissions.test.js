'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createPayrollEvent,createCommissionPlan,calculateCommission,reconcileCommission,createSalesIntegritySignal,createLaborProvision,assessPayrollReadiness,assertTerminationEffect}=require('../src/hermes/accounting/payroll-commissions');

test('commission uses versioned deterministic plan and integer cents',()=>{
 const p=createCommissionPlan({planId:'sales',version:'2026.1',effectiveFrom:'2026-01-01',basisPoints:250});
 const r=calculateCommission({eligibleSalesCents:100001,plan:p});
 assert.equal(r.commissionCents,2500);assert.equal(r.planVersion,'2026.1');
});
test('commission mismatch becomes payroll exception',()=>{
 const r=reconcileCommission({expectedCents:2500,payrollCents:2499});
 assert.equal(r.varianceCents,-1);assert.equal(r.status,'PAYROLL_EXCEPTION');
});
test('payroll events keep labor components distinct',()=>{
 const salary=createPayrollEvent({eventId:'s',employeeId:'e',companyId:'c',eventType:'SALARY',amountCents:150000,competence:'2026-10',source:'PAYROLL'});
 const fgts=createPayrollEvent({eventId:'f',employeeId:'e',companyId:'c',eventType:'FGTS',amountCents:12000,competence:'2026-10',source:'RULE_ENGINE'});
 assert.equal(salary.eventType,'SALARY');assert.equal(fgts.eventType,'FGTS');
});
test('sales assignment anomaly is never automatic fraud or discipline',()=>{
 const s=createSalesIntegritySignal({employeeIds:['a','b'],saleIds:['1']});
 assert.equal(s.fraudConclusion,false);assert.equal(s.disciplinaryDecision,false);assert.equal(s.requiresHumanReview,true);
});
test('vacation and thirteenth provisions remain provisions',()=>{
 const p=createLaborProvision({provisionId:'p',employeeId:'e',competence:'2026-10',provisionType:'THIRTEENTH_SALARY',amountCents:10000,ruleVersion:'r1'});
 assert.equal(p.valueState,'PROVISION');
});
test('payroll readiness fails closed when facts or rules are missing',()=>{
 const r=assessPayrollReadiness({contractResolved:true,timeFactsResolved:true,salesFactsResolved:true,rulesEffective:true,evidenceComplete:true,deterministicCalculationPassed:false});
 assert.equal(r.status,'BLOCKED');assert.ok(r.blockers.includes('deterministicCalculationPassed'));
});
test('termination effect requires human approval',()=>{
 assert.throws(()=>assertTerminationEffect(),e=>e.code==='APPROVAL_REQUIRED');
 assert.equal(assertTerminationEffect({humanApproved:true}),true);
});
