'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {CONTRACT_VERSION:REQ}=require('../src/core/hermes-maintainer-request-contract');
const {prepareHermesMaintainerPlan}=require('../src/core/hermes-maintainer-plan-contract');
const {buildHermesMaintainerPlanFingerprint,validateHermesMaintainerPlanFingerprint,verifyHermesMaintainerPlanFingerprint}=require('../src/core/hermes-maintainer-plan-fingerprint');
function r(id,action,target=null){return {contract_version:REQ,request_id:id,action,repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',target_ref:target,simulation:true,production_blocked:true};}
function plan(){return prepareHermesMaintainerPlan({mission_id:'maintain-1',requests:[r('r1','repository_read'),r('r2','ci_read'),r('r3','branch_prepare','feat/x')]});}
test('fingerprints a ready plan deterministically',()=>{const a=buildHermesMaintainerPlanFingerprint(plan()),b=buildHermesMaintainerPlanFingerprint(plan());assert.equal(a.fingerprint.plan_digest,b.fingerprint.plan_digest);assert.equal(validateHermesMaintainerPlanFingerprint(a.fingerprint).valid,true);assert.equal(verifyHermesMaintainerPlanFingerprint(plan(),a.fingerprint).valid,true);assert.equal(a.executed,false);});
test('detects plan drift',()=>{const p=plan(),built=buildHermesMaintainerPlanFingerprint(p);const drift={...p,mission_id:'maintain-2'};const v=verifyHermesMaintainerPlanFingerprint(drift,built.fingerprint);assert.equal(v.valid,false);assert.ok(v.errors.includes('mission_id_mismatch')||v.errors.includes('plan_digest_mismatch'));});
test('blocks non-ready plan',()=>{const p=prepareHermesMaintainerPlan({mission_id:'x',requests:[r('r1','public_web_canary_execute')]});const out=buildHermesMaintainerPlanFingerprint(p);assert.equal(out.status,'MAINTAINER_PLAN_FINGERPRINT_BLOCKED');assert.equal(out.fingerprint,null);assert.equal(out.network_used,false);});
