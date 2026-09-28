'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubCreateBranchTransport,URL}=require('../src/core/hermes-maintainer-github-create-branch-transport');

const authorization={ok:true,authorization:'Bearer synthetic-authorization',credential_material_present:false,production_used:false,write_performed:false};
const baseRequest=()=>({method:'POST',url:URL,body:{ref:'refs/heads/hermes/controlled-branch',sha:'a'.repeat(40)},ownership_source:'DURABLE_PERSISTENCE_RECEIPT',ownership_key:'persist-1::attempt-ownership',persistence_key:'persist-1',intent_digest:'sha256:'+'1'.repeat(64),attempt_reference:'attempt-1',capability_reference:'cap-1',admission_reference:'admission-1'});
const transport=(fetchImpl=async()=>({status:201}))=>createHermesMaintainerGithubCreateBranchTransport({fetchImpl,resolveAuthorization:async()=>authorization});

test('valid request uses exact POST endpoint and confirms only HTTP 201',async()=>{
 let calls=0,seen;
 const out=await transport(async(url,options)=>{calls++;seen={url,options};return {status:201};}).createBranch(baseRequest());
 assert.equal(calls,1);assert.equal(out.status,'CREATED');assert.equal(out.created,true);assert.equal(out.network_call_performed,true);assert.equal(out.provider_status,201);assert.equal(out.write_performed,false);assert.equal(out.production_used,false);
 assert.equal(seen.url,URL);assert.equal(seen.options.method,'POST');assert.equal(seen.options.redirect,'error');assert.equal(seen.options.timeout_ms,5000);assert.deepEqual(JSON.parse(seen.options.body),baseRequest().body);assert.equal(seen.options.headers.Accept,'application/vnd.github+json');assert.equal(seen.options.headers['Content-Type'],'application/json');assert.equal(seen.options.headers['X-GitHub-Api-Version'],'2022-11-28');assert.equal(seen.options.headers.Authorization,authorization.authorization);
});

for(const [name,change] of [
 ['refs/heads/main',r=>{r.body.ref='refs/heads/main';}],
 ['branch outside hermes',r=>{r.body.ref='refs/heads/feature/other';}],
 ['branch traversal',r=>{r.body.ref='refs/heads/hermes/../other';}],
 ['invalid sha',r=>{r.body.sha='not-a-sha';}],
 ['different URL',r=>{r.url='https://api.github.com/repos/other/repo/git/refs';}],
 ['different method',r=>{r.method='PATCH';}],
 ['different ownership source',r=>{r.ownership_source='RUNTIME_MEMORY';}],
 ['incompatible ownership key',r=>{r.ownership_key='other::attempt-ownership';}],
 ['missing provenance reference',r=>{delete r.admission_reference;}]
]){
 test(`rejects ${name} before fetch`,async()=>{let calls=0;const request=baseRequest();change(request);const out=await transport(async()=>{calls++;return {status:201};}).createBranch(request);assert.equal(calls,0);assert.equal(out.status,'BLOCKED');assert.equal(out.reason,'REQUEST_INVALID');assert.equal(out.network_call_performed,false);});
}

test('absent authorization blocks before fetch',async()=>{let calls=0;const t=createHermesMaintainerGithubCreateBranchTransport({fetchImpl:async()=>{calls++;return {status:201};},resolveAuthorization:async()=>null});const out=await t.createBranch(baseRequest());assert.equal(calls,0);assert.equal(out.status,'BLOCKED');assert.equal(out.reason,'AUTHORIZATION_UNAVAILABLE');});
test('authorization resolver failure is sanitized and blocks before fetch',async()=>{let calls=0;const t=createHermesMaintainerGithubCreateBranchTransport({fetchImpl:async()=>{calls++;},resolveAuthorization:async()=>{throw new Error('synthetic detail must not escape');}});const out=await t.createBranch(baseRequest());assert.equal(calls,0);assert.equal(out.status,'BLOCKED');assert.equal(out.reason,'AUTHORIZATION_UNAVAILABLE');assert.equal(JSON.stringify(out).includes('synthetic detail'),false);});
test('fetch failure is sanitized without provider details',async()=>{const t=createHermesMaintainerGithubCreateBranchTransport({fetchImpl:async()=>{throw new Error('provider detail must not escape');},resolveAuthorization:async()=>authorization});const out=await t.createBranch(baseRequest());assert.equal(out.status,'FAILED');assert.equal(out.reason,'PROVIDER_REQUEST_FAILED');assert.equal(out.network_call_performed,true);assert.equal(out.provider_status,null);assert.equal(JSON.stringify(out).includes('provider detail'),false);});
test('HTTP 200 does not confirm creation',async()=>{const out=await transport(async()=>({status:200})).createBranch(baseRequest());assert.equal(out.status,'FAILED');assert.equal(out.created,false);assert.equal(out.reason,'CREATE_BRANCH_NOT_CONFIRMED');assert.equal(out.provider_status,200);});
for(const status of [401,403,404,409,422,500])test(`HTTP ${status} does not confirm creation`,async()=>{const out=await transport(async()=>({status})).createBranch(baseRequest());assert.equal(out.status,'FAILED');assert.equal(out.created,false);assert.equal(out.provider_status,status);assert.equal(out.reason,'CREATE_BRANCH_NOT_CONFIRMED');});
test('201 confirmation never copies response body or authorization',async()=>{const out=await transport(async()=>({status:201,headers:{Authorization:'should not be copied'},body:'should not be copied'})).createBranch(baseRequest());const text=JSON.stringify(out);assert.equal(out.response_body_present,false);assert.equal(out.credential_material_present,false);assert.equal(text.includes('synthetic-authorization'),false);assert.equal(text.includes('should not be copied'),false);assert.equal(Object.prototype.hasOwnProperty.call(out,'authorization'),false);assert.equal(Object.prototype.hasOwnProperty.call(out,'headers'),false);assert.equal(Object.prototype.hasOwnProperty.call(out,'body'),false);});
test('caller cannot add provider or arbitrary host fields',async()=>{let calls=0;const request={...baseRequest(),provider:'OTHER',host:'https://attacker.invalid'};const out=await transport(async()=>{calls++;return {status:201};}).createBranch(request);assert.equal(calls,0);assert.equal(out.status,'BLOCKED');assert.equal(out.reason,'REQUEST_INVALID');});
test('transport invokes only injected fake fetch and never global fetch',async()=>{let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('global fetch must not be used');};try{const out=await transport(async()=>{calls++;return {status:201};}).createBranch(baseRequest());assert.equal(calls,1);assert.equal(out.status,'CREATED');assert.equal(out.network_call_performed,true);assert.equal(out.production_used,false);}finally{globalThis.fetch=original;}});

test('timeout is bounded defensively',()=>{assert.throws(()=>createHermesMaintainerGithubCreateBranchTransport({fetchImpl:async()=>({status:201}),resolveAuthorization:async()=>authorization,timeoutMs:0}),/timeoutMs_invalid/);assert.throws(()=>createHermesMaintainerGithubCreateBranchTransport({fetchImpl:async()=>({status:201}),resolveAuthorization:async()=>authorization,timeoutMs:30001}),/timeoutMs_invalid/);});
