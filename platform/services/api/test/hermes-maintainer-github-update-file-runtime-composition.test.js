'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubUpdateFileRuntimeComposition}=require('../src/runtime/hermes-maintainer-github-update-file-runtime-composition');

const digest='sha256:'+'1'.repeat(64);
function admission(overrides={}){
 return {
  contract_version:'hermes_maintainer_github_update_file_durable_admission_v1',
  status:'GITHUB_UPDATE_FILE_DURABLE_REQUEST_ADMITTED',admission_valid:true,execution_authorized:true,
  provider:'GITHUB',operation:'update_file',repository:'instutodp-cpu/agente-grupo-erick',
  ownership_source:'DURABLE_PERSISTENCE_RECEIPT',persistence_key:'persist-1',
  ownership_key:'persist-1::attempt-ownership',intent_digest:digest,attempt_reference:'attempt-1',
  capability_reference:'cap-1',admission_reference:'admission-1',
  request:{method:'PUT',url:'https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/contents/docs/a.md',body:{message:'docs: controlled change',content:'eA==',sha:'a'.repeat(40),branch:'hermes/content-write'}},
  credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,...overrides
 };
}
const signal=()=>new AbortController().signal;
test('binds isolated update-file credential to transport and durable boundary',async()=>{
 let seen;
 const composition=createHermesMaintainerGithubUpdateFileRuntimeComposition({
  environment:{HERMES_GITHUB_UPDATE_FILE_STAGING_TOKEN:'opaque-update-token'},
  createTimeoutSignal:signal,
  fetchImpl:async(url,options)=>{seen={url,options};return {status:200,json:async()=>({content:{sha:'b'.repeat(40)},commit:{sha:'c'.repeat(40)}})};}
 });
 const out=await composition.execute(admission());
 assert.equal(out.status,'GITHUB_UPDATE_FILE_DURABLE_EXECUTION_SUCCEEDED');
 assert.equal(out.write_performed,true);
 assert.equal(out.provider_status,200);
 assert.equal(out.new_blob_sha,'b'.repeat(40));
 assert.equal(out.commit_sha,'c'.repeat(40));
 assert.equal(composition.credential_reference,'github_update_file_hermes_branch_staging');
 assert.equal(seen.options.headers.Authorization,'Bearer opaque-update-token');
 assert.equal(JSON.stringify(out).includes('opaque-update-token'),false);
 assert.equal(out.production_used,false);
});
test('create-branch credential cannot authorize update-file runtime',async()=>{
 let calls=0;
 const composition=createHermesMaintainerGithubUpdateFileRuntimeComposition({
  environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'create-only'},
  createTimeoutSignal:signal,fetchImpl:async()=>{calls++;return {status:200};}
 });
 const out=await composition.execute(admission());
 assert.equal(calls,0);
 assert.equal(out.write_performed,false);
 assert.equal(out.status,'GITHUB_UPDATE_FILE_DURABLE_EXECUTION_FAILED');
});
test('invalid durable admission blocks before credential resolution and fetch',async()=>{
 let calls=0;
 const environment={};
 Object.defineProperty(environment,'HERMES_GITHUB_UPDATE_FILE_STAGING_TOKEN',{get(){throw new Error('credential_must_not_be_read');}});
 const composition=createHermesMaintainerGithubUpdateFileRuntimeComposition({environment,createTimeoutSignal:signal,fetchImpl:async()=>{calls++;return {status:200};}});
 const out=await composition.execute(admission({execution_authorized:false}));
 assert.equal(calls,0);
 assert.equal(out.status,'GITHUB_UPDATE_FILE_DURABLE_EXECUTION_BLOCKED');
 assert.equal(out.network_call_performed,false);
 assert.equal(out.write_performed,false);
});
test('construction is inert and requires explicit runtime dependencies',()=>{
 assert.throws(()=>createHermesMaintainerGithubUpdateFileRuntimeComposition({environment:{},createTimeoutSignal:signal}),/fetchImpl_required/);
 assert.throws(()=>createHermesMaintainerGithubUpdateFileRuntimeComposition({environment:{},fetchImpl:async()=>({})}),/createTimeoutSignal_required/);
 let reads=0;const environment={};Object.defineProperty(environment,'HERMES_GITHUB_UPDATE_FILE_STAGING_TOKEN',{get(){reads++;return 'opaque';}});
 const composition=createHermesMaintainerGithubUpdateFileRuntimeComposition({environment,fetchImpl:async()=>({}),createTimeoutSignal:signal});
 assert.equal(composition.network_call_performed,false);assert.equal(composition.write_performed,false);assert.equal(composition.production_used,false);assert.equal(reads,0);
});
