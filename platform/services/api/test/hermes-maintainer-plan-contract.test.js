'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {CONTRACT_VERSION:REQ}=require('../src/core/hermes-maintainer-request-contract');
const {prepareHermesMaintainerPlan,validateHermesMaintainerPlan}=require('../src/core/hermes-maintainer-plan-contract');
function r(action,target=null,id=action){return {contract_version:REQ,request_id:id,action,repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',target_ref:target,simulation:true,production_blocked:true};}
test('prepares ordered development plan without executing',()=>{const p=prepareHermesMaintainerPlan({mission_id:'m1',requests:[r('repository_read'),r('ci_read'),r('branch_prepare','feat/x'),r('code_edit_prepare','feat/x'),r('pull_request_prepare','feat/x')]});assert.equal(p.ready,true);assert.equal(p.executed,false);assert.equal(validateHermesMaintainerPlan(p).valid,true);});
test('blocks out-of-order plans',()=>{const p=prepareHermesMaintainerPlan({mission_id:'m1',requests:[r('branch_prepare','feat/x'),r('repository_read')]});assert.equal(p.ready,false);assert.ok(p.blockers.includes('request_1::action_order_invalid'));});
test('blocks operational action transitively',()=>{const p=prepareHermesMaintainerPlan({mission_id:'m1',requests:[r('public_web_canary_execute')]});assert.equal(p.ready,false);assert.equal(p.network_used,false);assert.equal(p.operational_authority_consumed,false);});
test('blocks empty plans and missing mission identity',()=>{const p=prepareHermesMaintainerPlan({requests:[]});assert.equal(p.ready,false);assert.ok(p.blockers.includes('mission_id_invalid'));assert.ok(p.blockers.includes('requests_required'));});
