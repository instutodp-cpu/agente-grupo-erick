'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {CONTRACT_VERSION:REQ}=require('../src/core/hermes-maintainer-request-contract');
const {prepareHermesMaintainerPlan}=require('../src/core/hermes-maintainer-plan-contract');
const {buildHermesMaintainerPlanFingerprint}=require('../src/core/hermes-maintainer-plan-fingerprint');
const {prepareHermesMaintainerSteps,validateHermesMaintainerSteps}=require('../src/core/hermes-maintainer-step-contract');
function r(id,action,target=null){return {contract_version:REQ,request_id:id,action,repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',target_ref:target,simulation:true,production_blocked:true};}
function fixture(){const p=prepareHermesMaintainerPlan({mission_id:'m1',requests:[r('1','repository_read'),r('2','ci_read'),r('3','branch_prepare','feat/x'),r('4','code_edit_prepare','feat/x'),r('5','pull_request_prepare','feat/x')]});return [p,buildHermesMaintainerPlanFingerprint(p).fingerprint];}
test('materializes only preparation steps from a bound plan',()=>{const [p,f]=fixture(),out=prepareHermesMaintainerSteps(p,f);assert.equal(out.ready,true);assert.deepEqual(out.steps.map(s=>s.step_kind),['READ_PREPARATION','CI_READ_PREPARATION','BRANCH_PREPARATION','CODE_EDIT_PREPARATION','PULL_REQUEST_PREPARATION']);assert.equal(validateHermesMaintainerSteps(out).valid,true);assert.ok(out.steps.every(s=>s.executed===false));});
test('fails closed on fingerprint drift',()=>{const [p,f]=fixture();const out=prepareHermesMaintainerSteps({...p,mission_id:'drift'},f);assert.equal(out.ready,false);assert.ok(out.blockers.some(x=>x.includes('mission_id_mismatch')||x.includes('plan_digest_mismatch')));});
test('never turns preparation into operational execution',()=>{const [p,f]=fixture(),out=prepareHermesMaintainerSteps(p,f);assert.equal(out.executed,false);assert.equal(out.network_used,false);assert.equal(out.provider_called,false);assert.equal(out.secret_accessed,false);assert.equal(out.operational_authority_consumed,false);assert.equal(out.production_allowed,false);});
