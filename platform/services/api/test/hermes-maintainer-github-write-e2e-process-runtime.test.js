'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteE2eProcessRuntime}=require('../src/runtime/hermes-maintainer-github-write-e2e-process-runtime');

const env={POSTGRES_PORT:'5432',POSTGRES_USER:'u',POSTGRES_PASSWORD:'p',POSTGRES_DB:'d',HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'};

test('e2e process runtime is inert and preserves execute and close',async()=>{
 let ended=0,fetchCalls=0;
 class FakePool{async query(){throw new Error('must remain inert');}connect(){throw new Error('must remain inert');}async end(){ended++;}}
 const runtime=createHermesMaintainerGithubWriteE2eProcessRuntime({environment:env,PoolClass:FakePool,fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 assert.equal(runtime.process_runtime_version,'hermes_maintainer_github_write_e2e_process_runtime_v1');
 assert.equal(runtime.environment,'staging');assert.equal(runtime.credential_reference,'github_create_branch_staging');
 assert.equal(runtime.credential_material_present,false);assert.equal(runtime.network_call_performed,false);assert.equal(runtime.write_performed,false);assert.equal(runtime.production_used,false);
 assert.equal(typeof runtime.execute,'function');assert.equal(typeof runtime.close,'function');assert.equal(fetchCalls,0);
 await runtime.close();assert.equal(ended,1);
});

test('e2e process runtime fails closed without fetch',()=>{
 class FakePool{async query(){throw new Error('must remain inert');}connect(){throw new Error('must remain inert');}async end(){}}
 assert.throws(()=>createHermesMaintainerGithubWriteE2eProcessRuntime({environment:env,PoolClass:FakePool,fetchImpl:null,createTimeoutSignal:()=>new AbortController().signal}),/global_fetch_unavailable/);
});
