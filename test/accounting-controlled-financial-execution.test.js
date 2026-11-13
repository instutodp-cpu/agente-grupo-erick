'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createExecutionPolicy,authorizeExecution,reserveIdempotency,createProviderSubmission,recordProviderConfirmation,reconcileExecution}=require('../src/hermes/accounting/controlled-financial-execution');

const envelope={instructionId:'p1',amountCents:10000,destinationAccountRef:'dest-1',idempotencyKey:'k1',expiresAt:'2026-10-10T12:00:00Z'};
const approval={status:'APPROVED',approvedBy:'approver'};
test('execution is disabled by default',()=>{
 const p=createExecutionPolicy({policyId:'p',version:'1',maxAmountCents:50000,allowedDestinationRefs:['dest-1']});
 const r=authorizeExecution({envelope,policy:p,now:'2026-10-10T10:00:00Z',approval,preparedBy:'prep'});
 assert.equal(r.state,'DISABLED');assert.ok(r.blockers.includes('FEATURE_DISABLED'));assert.ok(r.blockers.includes('REAL_PROVIDER_DISABLED'));
});
test('allowlist amount expiry and segregation are hard gates',()=>{
 const p=createExecutionPolicy({policyId:'p',version:'1',maxAmountCents:5000,allowedDestinationRefs:['other'],featureEnabled:true,realProviderEnabled:true});
 const r=authorizeExecution({envelope,policy:p,now:'2026-10-10T13:00:00Z',approval:{status:'APPROVED',approvedBy:'prep'},preparedBy:'prep'});
 assert.equal(r.state,'DISABLED');for(const b of ['SEGREGATION_VIOLATION','ENVELOPE_EXPIRED','DESTINATION_NOT_ALLOWLISTED','AMOUNT_OUT_OF_POLICY'])assert.ok(r.blockers.includes(b));
});
test('fully governed envelope can become authorized',()=>{
 const p=createExecutionPolicy({policyId:'p',version:'1',maxAmountCents:50000,allowedDestinationRefs:['dest-1'],featureEnabled:true,realProviderEnabled:true});
 assert.equal(authorizeExecution({envelope,policy:p,now:'2026-10-10T10:00:00Z',approval,preparedBy:'prep'}).state,'AUTHORIZED');
});
test('persistent layer must reject reused idempotency key',()=>{assert.throws(()=>reserveIdempotency({idempotencyKey:'k1',existingKeys:['k1']}),e=>e.code==='IDEMPOTENCY_CONFLICT');});
test('submitted is not confirmed',()=>{
 const s=createProviderSubmission({executionId:'e',instructionId:'p1',provider:'bank',idempotencyKey:'k1',submittedAt:'now'});assert.equal(s.state,'SUBMITTED');assert.equal(s.providerConfirmed,false);
});
test('provider confirmation and bank reconciliation are separate gates',()=>{
 const s=createProviderSubmission({executionId:'e',instructionId:'p1',provider:'bank',idempotencyKey:'k1',submittedAt:'now'});
 const c=recordProviderConfirmation(s,{confirmed:true,providerReference:'ref',confirmedAt:'later'});assert.equal(c.state,'CONFIRMED');
 assert.equal(reconcileExecution({submission:c,bankTransactionId:'bt',amountMatched:true,destinationMatched:true}).state,'RECONCILED');
});
