'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {buildAccountingRuntimeHandoff,validateAccountingRuntimeHandoff,admitAccountingRuntime}=require('../src/accounting-runtime-integration');

function handoff(mode='SIMULATION'){return buildAccountingRuntimeHandoff({handoffId:'h1',tenantId:'t1',organizationId:'o1',projectId:'p1',sessionReferenceId:'s1',actorId:'human1',operationId:'pay1',capability:'FINANCIAL_EXECUTION',idempotencyKey:'k1',mode});}
test('C25 only creates simulation or shadow handoffs with no external effect',()=>{
 const h=handoff();assert.equal(h.executed,false);assert.equal(h.externalEffectAllowed,false);assert.equal(h.realProviderAllowed,false);assert.equal(validateAccountingRuntimeHandoff(h).valid,true);
 assert.throws(()=>handoff('PRODUCTION'),/C25_ONLY_SIMULATION_OR_SHADOW/);
});
test('missing canonical runtime fails closed',async()=>{const r=await admitAccountingRuntime({handoff:handoff()});assert.equal(r.status,'BLOCKED');assert.equal(r.reason,'CANONICAL_RUNTIME_UNAVAILABLE');});
test('job admission denial stops before attempt materialization',async()=>{
 let materialized=false;const runtime={admitExecutionJob:async()=>({outcome:'DENIED'}),materializeExecutionAttempt:async()=>{materialized=true;},admitExecutionAttempt:async()=>({outcome:'ADMITTED'})};
 const r=await admitAccountingRuntime({handoff:handoff(),runtime});assert.equal(r.reason,'JOB_ADMISSION_DENIED');assert.equal(materialized,false);
});
test('canonical job attempt and admission can reach admitted simulation without execution',async()=>{
 const calls=[];const runtime={
  admitExecutionJob:async h=>{calls.push('job');return {outcome:'ADMITTED',job_reference_id:'j1'};},
  materializeExecutionAttempt:async()=>{calls.push('materialize');return {attempt_durable_record_id:'a1'};},
  admitExecutionAttempt:async()=>{calls.push('admit_attempt');return {outcome:'ADMITTED'};}
 };
 const r=await admitAccountingRuntime({handoff:handoff('SHADOW'),runtime});
 assert.deepEqual(calls,['job','materialize','admit_attempt']);assert.equal(r.status,'ADMITTED_SIMULATION');assert.equal(r.mode,'SHADOW');assert.equal(r.executed,false);assert.equal(r.externalEffectAllowed,false);
});
test('tampered handoff that claims execution is rejected',async()=>{
 const h={...handoff(),executed:true};const r=await admitAccountingRuntime({handoff:h,runtime:{}});assert.equal(r.status,'BLOCKED');assert.ok(r.blockers.includes('EXECUTED_MUST_BE_FALSE'));
});
