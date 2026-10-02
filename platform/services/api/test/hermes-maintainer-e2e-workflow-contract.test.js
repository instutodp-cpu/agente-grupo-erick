'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {STEPS,buildHermesMaintainerE2eWorkflowContract,validateHermesMaintainerE2eWorkflowContract}=require('../src/core/hermes-maintainer-e2e-workflow-contract');
test('defines read branch edit test draft-pr in strict order',()=>{assert.deepEqual(STEPS.map(x=>x.action),['repository_read','branch_prepare','code_edit_prepare','test_execution','pull_request_prepare']);assert.equal(STEPS[4].draft_required,true);});
test('fails closed as not execution ready until operational test composition exists',()=>{const v=buildHermesMaintainerE2eWorkflowContract();assert.equal(v.execution_ready,false);assert.deepEqual(v.blockers,['test_execution_operational_composition_missing']);assert.equal(v.merge_authority,false);assert.equal(v.human_merge_required,true);assert.deepEqual(validateHermesMaintainerE2eWorkflowContract(v),{valid:true,errors:[]});});
