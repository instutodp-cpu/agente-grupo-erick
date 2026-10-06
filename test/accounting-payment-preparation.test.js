'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createPaymentInstruction,validatePaymentInstruction,detectDuplicatePayment,createPaymentApproval,assertPaymentExecution,createExecutionEnvelope}=require('../src/hermes/accounting/payment-preparation');

const base={instructionId:'p1',tenantId:'t',companyId:'c',obligationId:'o1',beneficiaryId:'b1',amountCents:10000,dueDate:'2026-10-10',destinationAccountRef:'pix:key-hash',createdBy:'prep'};
test('payment instruction is PREPARE authority only',()=>{const p=createPaymentInstruction(base);assert.equal(p.authority,'PREPARE');assert.equal(p.state,'DRAFT');});
test('beneficiary destination duplicate evidence and obligation are hard gates',()=>{
 const r=validatePaymentInstruction({obligationMatched:true,amountMatched:true,beneficiaryVerified:true,destinationVerified:false,duplicateCheckPassed:true,evidenceComplete:true,dueDateValid:true});
 assert.equal(r.state,'VALIDATING');assert.ok(r.blockers.includes('DESTINATION_NOT_VERIFIED'));
});
test('fully validated payment becomes ready for review not executed',()=>{
 const r=validatePaymentInstruction({obligationMatched:true,amountMatched:true,beneficiaryVerified:true,destinationVerified:true,duplicateCheckPassed:true,evidenceComplete:true,dueDateValid:true});
 assert.equal(r.state,'READY_FOR_REVIEW');
});
test('duplicate payment identity is deterministic',()=>{
 const c={...base};assert.equal(detectDuplicatePayment(c,[{...base}]).duplicate,true);
});
test('preparer cannot approve own payment',()=>{assert.throws(()=>createPaymentApproval({approvalId:'a',instructionId:'p1',preparedBy:'u',approvedBy:'u',approvedAt:'now'}),/SEGREGATION/);});
test('C20 cannot execute money movement',()=>{assert.throws(()=>assertPaymentExecution(),e=>e.code==='CAPABILITY_NOT_GRANTED');});
test('execution envelope remains powerless in C20',()=>{
 const e=createExecutionEnvelope({instructionId:'p1',approvalId:'a1',idempotencyKey:'k1',expiresAt:'2026-10-10T12:00:00Z'});assert.equal(e.state,'READY_TO_EXECUTE');assert.equal(e.executionAuthorityGranted,false);
});
