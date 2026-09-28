'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteDurableExecutionOutcomeReceipt}=require('../src/core/hermes-maintainer-github-write-durable-execution-outcome-receipt');

const digest='sha256:'+'a'.repeat(64);
function request(overrides={}){return {contract_version:'hermes_maintainer_github_write_execution_outcome_persistence_contract_v1',status:'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_REQUEST_PREPARED',request_valid:true,persistence_operation:'CREATE_IF_ABSENT',outcome_key:digest+'::execution-outcome',outcome_digest:digest,intent_digest:'sha256:'+'b'.repeat(64),attempt_reference:'attempt:1',admission_reference:'admission:1',repository:'instutodp-cpu/agente-grupo-erick',operation:'create_branch',ref:'refs/heads/hermes/canary/receipt-test',sha:'c'.repeat(40),provider_status:201,atomic_create_if_absent_required:true,durable_confirmation_required:true,persistence_performed:false,durable:false,network_call_performed:false,write_performed:false,production_used:false,blockers:[],...overrides};}
function result(overrides={}){return {contract_version:'hermes_maintainer_github_write_execution_outcome_persistence_adapter_v1',status:'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_CREATED',adapter_valid:true,persistence_performed:true,durable:true,created:true,network_call_performed:false,write_performed:false,production_used:false,blockers:[],...overrides};}

test('confirms exact durable execution outcome from official request and created adapter result',()=>{
 const receipt=createHermesMaintainerGithubWriteDurableExecutionOutcomeReceipt(request(),result());
 assert.equal(receipt.status,'GITHUB_WRITE_DURABLE_EXECUTION_OUTCOME_CONFIRMED');
 assert.equal(receipt.receipt_valid,true);
 assert.equal(receipt.outcome_key,digest+'::execution-outcome');
 assert.equal(receipt.outcome_digest,digest);
 assert.equal(receipt.repository,'instutodp-cpu/agente-grupo-erick');
 assert.equal(receipt.operation,'create_branch');
 assert.equal(receipt.provider_status,201);
 assert.equal(receipt.persistence_performed,true);
 assert.equal(receipt.durable,true);
 assert.equal(receipt.network_call_performed,false);
 assert.equal(receipt.write_performed,false);
 assert.deepEqual(receipt.blockers,[]);
});

test('fails closed when persistence was duplicate, failed, or not durable',()=>{
 for(const patch of [{status:'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_EXISTS',created:false,durable:false},{status:'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_FAILED',adapter_valid:false,created:false,durable:false},{durable:false}]){
  const receipt=createHermesMaintainerGithubWriteDurableExecutionOutcomeReceipt(request(),result(patch));
  assert.equal(receipt.receipt_valid,false);
  assert.equal(receipt.durable,false);
  assert.equal(receipt.outcome_digest,null);
 }
});

test('fails closed for invalid request identity or side-effect state',()=>{
 for(const pair of [[request({outcome_key:'wrong'}),result()],[request({request_valid:false}),result()],[request(),result({network_call_performed:true})],[request(),result({write_performed:true})]]){
  const receipt=createHermesMaintainerGithubWriteDurableExecutionOutcomeReceipt(pair[0],pair[1]);
  assert.equal(receipt.receipt_valid,false);
  assert.equal(receipt.status,'GITHUB_WRITE_DURABLE_EXECUTION_OUTCOME_BLOCKED');
 }
});
