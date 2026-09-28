'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteProcessRuntimeBinding}=require('../src/runtime/hermes-maintainer-github-write-process-runtime-binding');

test('process runtime binding remains inert until explicit execute',()=>{
 let fetchCalls=0;
 let timeoutCalls=0;
 const binding=createHermesMaintainerGithubWriteProcessRuntimeBinding({
  environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},
  fetchImpl:async()=>{fetchCalls++;return {status:201};},
  createTimeoutSignal:()=>{timeoutCalls++;return new AbortController().signal;}
 });
 assert.equal(binding.process_runtime_binding_version,'hermes_maintainer_github_write_process_runtime_binding_v1');
 assert.equal(binding.environment,'staging');
 assert.equal(binding.credential_reference,'github_create_branch_staging');
 assert.equal(binding.credential_material_present,false);
 assert.equal(binding.network_call_performed,false);
 assert.equal(binding.write_performed,false);
 assert.equal(binding.production_used,false);
 assert.equal(typeof binding.execute,'function');
 assert.equal(fetchCalls,0);
 assert.equal(timeoutCalls,0);
});

test('binding requires explicit dependencies and has no fallback path',()=>{
 assert.throws(()=>createHermesMaintainerGithubWriteProcessRuntimeBinding({}),/environment_required/);
 assert.throws(()=>createHermesMaintainerGithubWriteProcessRuntimeBinding({environment:{}}),/fetchImpl_required/);
 assert.throws(()=>createHermesMaintainerGithubWriteProcessRuntimeBinding({environment:{},fetchImpl:async()=>({status:201})}),/createTimeoutSignal_required/);
});
