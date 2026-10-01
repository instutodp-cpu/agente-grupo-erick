'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {prepareHermesMaintainerSafeWorkflow,validateHermesMaintainerSafeWorkflow,EXPECTED_ACTIONS}=require('../src/core/hermes-maintainer-safe-workflow-contract');

function admission(overrides={}){
 return {
  contract_version:'hermes_maintainer_step_admission_contract_v1',
  mission_id:'mission-safe-workflow',
  source_contract_version:'hermes_maintainer_step_contract_v1',
  status:'MAINTAINER_STEPS_ADMITTED_SIMULATION',admitted:true,step_count:EXPECTED_ACTIONS.length,
  admitted_steps:EXPECTED_ACTIONS.map((action,step_index)=>({step_index,action,step_kind:['READ_PREPARATION','SEARCH_PREPARATION','CI_READ_PREPARATION','TEST_PREPARATION','BRANCH_PREPARATION','CODE_EDIT_PREPARATION','PULL_REQUEST_PREPARATION'][step_index]})),
  simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:[],
  ...overrides
 };
}
test('prepares only the complete safe workflow and keeps merge human-only',()=>{
 const result=prepareHermesMaintainerSafeWorkflow(admission());
 assert.equal(result.ready,true);
 assert.equal(result.merge_authority,false);
 assert.equal(result.human_merge_required,true);
 assert.equal(result.executed,false);
 assert.equal(result.operational_authority_consumed,false);
 assert.deepEqual(validateHermesMaintainerSafeWorkflow(result),{valid:true,errors:[]});
});
test('fails closed when workflow is incomplete',()=>{
 const source=admission();
 source.admitted_steps=source.admitted_steps.slice(0,-1); source.step_count=source.admitted_steps.length;
 const result=prepareHermesMaintainerSafeWorkflow(source);
 assert.equal(result.ready,false);
 assert.ok(result.blockers.includes('workflow_action_count_invalid'));
});
test('fails closed when admission is not admitted',()=>{
 const result=prepareHermesMaintainerSafeWorkflow(admission({status:'MAINTAINER_STEPS_ADMISSION_BLOCKED',admitted:false,blockers:['blocked']}));
 assert.equal(result.ready,false);
 assert.ok(result.blockers.includes('steps_not_admitted'));
});
