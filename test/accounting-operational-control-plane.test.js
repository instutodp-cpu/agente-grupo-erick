'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createCapabilityFlag,assertCapabilityEnabled,reserveExecution,acquireLease,createExecutionAttempt,completeExecutionAttempt,assertTenantIsolation}=require('../src/hermes/accounting/operational-control-plane');

const candidate={tenantId:'t1',capability:'FINANCIAL_EXECUTION',idempotencyKey:'k1',operationId:'op1',ownerId:'worker1',leaseUntil:'2026-10-03T13:00:00Z',createdAt:'2026-10-03T12:00:00Z'};
test('tenant capability is disabled unless both gates are explicitly true',()=>{
 const f=createCapabilityFlag({tenantId:'t1',capability:'FINANCIAL_EXECUTION',version:'1',updatedBy:'u',updatedAt:'now'});
 assert.throws(()=>assertCapabilityEnabled(f),e=>e.code==='CAPABILITY_DISABLED');
});
test('capability can be enabled only as explicit tenant-scoped record',()=>{
 const f=createCapabilityFlag({tenantId:'t1',capability:'FISCAL_SUBMISSION',version:'1',updatedBy:'u',updatedAt:'now',enabled:true,realProviderEnabled:true});
 assert.equal(assertCapabilityEnabled(f),true);
});
test('same tenant capability and idempotency key cannot be reserved twice',()=>{
 const r=reserveExecution({candidate,existingReservations:[],now:'2026-10-03T12:00:00Z'});
 assert.throws(()=>reserveExecution({candidate,existingReservations:[r],now:'2026-10-03T12:01:00Z'}),e=>e.code==='CONFLICT');
});
test('active lease prevents a second worker from executing same reservation',()=>{
 const r=reserveExecution({candidate,existingReservations:[],now:'2026-10-03T12:00:00Z'});
 assert.throws(()=>acquireLease({reservation:r,ownerId:'worker2',now:'2026-10-03T12:30:00Z',newLeaseUntil:'2026-10-03T13:30:00Z'}),e=>e.code==='LOCKED');
});
test('expired lease can be recovered by another worker',()=>{
 const r=reserveExecution({candidate,existingReservations:[],now:'2026-10-03T12:00:00Z'});
 const a=acquireLease({reservation:r,ownerId:'worker2',now:'2026-10-03T13:01:00Z',newLeaseUntil:'2026-10-03T14:00:00Z'});assert.equal(a.ownerId,'worker2');assert.equal(a.state,'RUNNING');
});
test('every execution attempt remains auditable',()=>{
 const a=createExecutionAttempt({attemptId:'a1',tenantId:'t1',capability:'FINANCIAL_EXECUTION',operationId:'op1',idempotencyKey:'k1',startedAt:'now'});
 const c=completeExecutionAttempt(a,{success:false,completedAt:'later',failureCode:'TIMEOUT'});assert.equal(c.state,'FAILED');assert.equal(c.auditRequired,true);
});
test('flag from another tenant cannot authorize reservation',()=>{
 const f=createCapabilityFlag({tenantId:'t2',capability:'FINANCIAL_EXECUTION',version:'1',updatedBy:'u',updatedAt:'now',enabled:true,realProviderEnabled:true});
 assert.throws(()=>assertTenantIsolation({flag:f,reservation:candidate}),e=>e.code==='DENIED');
});
