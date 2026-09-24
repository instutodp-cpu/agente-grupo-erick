'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const { CONTRACT_VERSION:REQUEST }=require('../src/core/hermes-maintainer-request-contract');
const { prepareHermesMaintainerPlan }=require('../src/core/hermes-maintainer-plan-contract');
const { buildHermesMaintainerPlanFingerprint }=require('../src/core/hermes-maintainer-plan-fingerprint');
const { prepareHermesMaintainerSteps }=require('../src/core/hermes-maintainer-step-contract');
const { admitHermesMaintainerSteps }=require('../src/core/hermes-maintainer-step-admission-contract');
const { buildHermesMaintainerStepAdmissionFingerprint }=require('../src/core/hermes-maintainer-step-admission-fingerprint');
const { prepareHermesMaintainerExecutionIntent,validateHermesMaintainerExecutionIntent }=require('../src/core/hermes-maintainer-execution-intent-contract');
function req(id,action){return {contract_version:REQUEST,request_id:id,action,repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',target_ref:null,simulation:true,production_blocked:true};}
function fixture(){const plan=prepareHermesMaintainerPlan({mission_id:'m1',requests:[req('1','repository_read'),req('2','ci_read')]}); const steps=prepareHermesMaintainerSteps(plan,buildHermesMaintainerPlanFingerprint(plan).fingerprint); const admission=admitHermesMaintainerSteps(steps); const fp=buildHermesMaintainerStepAdmissionFingerprint(admission).fingerprint; return {admission,fp};}
test('prepares non-executable intents from fingerprint-bound admission',()=>{const {admission,fp}=fixture(); const out=prepareHermesMaintainerExecutionIntent(admission,fp); assert.equal(out.status,'MAINTAINER_EXECUTION_INTENT_PREPARED_SIMULATION'); assert.equal(out.ready,true); assert.equal(validateHermesMaintainerExecutionIntent(out).valid,true); assert.deepEqual(out.intents.map(x=>x.action),['repository_read','ci_read']); for(const i of out.intents){assert.equal(i.execution_authorized,false);assert.equal(i.capability_granted,false);assert.equal(i.operational_payload_materialized,false);} });
test('fingerprint drift blocks intent preparation',()=>{const {admission,fp}=fixture(); const drifted={...admission,admitted_steps:admission.admitted_steps.map((s,i)=>i===0?{...s,action:'ci_read'}:s)}; assert.equal(prepareHermesMaintainerExecutionIntent(drifted,fp).ready,false);});
test('non-admitted source blocks intent preparation',()=>{const {admission,fp}=fixture(); assert.equal(prepareHermesMaintainerExecutionIntent({...admission,admitted:false,status:'MAINTAINER_STEPS_ADMISSION_BLOCKED'},fp).ready,false);});
test('prepared intent proves zero authority and side effects',()=>{const {admission,fp}=fixture(); const out=prepareHermesMaintainerExecutionIntent(admission,fp); for(const f of ['production_allowed','execution_authorized','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) assert.equal(out[f],false);});
