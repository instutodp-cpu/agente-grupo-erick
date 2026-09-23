'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {ACTIONS}=require('../src/core/hermes-maintainer-action-gate');
const {CONTRACT_VERSION,validateHermesMaintainerRequest,evaluateHermesMaintainerRequest}=require('../src/core/hermes-maintainer-request-contract');
function req(action){return {contract_version:CONTRACT_VERSION,request_id:'req-1',action,repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',target_ref:['branch_prepare','code_edit_prepare','pull_request_prepare'].includes(action)?'feat/example':null,simulation:true,production_blocked:true};}
test('all declared maintainer actions form valid simulation requests',()=>{for(const action of ACTIONS){const r=req(action);assert.equal(validateHermesMaintainerRequest(r).valid,true,action);const d=evaluateHermesMaintainerRequest(r);assert.equal(d.allowed,true,action);assert.equal(d.executed,false);}});
test('unknown and operational actions fail closed',()=>{for(const action of ['pull_request_merge','public_web_canary_execute','secret_material_access']){const r={...req('repository_read'),action};assert.equal(evaluateHermesMaintainerRequest(r).allowed,false,action);}});
test('write-preparation actions require an explicit target ref',()=>{const r={...req('branch_prepare'),target_ref:null};const v=validateHermesMaintainerRequest(r);assert.equal(v.valid,false);assert.ok(v.errors.includes('target_ref_required'));});
test('read/test requests reject target ref drift',()=>{const r={...req('repository_read'),target_ref:'main'};assert.equal(validateHermesMaintainerRequest(r).valid,false);});
test('production or non-simulation requests fail closed',()=>{assert.equal(evaluateHermesMaintainerRequest({...req('ci_read'),simulation:false}).allowed,false);assert.equal(evaluateHermesMaintainerRequest({...req('ci_read'),production_blocked:false}).allowed,false);});
