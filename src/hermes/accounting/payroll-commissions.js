'use strict';

const PAYROLL_EVENT_TYPES=Object.freeze([
 'SALARY','COMMISSION','OVERTIME','ABSENCE','DSR','VACATION','VACATION_BONUS',
 'THIRTEENTH_SALARY','BONUS','BENEFIT','INSS','FGTS','IRRF','ADVANCE','DEDUCTION','TERMINATION','PRO_LABORE'
]);
function required(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function cents(v,f){if(!Number.isSafeInteger(v)||v<0)throw new Error(`${f} must be a non-negative safe integer`);}
function createEmploymentContract(i={}){
 for(const f of ['contractId','employeeId','companyId','establishmentId','role','effectiveFrom'])required(i[f],f);
 return Object.freeze({...i,effectiveUntil:i.effectiveUntil??null});
}
function createPayrollEvent(i={}){
 for(const f of ['eventId','employeeId','companyId','eventType','amountCents','competence','source'])required(i[f],f);
 if(!PAYROLL_EVENT_TYPES.includes(i.eventType))throw new Error('unsupported payroll event type');
 cents(i.amountCents,'amountCents');
 return Object.freeze({...i,evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
function createCommissionPlan(i={}){
 for(const f of ['planId','version','effectiveFrom','basisPoints'])required(i[f],f);
 if(!Number.isSafeInteger(i.basisPoints)||i.basisPoints<0)throw new Error('basisPoints must be a non-negative safe integer');
 return Object.freeze({...i,effectiveUntil:i.effectiveUntil??null});
}
function calculateCommission({eligibleSalesCents,plan}={}){
 cents(eligibleSalesCents,'eligibleSalesCents'); required(plan,'plan');
 return Object.freeze({commissionCents:Math.round(eligibleSalesCents*plan.basisPoints/10000),planId:plan.planId,planVersion:plan.version});
}
function reconcileCommission({expectedCents,payrollCents}={}){
 cents(expectedCents,'expectedCents');cents(payrollCents,'payrollCents');
 return Object.freeze({expectedCents,payrollCents,varianceCents:payrollCents-expectedCents,status:expectedCents===payrollCents?'MATCHED':'PAYROLL_EXCEPTION'});
}
function createSalesIntegritySignal(i={}){
 return Object.freeze({
  signalType:'SALES_ASSIGNMENT_ANOMALY',employeeIds:Object.freeze([...(i.employeeIds??[])]),
  saleIds:Object.freeze([...(i.saleIds??[])]),requiresHumanReview:true,
  fraudConclusion:false,disciplinaryDecision:false,evidenceIds:Object.freeze([...(i.evidenceIds??[])])
 });
}
function createLaborProvision(i={}){
 for(const f of ['provisionId','employeeId','competence','provisionType','amountCents','ruleVersion'])required(i[f],f);
 if(!['VACATION','VACATION_BONUS','THIRTEENTH_SALARY','FGTS','INSS'].includes(i.provisionType))throw new Error('unsupported provision type');
 cents(i.amountCents,'amountCents');
 return Object.freeze({...i,valueState:'PROVISION'});
}
function assessPayrollReadiness(i={}){
 const checks=['contractResolved','timeFactsResolved','salesFactsResolved','rulesEffective','evidenceComplete','deterministicCalculationPassed'];
 const blockers=checks.filter(k=>i[k]!==true);
 return Object.freeze({status:blockers.length?'BLOCKED':'READY_FOR_REVIEW',blockers:Object.freeze(blockers)});
}
function assertTerminationEffect({humanApproved=false}={}){
 if(humanApproved!==true){const e=new Error('TERMINATION_REQUIRES_HUMAN_APPROVAL');e.code='APPROVAL_REQUIRED';throw e;} return true;
}
module.exports={PAYROLL_EVENT_TYPES,createEmploymentContract,createPayrollEvent,createCommissionPlan,calculateCommission,reconcileCommission,createSalesIntegritySignal,createLaborProvision,assessPayrollReadiness,assertTerminationEffect};
