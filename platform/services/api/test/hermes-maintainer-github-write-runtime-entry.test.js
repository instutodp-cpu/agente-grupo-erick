'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteRuntimeEntry}=require('../src/runtime/hermes-maintainer-github-write-runtime-entry');

test('write runtime entry is inert until execute is explicitly called',()=>{
 let networkCalls=0;
 const entry=createHermesMaintainerGithubWriteRuntimeEntry({
  environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},
  fetchImpl:async()=>{networkCalls++;return {status:201};},
  createTimeoutSignal:()=>new AbortController().signal
 });
 assert.equal(entry.runtime_entry_version,'hermes_maintainer_github_write_runtime_entry_v1');
 assert.equal(entry.environment,'staging');
 assert.equal(entry.credential_reference,'github_create_branch_staging');
 assert.equal(entry.credential_material_present,false);
 assert.equal(entry.network_call_performed,false);
 assert.equal(entry.write_performed,false);
 assert.equal(entry.production_used,false);
 assert.equal(typeof entry.execute,'function');
 assert.equal(networkCalls,0);
});

test('write runtime entry requires explicit dependencies and never falls back to globals',()=>{
 assert.throws(()=>createHermesMaintainerGithubWriteRuntimeEntry({}),/environment_required/);
 assert.throws(()=>createHermesMaintainerGithubWriteRuntimeEntry({environment:{}}),/fetchImpl_required/);
 assert.throws(()=>createHermesMaintainerGithubWriteRuntimeEntry({environment:{},fetchImpl:async()=>({status:201})}),/createTimeoutSignal_required/);
});
