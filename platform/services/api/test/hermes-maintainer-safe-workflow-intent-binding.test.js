'use strict';

const assert=require('node:assert/strict');const test=require('node:test');
const {bindHermesMaintainerSafeWorkflowIntent,validateHermesMaintainerSafeWorkflowIntentBinding}=require('../src/core/hermes-maintainer-safe-workflow-intent-binding');
const {buildHermesMaintainerExecutionIntentFingerprint}=require('../src/core/hermes-maintainer-execution-intent-fingerprint');

const digest='sha256:'+'a'.repeat(64);
function handoff(o={}){return {contract_version:'hermes_maintainer_safe_workflow_handoff_v1',mission_id:'m1',workflow_digest:digest,action_count:7,status:'MAINTAINER_SAFE_WORKFLOW_HANDOFF_PREPARED_SIMULATION',handoff_prepared:true,execution_eligible:false,execution_authorized:false,authority_consumed:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:[],...o};}
function intent(o={}){const intents=Array.from({length:7},(_,i)=>({intent_index:i,source_step_index:i,action:'action'+i,step_kind:'KIND',intent_state:'PREPARED_NOT_EXECUTABLE',execution_authorized:false,capability_granted:false,operational_payload_materialized:false}));return {contract_version:'hermes_maintainer_execution_intent_contract_v1',mission_id:'m1',source_admission_contract_version:'hermes_maintainer_step_admission_contract_v1',source_admission_digest:digest,status:'MAINTAINER_EXECUTION_INTENT_PREPARED_SIMULATION',ready:true,intent_count:7,intents,simulation:true,production_allowed:false,execution_authorized:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:[],...o};}

test('binds safe workflow to fingerprinted intent without granting authority',()=>{
 const i=intent(),fp=buildHermesMaintainerExecutionIntentFingerprint(i).fingerprint,b=bindHermesMaintainerSafeWorkflowIntent(handoff(),i,fp);
 assert.equal(b.binding_prepared,true);assert.equal(b.execution_eligible,false);assert.equal(b.execution_authorized,false);assert.equal(b.merge_authority,false);assert.equal(b.human_merge_required,true);
 assert.deepEqual(validateHermesMaintainerSafeWorkflowIntentBinding(b),{valid:true,errors:[]});
});
test('fails closed when mission differs',()=>{
 const i=intent({mission_id:'m2'}),fp=buildHermesMaintainerExecutionIntentFingerprint(i).fingerprint,b=bindHermesMaintainerSafeWorkflowIntent(handoff(),i,fp);
 assert.equal(b.binding_prepared,false);assert.ok(b.blockers.includes('mission_id_mismatch'));assert.equal(b.operational_authority_consumed,false);
});
test('fails closed when action and intent counts differ',()=>{
 const h=handoff({action_count:6}),i=intent(),fp=buildHermesMaintainerExecutionIntentFingerprint(i).fingerprint,b=bindHermesMaintainerSafeWorkflowIntent(h,i,fp);
 assert.equal(b.binding_prepared,false);assert.ok(b.blockers.includes('action_intent_count_mismatch'));assert.equal(b.execution_authorized,false);
});
