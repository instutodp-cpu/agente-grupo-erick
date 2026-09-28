'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteE2ePostgresRuntime}=require('../src/runtime/hermes-maintainer-github-write-e2e-postgres-runtime');

test('e2e postgres runtime construction is inert and binds the durable closure',async()=>{
 let poolConstructed=0,ended=0,fetchCalls=0;
 class FakePool{constructor(config){poolConstructed++;this.config=config;}async end(){ended++;}connect(){throw new Error('must remain inert');}}
 const runtime=createHermesMaintainerGithubWriteE2ePostgresRuntime({environment:{POSTGRES_PORT:'5432',POSTGRES_USER:'u',POSTGRES_PASSWORD:'p',POSTGRES_DB:'d',HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},PoolClass:FakePool,fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 assert.equal(runtime.runtime_version,'hermes_maintainer_github_write_e2e_postgres_runtime_v1');
 assert.equal(runtime.environment,'staging');assert.equal(runtime.credential_reference,'github_create_branch_staging');
 assert.equal(runtime.credential_material_present,false);assert.equal(runtime.network_call_performed,false);assert.equal(runtime.write_performed,false);assert.equal(runtime.production_used,false);
 assert.equal(typeof runtime.execute,'function');assert.equal(poolConstructed,1);assert.equal(fetchCalls,0);
 await runtime.close();assert.equal(ended,1);
});

test('e2e postgres runtime fails closed on missing postgres environment',()=>{
 class FakePool{}
 assert.throws(()=>createHermesMaintainerGithubWriteE2ePostgresRuntime({environment:{},PoolClass:FakePool,fetchImpl:async()=>({status:201}),createTimeoutSignal:()=>new AbortController().signal}),/postgres_environment_invalid/);
});
