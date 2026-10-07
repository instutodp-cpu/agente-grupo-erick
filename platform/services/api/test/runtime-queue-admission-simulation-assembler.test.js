'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {buildGoldenQueueAdmissionBundle}=require('./helpers/runtime-queue-admission-simulation-test-data');
const {assembleRuntimeQueueAdmissionRequest}=require('../src/core/runtime-queue-admission-assembler');
const {evaluateRuntimeQueueAdmissionRequest}=require('../src/core/runtime-queue-admission-boundary');

function prepared(){ const g=buildGoldenQueueAdmissionBundle(); return g; }
test('composes prepared dispatch into declarative queue admission package',()=>{ const g=prepared(); const request=assembleRuntimeQueueAdmissionRequest({dispatchRequest:g.dispatchRequest,dispatchOutcome:g.dispatchOutcome}); const out=evaluateRuntimeQueueAdmissionRequest(request,{}); assert.equal(out.decision.status,'QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION'); for(const f of ['queue_admission_applied','queue_created','queue_item_created','queue_item_enqueued','queue_position_reserved','queue_capacity_consumed','worker_reserved','worker_started','stage_dispatched','stage_started','executed']) assert.equal(out.decision[f],false); assert.equal(out.decision.production_blocked,true); });
test('fails closed when dispatch is not prepared',()=>{ const g=prepared(); assert.throws(()=>assembleRuntimeQueueAdmissionRequest({dispatchRequest:g.dispatchRequest,dispatchOutcome:{...g.dispatchOutcome,decision:{...g.dispatchOutcome.decision,status:'DISPATCH_POLICY_BLOCKED'}}}),/dispatch_not_prepared/); });
test('fails closed without canonical registry snapshot',()=>{ const g=prepared(); assert.throws(()=>assembleRuntimeQueueAdmissionRequest({dispatchRequest:{...g.dispatchRequest,registry_snapshot_reference:null},dispatchOutcome:g.dispatchOutcome}),/registry_snapshot_required/); });
test('fails closed on operational dispatch state',()=>{ const g=prepared(); assert.throws(()=>assembleRuntimeQueueAdmissionRequest({dispatchRequest:g.dispatchRequest,dispatchOutcome:{...g.dispatchOutcome,decision:{...g.dispatchOutcome.decision,worker_started:true}}}),/safety_invariant_failed/); });
