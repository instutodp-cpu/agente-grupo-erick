'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildHermesMaintainerGithubWriteFinalizationPersistenceRequest}=require('../src/core/hermes-maintainer-github-write-finalization-persistence-contract');

function finalization(overrides={}){return {contract_version:'hermes_maintainer_github_write_durable_finalization_contract_v1',status:'GITHUB_WRITE_DURABLE_FINALIZATION_PREPARED',finalization_valid:true,finalization_digest:'sha256:'+'a'.repeat(64),outcome_digest:'sha256:'+'b'.repeat(64),intent_digest:'sha256:'+'c'.repeat(64),attempt_reference:'attempt:1',admission_reference:'admission:1',repository:'instutodp-cpu/agente-grupo-erick',operation:'create_branch',ref:'refs/heads/hermes/canary/finalization-persistence-test',sha:'d'.repeat(40),provider_status:201,durable_outcome_confirmed:true,persistence_performed:false,network_call_performed:false,write_performed:false,production_used:false,blockers:[],...overrides};}

test('prepares atomic create-if-absent request for official finalization',()=>{
 const request=buildHermesMaintainerGithubWriteFinalizationPersistenceRequest(finalization());
 assert.equal(request.status,'GITHUB_WRITE_FINALIZATION_PERSISTENCE_REQUEST_PREPARED');
 assert.equal(request.request_valid,true);
 assert.equal(request.persistence_operation,'CREATE_IF_ABSENT');
 assert.equal(request.finalization_key,'sha256:'+'a'.repeat(64)+'::write-finalization');
 assert.equal(request.atomic_create_if_absent_required,true);
 assert.equal(request.durable_confirmation_required,true);
 assert.equal(request.persistence_performed,false);
 assert.equal(request.durable,false);
 assert.equal(request.network_call_performed,false);
 assert.equal(request.write_performed,false);
 assert.deepEqual(request.blockers,[]);
});

test('fails closed for invalid digest, scope, target, or finalization state',()=>{
 for(const patch of [{finalization_valid:false},{finalization_digest:'bad'},{operation:'delete_branch'},{repository:'other/repo'},{provider_status:200},{ref:'refs/heads/main'},{durable_outcome_confirmed:false},{persistence_performed:true}]){
  const request=buildHermesMaintainerGithubWriteFinalizationPersistenceRequest(finalization(patch));
  assert.equal(request.request_valid,false);
  assert.equal(request.finalization_key,null);
  assert.equal(request.status,'GITHUB_WRITE_FINALIZATION_PERSISTENCE_REQUEST_BLOCKED');
 }
});

test('persistence request remains pre-side-effect',()=>{
 const request=buildHermesMaintainerGithubWriteFinalizationPersistenceRequest(finalization());
 assert.equal(request.persistence_performed,false);
 assert.equal(request.network_call_performed,false);
 assert.equal(request.write_performed,false);
 assert.equal(request.production_used,false);
});
