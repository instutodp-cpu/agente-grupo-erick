'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {CONTRACT_VERSION:REQUEST}=require('../src/core/hermes-maintainer-request-contract');
const {prepareHermesMaintainerPlan}=require('../src/core/hermes-maintainer-plan-contract');
const {buildHermesMaintainerPlanFingerprint}=require('../src/core/hermes-maintainer-plan-fingerprint');
const {prepareHermesMaintainerSteps}=require('../src/core/hermes-maintainer-step-contract');
const {admitHermesMaintainerSteps}=require('../src/core/hermes-maintainer-step-admission-contract');
const {buildHermesMaintainerStepAdmissionFingerprint}=require('../src/core/hermes-maintainer-step-admission-fingerprint');
const {prepareHermesMaintainerExecutionIntent}=require('../src/core/hermes-maintainer-execution-intent-contract');
const {buildHermesMaintainerExecutionIntentFingerprint}=require('../src/core/hermes-maintainer-execution-intent-fingerprint');
const {buildHermesMaintainerExecutionAuthorizationRequest,validateHermesMaintainerExecutionAuthorizationRequest}=require('../src/core/hermes-maintainer-execution-authorization-request');
function req(id,action){return {contract_version:REQUEST,request_id:id,action,repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',target_ref:null,simulation:true,production_blocked:true};}
function fixture(){const p=prepareHermesMaintainerPlan({mission_id:'m1',requests:[req('1','repository_read'),req('2','ci_read')]});const s=prepareHermesMaintainerSteps(p,buildHermesMaintainerPlanFingerprint(p).fingerprint);const a=admitHermesMaintainerSteps(s);const af=buildHermesMaintainerStepAdmissionFingerprint(a).fingerprint;const i=prepareHermesMaintainerExecutionIntent(a,af);const f=buildHermesMaintainerExecutionIntentFingerprint(i).fingerprint;return {i,f};}
test('requests authority without granting or consuming it',()=>{const {i,f}=fixture();const r=buildHermesMaintainerExecutionAuthorizationRequest(i,f);assert.equal(r.status,'MAINTAINER_EXECUTION_AUTHORIZATION_REQUESTED_SIMULATION');assert.equal(r.authorization_requested,true);assert.equal(validateHermesMaintainerExecutionAuthorizationRequest(r).valid,true);for(const x of ['authorization_granted','execution_authorized','authority_consumed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','production_allowed'])assert.equal(r[x],false);});
test('fingerprint drift blocks authorization request',()=>{const {i,f}=fixture();const d={...i,intents:i.intents.map((x,n)=>n===0?{...x,action:'ci_read'}:x)};const r=buildHermesMaintainerExecutionAuthorizationRequest(d,f);assert.equal(r.authorization_requested,false);assert.equal(r.status,'MAINTAINER_EXECUTION_AUTHORIZATION_REQUEST_BLOCKED');});
test('non-ready intent cannot request authority',()=>{const {i,f}=fixture();const r=buildHermesMaintainerExecutionAuthorizationRequest({...i,ready:false,status:'MAINTAINER_EXECUTION_INTENT_BLOCKED',blockers:['blocked']},f);assert.equal(r.authorization_requested,false);});
test('validator rejects granted authority at request layer',()=>{const {i,f}=fixture();const r=buildHermesMaintainerExecutionAuthorizationRequest(i,f);assert.equal(validateHermesMaintainerExecutionAuthorizationRequest({...r,authorization_granted:true}).valid,false);});
