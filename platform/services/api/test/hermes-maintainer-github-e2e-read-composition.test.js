'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runHermesMaintainerGithubE2eRead}=require('../src/runtime/hermes-maintainer-github-e2e-read-composition');

test('composes the official GitHub read path and emits sanitized success evidence',async()=>{
 let url,options;
 const evidence=await runHermesMaintainerGithubE2eRead({
  resolveAuthorization:async(ref)=>{assert.equal(ref,'github_read_only_staging');return{ok:true,authorization:'Bearer opaque-secret'};},
  fetchImpl:async(u,o)=>{url=u;options=o;return{ok:true,headers:{get:(name)=>name==='etag'?'opaque-etag':null},text:async()=>'hello'};}
 });
 assert.match(url,/api\.github\.com\/repos\/instutodp-cpu\/agente-grupo-erick\/contents\/README\.md\?ref=main$/);
 assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
 assert.equal(evidence.outcome,'SUCCEEDED');assert.equal(evidence.network_call_performed,true);
 assert.equal(evidence.execution_performed,true);assert.equal(evidence.content_received,true);assert.equal(evidence.content_bytes,5);
 assert.equal(evidence.write_performed,false);assert.equal(evidence.credential_material_present,false);
 const serialized=JSON.stringify(evidence);
 assert.equal(serialized.includes('opaque-secret'),false);assert.equal(serialized.includes('hello'),false);assert.equal(serialized.includes('opaque-etag'),false);
});

test('fails closed without runtime dependencies',async()=>{
 const evidence=await runHermesMaintainerGithubE2eRead({});
 assert.equal(evidence.outcome,'BLOCKED');assert.deepEqual(evidence.blockers,['RUNTIME_UNAVAILABLE']);
 assert.equal(evidence.network_call_performed,false);assert.equal(evidence.write_performed,false);
});

test('provider failure remains sanitized',async()=>{
 const evidence=await runHermesMaintainerGithubE2eRead({
  resolveAuthorization:async()=>({ok:true,authorization:'Bearer opaque-secret'}),
  fetchImpl:async()=>({ok:false,status:401,headers:{get:()=>null}})
 });
 assert.equal(evidence.outcome,'FAILED');assert.deepEqual(evidence.blockers,['GITHUB_RESPONSE_INVALID']);
 assert.equal(evidence.content_received,false);assert.equal(evidence.response_body_present,false);
 assert.equal(JSON.stringify(evidence).includes('opaque-secret'),false);
});
