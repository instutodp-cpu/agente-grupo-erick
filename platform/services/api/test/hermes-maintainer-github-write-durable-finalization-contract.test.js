'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildHermesMaintainerGithubWriteDurableFinalization}=require('../src/core/hermes-maintainer-github-write-durable-finalization-contract');

function receipt(overrides={}){return {contract_version:'hermes_maintainer_github_write_durable_execution_outcome_receipt_v1',status:'GITHUB_WRITE_DURABLE_EXECUTION_OUTCOME_CONFIRMED',receipt_valid:true,outcome_key:'sha256:'+'a'.repeat(64)+'::execution-outcome',outcome_digest:'sha256:'+'a'.repeat(64),intent_digest:'sha256:'+'b'.repeat(64),attempt_reference:'attempt:1',admission_reference:'admission:1',repository:'instutodp-cpu/agente-grupo-erick',operation:'create_branch',ref:'refs/heads/hermes/canary/finalization-test',sha:'c'.repeat(40),provider_status:201,persistence_performed:true,durable:true,network_call_performed:false,write_performed:false,production_used:false,blockers:[],...overrides};}

test('prepares deterministic finalization only from official durable outcome receipt',()=>{
 const a=buildHermesMaintainerGithubWriteDurableFinalization(receipt());
 const b=buildHermesMaintainerGithubWriteDurableFinalization(receipt());
 assert.equal(a.status,'GITHUB_WRITE_DURABLE_FINALIZATION_PREPARED');
 assert.equal(a.finalization_valid,true);
 assert.match(a.finalization_digest,/^sha256:[a-f0-9]{64}$/);
 assert.equal(a.finalization_digest,b.finalization_digest);
 assert.equal(a.durable_outcome_confirmed,true);
 assert.equal(a.persistence_performed,false);
 assert.equal(a.network_call_performed,false);
 assert.equal(a.write_performed,false);
 assert.deepEqual(a.blockers,[]);
});

test('fails closed for non-durable, malformed, or widened outcome scope',()=>{
 for(const patch of [{durable:false},{receipt_valid:false},{operation:'delete_branch'},{repository:'other/repo'},{provider_status:200},{ref:'refs/heads/main'},{outcome_key:'wrong'}]){
  const result=buildHermesMaintainerGithubWriteDurableFinalization(receipt(patch));
  assert.equal(result.finalization_valid,false);
  assert.equal(result.finalization_digest,null);
  assert.equal(result.status,'GITHUB_WRITE_DURABLE_FINALIZATION_BLOCKED');
 }
});

test('finalization remains pure and introduces no new side effect',()=>{
 const result=buildHermesMaintainerGithubWriteDurableFinalization(receipt());
 assert.equal(result.persistence_performed,false);
 assert.equal(result.network_call_performed,false);
 assert.equal(result.write_performed,false);
 assert.equal(result.production_used,false);
});
