'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {buildHermesMaintainerModeFoundation}=require('../src/core/hermes-maintainer-mode-foundation');
const {ACTIONS,evaluateHermesMaintainerAction,validateHermesMaintainerActionDecision}=require('../src/core/hermes-maintainer-action-gate');

test('allows every maintainer preparation action without executing it',()=>{
 for(const action of ACTIONS){const d=evaluateHermesMaintainerAction({action}); assert.equal(d.allowed,true,action); assert.equal(d.executed,false); assert.equal(validateHermesMaintainerActionDecision(d).valid,true);}
});
test('fails closed for merge and operational actions',()=>{
 for(const action of ['pull_request_merge','production_deploy','public_web_canary_execute','secret_material_access','provider_call']){const d=evaluateHermesMaintainerAction({action});assert.equal(d.allowed,false,action);assert.equal(d.decision,'DENY');assert.equal(validateHermesMaintainerActionDecision(d).valid,true);}
});
test('fails closed if foundation drifts',()=>{
 const f=buildHermesMaintainerModeFoundation();
 const d=evaluateHermesMaintainerAction({action:'repository_read',foundation:{...f,production_allowed:true}});
 assert.equal(d.allowed,false); assert.ok(d.blockers.length>0);
});
