'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteCanaryRuntimeRunner}=require('../src/runtime/hermes-maintainer-github-write-canary-runtime-runner');

test('runner construction is inert and exposes only guarded execution',()=>{
 let fetchCalls=0;
 let timeoutCalls=0;
 const runner=createHermesMaintainerGithubWriteCanaryRuntimeRunner({
  environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},
  fetchImpl:async()=>{fetchCalls++;return {status:201};},
  createTimeoutSignal:()=>{timeoutCalls++;return new AbortController().signal;}
 });
 assert.equal(runner.runner_version,'hermes_maintainer_github_write_canary_runtime_runner_v1');
 assert.equal(runner.environment,'staging');
 assert.equal(runner.credential_reference,'github_create_branch_staging');
 assert.equal(runner.credential_material_present,false);
 assert.equal(runner.network_call_performed,false);
 assert.equal(runner.write_performed,false);
 assert.equal(runner.production_used,false);
 assert.equal(typeof runner.execute,'function');
 assert.equal(fetchCalls,0);
 assert.equal(timeoutCalls,0);
});

test('runner fails closed before runtime when canary or admission is not official',async()=>{
 let fetchCalls=0;
 const runner=createHermesMaintainerGithubWriteCanaryRuntimeRunner({
  environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},
  fetchImpl:async()=>{fetchCalls++;return {status:201};},
  createTimeoutSignal:()=>new AbortController().signal
 });
 const result=await runner.execute({contract_version:'wrong'},{contract_version:'wrong'});
 assert.equal(result.status,'CANARY_EXECUTION_BLOCKED');
 assert.equal(result.execution_performed,false);
 assert.equal(result.network_call_performed,false);
 assert.equal(result.write_performed,false);
 assert.equal(fetchCalls,0);
});

test('runner requires explicit dependencies and never falls back to globals',()=>{
 assert.throws(()=>createHermesMaintainerGithubWriteCanaryRuntimeRunner({}),/environment_required/);
 assert.throws(()=>createHermesMaintainerGithubWriteCanaryRuntimeRunner({environment:{}}),/fetchImpl_required/);
 assert.throws(()=>createHermesMaintainerGithubWriteCanaryRuntimeRunner({environment:{},fetchImpl:async()=>({status:201})}),/createTimeoutSignal_required/);
});
