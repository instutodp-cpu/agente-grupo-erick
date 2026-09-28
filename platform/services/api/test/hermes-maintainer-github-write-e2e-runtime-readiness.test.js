'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {checkHermesMaintainerGithubWriteE2eRuntimeReadiness}=require('../src/runtime/hermes-maintainer-github-write-e2e-runtime-readiness');

const env={POSTGRES_PORT:'5432',POSTGRES_USER:'u',POSTGRES_PASSWORD:'p',POSTGRES_DB:'d',HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'};

test('e2e readiness is inert, ready, and closes its pool',async()=>{
 let ended=0,fetchCalls=0;
 class FakePool{async query(){throw new Error('must remain inert');}connect(){throw new Error('must remain inert');}async end(){ended++;}}
 const result=await checkHermesMaintainerGithubWriteE2eRuntimeReadiness({environment:env,PoolClass:FakePool,fetchImpl:async()=>{fetchCalls++;},createTimeoutSignal:()=>new AbortController().signal});
 assert.equal(result.status,'READY');assert.equal(result.ready,true);assert.equal(result.environment,'staging');
 assert.equal(result.credential_reference,'github_create_branch_staging');
 assert.equal(result.credential_material_present,false);assert.equal(result.network_call_performed,false);assert.equal(result.write_performed,false);assert.equal(result.production_used,false);
 assert.equal(fetchCalls,0);assert.equal(ended,1);
});

test('e2e readiness fails closed when process runtime cannot be created',async()=>{
 const result=await checkHermesMaintainerGithubWriteE2eRuntimeReadiness({environment:env,fetchImpl:null});
 assert.equal(result.status,'BLOCKED');assert.equal(result.ready,false);
 assert.equal(result.reason,'E2E_PROCESS_RUNTIME_UNAVAILABLE');
 assert.equal(result.network_call_performed,false);assert.equal(result.write_performed,false);assert.equal(result.production_used,false);
});
