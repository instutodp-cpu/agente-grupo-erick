'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildGoldenSchedulerBundle,evaluateRuntimeSchedulerRequest}=require('./helpers/runtime-scheduler-simulation-test-data');
const {assembleRuntimeWorkerAssignmentRequest}=require('../src/core/runtime-worker-assignment-assembler');
const {evaluateRuntimeWorkerAssignmentRequest}=require('../src/core/runtime-worker-assignment-boundary');
function input(){const g=buildGoldenSchedulerBundle('prepared-no-llm-plan');return {schedulerRequest:g.schedulerRequest,schedulerOutcome:evaluateRuntimeSchedulerRequest(g.schedulerRequest,{})};}
test('composes prepared scheduler into declarative worker assignment package',()=>{const v=input();const req=assembleRuntimeWorkerAssignmentRequest(v);const out=evaluateRuntimeWorkerAssignmentRequest(req,{});assert.equal(out.decision.status,'WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION');assert.equal(out.decision.worker_assignment_applied,false);assert.equal(out.decision.worker_reserved,false);assert.equal(out.decision.worker_started,false);assert.equal(out.decision.stage_dispatched,false);assert.equal(out.decision.executed,false);assert.equal(out.decision.production_blocked,true);});
test('fails closed when scheduler is not prepared',()=>{const v=input();v.schedulerOutcome={...v.schedulerOutcome,decision:{...v.schedulerOutcome.decision,status:'SCHEDULER_POLICY_BLOCKED'}};assert.throws(()=>assembleRuntimeWorkerAssignmentRequest(v),/scheduler_not_prepared/);});
test('fails closed on runtime package drift',()=>{const v=input();v.schedulerOutcome={...v.schedulerOutcome,package:{...v.schedulerOutcome.package,runtime_execution_package_id:'drift'}};assert.throws(()=>assembleRuntimeWorkerAssignmentRequest(v),/package_drift/);});
test('fails closed on scheduler operational state',()=>{const v=input();v.schedulerOutcome={...v.schedulerOutcome,decision:{...v.schedulerOutcome.decision,worker_started:true}};assert.throws(()=>assembleRuntimeWorkerAssignmentRequest(v),/scheduler_safety_invariant_failed/);});
