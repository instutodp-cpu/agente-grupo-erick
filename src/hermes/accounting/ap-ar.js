'use strict';

const OBLIGATION_STATUSES = Object.freeze([
  'OPEN','DUE_SOON','OVERDUE','PARTIALLY_PAID','PAID','RENEGOTIATED','BLOCKED','READY_FOR_PAYMENT'
]);

function required(v,f){ if(v===undefined||v===null||v==='') throw new Error(`${f} is required`); }
function cents(v,f){ if(!Number.isSafeInteger(v)||v<0) throw new Error(`${f} must be a non-negative safe integer`); }

function createObligation(input={}){
  for(const f of ['obligationId','kind','tenantId','companyId','counterpartyId','originalAmountCents','dueDate','sourceDocumentId']) required(input[f],f);
  if(!['PAYABLE','RECEIVABLE'].includes(input.kind)) throw new Error('kind must be PAYABLE or RECEIVABLE');
  cents(input.originalAmountCents,'originalAmountCents');
  const paid=input.paidAmountCents??0; cents(paid,'paidAmountCents');
  if(paid>input.originalAmountCents) throw new Error('paidAmountCents exceeds originalAmountCents');
  return Object.freeze({
    obligationId:input.obligationId, kind:input.kind, tenantId:input.tenantId,
    companyId:input.companyId, establishmentId:input.establishmentId??null,
    counterpartyId:input.counterpartyId, sourceDocumentId:input.sourceDocumentId,
    installmentNumber:input.installmentNumber??1, originalAmountCents:input.originalAmountCents,
    dueDate:input.dueDate, paidAmountCents:paid,
    outstandingCents:input.originalAmountCents-paid,
    status:input.status??(paid===input.originalAmountCents?'PAID':paid>0?'PARTIALLY_PAID':'OPEN'),
    evidenceIds:Object.freeze([...(input.evidenceIds??[])])
  });
}

function agingBucket(dueDate, asOf){
  const due=new Date(dueDate+'T00:00:00Z'), now=new Date(asOf+'T00:00:00Z');
  if(Number.isNaN(due.getTime())||Number.isNaN(now.getTime())) throw new Error('invalid aging date');
  const days=Math.floor((now-due)/86400000);
  if(days<=0) return 'A_VENCER';
  if(days<=30) return '1_30';
  if(days<=60) return '31_60';
  if(days<=90) return '61_90';
  if(days<=120) return '91_120';
  return '120_PLUS';
}

function detectDuplicateObligation(a,b){
  const sameIdentity=a.companyId===b.companyId && a.counterpartyId===b.counterpartyId &&
    a.sourceDocumentId===b.sourceDocumentId && a.installmentNumber===b.installmentNumber;
  if(!sameIdentity) return 'DISTINCT';
  return a.originalAmountCents===b.originalAmountCents && a.dueDate===b.dueDate ? 'DUPLICATE' : 'CONFLICT';
}

function assessPaymentReadiness(input={}){
  const checks=input.checks??{};
  const requiredChecks=['documentMatched','goodsReceiptMatched','amountMatched','beneficiaryVerified','noDuplicate','evidenceComplete'];
  const failed=requiredChecks.filter(k=>checks[k]!==true);
  if(failed.length) return Object.freeze({status:'BLOCKED',blockers:Object.freeze(failed)});
  return Object.freeze({status:'READY_FOR_PAYMENT',blockers:Object.freeze([]),authority:'PREPARE'});
}

function assertPaymentExecution(){
  const err=new Error('PAYMENT_EXECUTION_NOT_GRANTED_IN_C8');
  err.code='CAPABILITY_NOT_GRANTED';
  throw err;
}

function createCreditPolicy(input={}){
  for(const f of ['policyId','version','effectiveFrom']) required(input[f],f);
  return Object.freeze({
    policyId:input.policyId,version:input.version,effectiveFrom:input.effectiveFrom,
    effectiveUntil:input.effectiveUntil??null,
    limitChangeRequiresApproval:true,
    renegotiationRequiresApproval:true,
    discountRequiresApproval:true,
    negativeListingRequiresApproval:true
  });
}

module.exports={OBLIGATION_STATUSES,createObligation,agingBucket,detectDuplicateObligation,assessPaymentReadiness,assertPaymentExecution,createCreditPolicy};
