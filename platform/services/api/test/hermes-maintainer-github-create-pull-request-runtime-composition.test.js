'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {COMPOSITION_VERSION,createHermesMaintainerGithubCreatePullRequestRuntimeComposition}=require('../src/runtime/hermes-maintainer-github-create-pull-request-runtime-composition');

const request={method:'POST',url:'https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/pulls',body:{base:'main',head:'hermes/test-branch',draft:true,title:'Hermes test',body:'staging'},intent_digest:'sha256:'+'a'.repeat(64),attempt_reference:'attempt-1',capability_reference:'github_create_pull_request_hermes_branch_staging',admission_reference:'admission-1'};
const admission={contract_version:'hermes_maintainer_github_create_pull_request_durable_admission_v1',status:'GITHUB_CREATE_PULL_REQUEST_DURABLE_REQUEST_ADMITTED',admission_valid:true,execution_authorized:true,ownership_source:'DURABLE_PERSISTENCE_RECEIPT',provider:'GITHUB',operation:'create_pull_request',repository:'instutodp-cpu/agente-grupo-erick',base:'main',head:'hermes/test-branch',draft:true,ownership_key:'persist-1::attempt-ownership',persistence_key:'persist-1',intent_digest:request.intent_digest,attempt_reference:'attempt-1',capability_reference:'github_create_pull_request_hermes_branch_staging',admission_reference:'admission-1',request,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false};

test('composes isolated credential, transport and durable boundary',async()=>{
 let calls=0;
 const c=createHermesMaintainerGithubCreatePullRequestRuntimeComposition({
  environment:{HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN:'opaque-pr-token'},
  createTimeoutSignal:()=>({aborted:false}),
  fetchImpl:async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer opaque-pr-token');return {status:201,json:async()=>({number:435,html_url:'https://github.com/instutodp-cpu/agente-grupo-erick/pull/435',draft:true})};}
 });
 assert.equal(c.composition_version,COMPOSITION_VERSION);assert.equal(c.credential_material_present,false);assert.equal(c.network_call_performed,false);assert.equal(c.write_performed,false);assert.equal(c.production_used,false);
 const out=await c.execute(admission);
 assert.equal(out.status,'GITHUB_CREATE_PULL_REQUEST_DURABLE_EXECUTION_SUCCEEDED');assert.equal(out.write_performed,true);assert.equal(out.pull_request_number,435);assert.equal(calls,1);
});

test('blocks before credential resolution and network on invalid durable admission',async()=>{
 let reads=0,calls=0;const environment={};Object.defineProperty(environment,'HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN',{get(){reads++;return 'opaque';}});
 const c=createHermesMaintainerGithubCreatePullRequestRuntimeComposition({environment,createTimeoutSignal:()=>({aborted:false}),fetchImpl:async()=>{calls++;}});
 const out=await c.execute({...admission,execution_authorized:false});
 assert.equal(out.status,'GITHUB_CREATE_PULL_REQUEST_DURABLE_EXECUTION_BLOCKED');assert.equal(reads,0);assert.equal(calls,0);
});

test('construction is inert',()=>{
 let reads=0;const environment={};Object.defineProperty(environment,'HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN',{get(){reads++;return 'opaque';}});
 const c=createHermesMaintainerGithubCreatePullRequestRuntimeComposition({environment,fetchImpl:async()=>{},createTimeoutSignal:()=>({aborted:false})});
 assert.equal(reads,0);assert.equal(c.network_call_performed,false);assert.equal(c.write_performed,false);
});
