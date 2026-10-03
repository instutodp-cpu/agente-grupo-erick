'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {prepareHermesMaintainerTrustedE2eControlledExecutions}=require('../src/runtime/hermes-maintainer-trusted-e2e-controlled-execution-composition');
test('prepares three mutation controlled executions from one safe workflow identity without authority',()=>{
 const x=prepareHermesMaintainerTrustedE2eControlledExecutions({mission_id:'trusted-e2e-canary-001',branch_name:'hermes/canary/e2e-001'});
 assert.equal(x.prepared,true);
 const values=Object.values(x.controlled_executions); assert.equal(values.length,3);
 assert.deepEqual(values.map(v=>v.operation),['branch_prepare','code_edit_prepare','pull_request_prepare']);
 for(const v of values){assert.equal(v.mission_id,x.mission_id);assert.equal(v.workflow_digest,x.workflow_digest);assert.equal(v.intent_digest,x.intent_digest);assert.equal(v.authorization_binding_digest,x.authorization_binding_digest);assert.equal(v.execution_authorized,false);assert.equal(v.write_authorized,false);assert.equal(v.merge_authority,false);assert.equal(v.human_merge_required,true);}
});
test('rejects branch outside dedicated canary scope',()=>{const x=prepareHermesMaintainerTrustedE2eControlledExecutions({mission_id:'m1',branch_name:'hermes/feature'});assert.equal(x.prepared,false);assert.equal(x.stage,'BRANCH_SCOPE_INVALID');});
test('rejects missing mission identity',()=>{const x=prepareHermesMaintainerTrustedE2eControlledExecutions({branch_name:'hermes/canary/e2e'});assert.equal(x.prepared,false);assert.equal(x.stage,'MISSION_ID_INVALID');});