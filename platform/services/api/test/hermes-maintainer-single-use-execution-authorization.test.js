'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {buildHermesMaintainerSingleUseAuthorization,validateHermesMaintainerSingleUseAuthorization}=require('../src/core/hermes-maintainer-single-use-execution-authorization');
function gate(){return{contract_version:'hermes_maintainer_staging_gate_v1',mission_id:'m1',operation:'repository_read',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',status:'MAINTAINER_STAGING_GATE_PASSED_SIMULATION',staging_gate_passed:true,real_execution_enabled:false,production_enabled:false,network_enabled:false,credentials_enabled:false,write_enabled:false,simulation:true,blockers:[]};}
const input={authorization_id:'auth-1',issued_at:'2026-09-24T16:00:00.000Z',expires_at:'2026-09-24T16:15:00.000Z'};
test('creates scoped single-use staging authorization without execution',()=>{const a=buildHermesMaintainerSingleUseAuthorization(gate(),input);assert.equal(a.execution_authorized,true);assert.equal(a.single_use,true);assert.equal(a.executed,false);assert.equal(validateHermesMaintainerSingleUseAuthorization(a).valid,true);});
test('blocked staging gate cannot authorize',()=>{const a=buildHermesMaintainerSingleUseAuthorization({...gate(),status:'MAINTAINER_STAGING_GATE_BLOCKED',staging_gate_passed:false,blockers:['x']},input);assert.equal(a.execution_authorized,false);});
test('invalid time window fails closed',()=>{const a=buildHermesMaintainerSingleUseAuthorization(gate(),{...input,expires_at:input.issued_at});assert.equal(a.execution_authorized,false);});
test('fingerprint drift is rejected',()=>{const a=buildHermesMaintainerSingleUseAuthorization(gate(),input);assert.equal(validateHermesMaintainerSingleUseAuthorization({...a,repository:'other'}).valid,false);});
test('validator rejects premature consumption',()=>{const a=buildHermesMaintainerSingleUseAuthorization(gate(),input);assert.equal(validateHermesMaintainerSingleUseAuthorization({...a,consumed:true}).valid,false);});
