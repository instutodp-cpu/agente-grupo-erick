'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubDurableWriteRuntimeComposition}=require('../src/runtime/hermes-maintainer-github-durable-write-runtime-composition');

const admission=()=>({
 contract_version:'hermes_maintainer_github_durable_write_admission_v1',
 status:'GITHUB_DURABLE_WRITE_REQUEST_ADMITTED',
 admission_valid:true,
 execution_authorized:true,
 ownership_source:'DURABLE_PERSISTENCE_RECEIPT',
 ownership_key:'persist-1::attempt-ownership',
 persistence_key:'persist-1',
 provider:'GITHUB',
 operation:'create_branch',
 repository:'instutodp-cpu/agente-grupo-erick',
 request:{method:'POST',url:'https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/git/refs',body:{ref:'refs/heads/hermes/runtime-composition-proof',sha:'a'.repeat(40)}},
 intent_digest:'sha256:'+'1'.repeat(64),
 attempt_reference:'attempt-1',
 capability_reference:'cap-1',
 admission_reference:'admission-1',
 credential_material_present:false,
 network_call_performed:false,
 write_performed:false,
 production_used:false
});

const deps=(fetchImpl)=>({
 environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-write-token'},
 fetchImpl,
 createTimeoutSignal:()=>new AbortController().signal
});

test('composition wires durable boundary credential resolution and transport with injected dependencies',async()=>{
 let calls=0;
 const runtime=createHermesMaintainerGithubDurableWriteRuntimeComposition(deps(async(url,options)=>{
  calls++;
  assert.equal(url,'https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/git/refs');
  assert.equal(options.method,'POST');
  assert.equal(options.headers.Authorization,'Bearer synthetic-write-token');
  assert.deepEqual(JSON.parse(options.body),admission().request.body);
  return {status:201};
 }));
 const out=await runtime.execute(admission());
 assert.equal(calls,1);
 assert.equal(out.status,'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED');
 assert.equal(out.write_performed,true);
 assert.equal(out.network_call_performed,true);
 assert.equal(out.production_used,false);
});

test('invalid admission fails before credential or network use',async()=>{
 let calls=0;
 const runtime=createHermesMaintainerGithubDurableWriteRuntimeComposition(deps(async()=>{calls++;return {status:201};}));
 const input=admission(); input.request.body.ref='refs/heads/main';
 const out=await runtime.execute(input);
 assert.equal(calls,0);
 assert.equal(out.status,'GITHUB_DURABLE_WRITE_EXECUTION_BLOCKED');
 assert.equal(out.write_performed,false);
});

test('missing credential fails closed before network',async()=>{
 let calls=0;
 const runtime=createHermesMaintainerGithubDurableWriteRuntimeComposition({
  environment:{},
  fetchImpl:async()=>{calls++;return {status:201};},
  createTimeoutSignal:()=>new AbortController().signal
 });
 const out=await runtime.execute(admission());
 assert.equal(calls,0);
 assert.equal(out.status,'GITHUB_DURABLE_WRITE_EXECUTION_FAILED');
 assert.equal(out.write_performed,false);
});

test('composition requires injected network and timeout dependencies',()=>{
 assert.throws(()=>createHermesMaintainerGithubDurableWriteRuntimeComposition({}),/fetchImpl_required/);
 assert.throws(()=>createHermesMaintainerGithubDurableWriteRuntimeComposition({fetchImpl:async()=>({status:201})}),/createTimeoutSignal_required/);
});
