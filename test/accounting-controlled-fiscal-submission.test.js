'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createFiscalExecutionPolicy,authorizeFiscalSubmission,reserveFiscalIdempotency,createFiscalSubmission,recordProtocol,recordOfficialFiscalResponse,reconcileFiscalSubmission}=require('../src/hermes/accounting/controlled-fiscal-submission');

const envelope={system:'ESOCIAL',schemaValid:true,ruleEffective:true,businessValid:true,evidenceComplete:true,idempotencyKey:'k1',expiresAt:'2026-10-10T12:00:00Z'};
const approval={status:'APPROVED',approvedBy:'approver'};
test('real fiscal transmission is disabled by default',()=>{
 const p=createFiscalExecutionPolicy({policyId:'p',version:'1',allowedSystems:['ESOCIAL']});
 const r=authorizeFiscalSubmission({envelope,policy:p,approval,preparedBy:'prep',now:'2026-10-10T10:00:00Z'});
 assert.equal(r.state,'DISABLED');assert.ok(r.blockers.includes('FEATURE_DISABLED'));assert.ok(r.blockers.includes('REAL_PROVIDER_DISABLED'));
});
test('schema rule business evidence and segregation are hard gates',()=>{
 const p=createFiscalExecutionPolicy({policyId:'p',version:'1',allowedSystems:['ESOCIAL'],featureEnabled:true,realProviderEnabled:true});
 const r=authorizeFiscalSubmission({envelope:{...envelope,schemaValid:false,ruleEffective:false,evidenceComplete:false},policy:p,approval:{status:'APPROVED',approvedBy:'prep'},preparedBy:'prep',now:'2026-10-10T10:00:00Z'});
 for(const b of ['SCHEMA_NOT_VALID','RULE_NOT_EFFECTIVE','EVIDENCE_INCOMPLETE','SEGREGATION_VIOLATION'])assert.ok(r.blockers.includes(b));
});
test('fully governed fiscal envelope can become authorized',()=>{
 const p=createFiscalExecutionPolicy({policyId:'p',version:'1',allowedSystems:['ESOCIAL'],featureEnabled:true,realProviderEnabled:true});
 assert.equal(authorizeFiscalSubmission({envelope,policy:p,approval,preparedBy:'prep',now:'2026-10-10T10:00:00Z'}).state,'AUTHORIZED');
});
test('duplicate fiscal submission key is denied',()=>{assert.throws(()=>reserveFiscalIdempotency({idempotencyKey:'k1',existingKeys:['k1']}),e=>e.code==='IDEMPOTENCY_CONFLICT');});
test('submitted and protocol do not mean accepted',()=>{
 const s=createFiscalSubmission({submissionId:'s',obligationId:'o',system:'ESOCIAL',schemaVersion:'1',ruleVersion:'1',idempotencyKey:'k1',submittedAt:'now'});
 const p=recordProtocol(s,{protocol:'prot',processing:true,receiptAt:'later'});assert.equal(p.state,'PROCESSING');assert.equal(p.accepted,false);
});
test('official rejection is preserved',()=>{
 const s=createFiscalSubmission({submissionId:'s',obligationId:'o',system:'ESOCIAL',schemaVersion:'1',ruleVersion:'1',idempotencyKey:'k1',submittedAt:'now'});
 const r=recordOfficialFiscalResponse(s,{status:'REJECTED',officialCode:'E001',officialMessage:'invalid'});assert.equal(r.state,'REJECTED');assert.equal(r.officialCode,'E001');
});
test('accepted submission still requires obligation and accounting reconciliation',()=>{
 const s=createFiscalSubmission({submissionId:'s',obligationId:'o',system:'ESOCIAL',schemaVersion:'1',ruleVersion:'1',idempotencyKey:'k1',submittedAt:'now'});
 const a=recordOfficialFiscalResponse(s,{status:'ACCEPTED',protocol:'prot'});assert.equal(reconcileFiscalSubmission({submission:a,officialObligationMatched:true,accounted:true}).state,'RECONCILED');
});
