'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteOperationalPostgresRuntime}=require('../src/runtime/hermes-maintainer-github-write-operational-postgres-runtime');

const env={POSTGRES_PORT:'5432',POSTGRES_USER:'hermes',POSTGRES_PASSWORD:'synthetic-password',POSTGRES_DB:'hermes',HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'};

test('constructs inert staging runtime from the provisioned postgres environment shape',async()=>{
 let config,ended=0,fetchCalls=0;
 class FakePool{constructor(v){config=v;}connect(){throw new Error('must_not_connect_during_construction');}query(){throw new Error('must_not_query_during_construction');}async end(){ended++;}}
 const runtime=createHermesMaintainerGithubWriteOperationalPostgresRuntime({environment:env,PoolClass:FakePool,fetchImpl:async()=>{fetchCalls++;throw new Error('must_not_fetch_during_construction');},createTimeoutSignal:()=>new AbortController().signal});
 assert.deepEqual(config,{host:'127.0.0.1',port:5432,user:'hermes',password:'synthetic-password',database:'hermes'});
 assert.equal(runtime.runtime_version,'hermes_maintainer_github_write_operational_postgres_runtime_v1');
 assert.equal(runtime.environment,'staging');
 assert.equal(runtime.credential_material_present,false);
 assert.equal(runtime.network_call_performed,false);
 assert.equal(runtime.write_performed,false);
 assert.equal(runtime.production_used,false);
 assert.equal(fetchCalls,0);
 await runtime.close();
 assert.equal(ended,1);
});

test('fails closed for missing or invalid postgres configuration',()=>{
 class FakePool{}
 for(const key of ['POSTGRES_PORT','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DB']){
  const broken={...env};delete broken[key];
  assert.throws(()=>createHermesMaintainerGithubWriteOperationalPostgresRuntime({environment:broken,PoolClass:FakePool}),/postgres_environment_invalid/);
 }
 assert.throws(()=>createHermesMaintainerGithubWriteOperationalPostgresRuntime({environment:{...env,POSTGRES_PORT:'not-a-port'},PoolClass:FakePool}),/postgres_environment_invalid/);
});

test('rejects an invalid pool class before any runtime composition',()=>{
 assert.throws(()=>createHermesMaintainerGithubWriteOperationalPostgresRuntime({environment:env,PoolClass:null}),/postgres_pool_class_required/);
});
