'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {probeHermesMaintainerGithubProviderStatus}=require('../src/runtime/hermes-maintainer-github-provider-status-probe');

const scope={repository:'instutodp-cpu/agente-grupo-erick',ref:'main',path:'README.md'};

test('performs fixed read-only GET and emits sanitized status only',async()=>{
 let seen;
 const evidence=await probeHermesMaintainerGithubProviderStatus({...scope,
  resolveAuthorization:async reference=>({ok:reference==='github_read_only_staging',authorization:'Bearer opaque'}),
  fetchImpl:async(url,options)=>(seen={url,options},{status:403,ok:false,headers:{get:n=>n==='x-github-request-id'?'r1':null}})
 });
 assert.equal(evidence.status,403); assert.equal(evidence.ok,false); assert.equal(evidence.github_request_id_present,true);
 assert.equal(evidence.write_performed,false); assert.equal(evidence.credential_material_present,false); assert.equal(evidence.response_body_present,false);
 assert.equal(seen.options.method,'GET'); assert.equal(seen.options.redirect,'error');
 assert.equal(JSON.stringify(evidence).includes('opaque'),false);
});

test('scope is fixed and blocks before authorization',async()=>{
 let calls=0;
 const evidence=await probeHermesMaintainerGithubProviderStatus({...scope,path:'package.json',
  resolveAuthorization:async()=>{calls++;return{ok:true,authorization:'Bearer opaque'}},fetchImpl:async()=>{calls++}});
 assert.equal(calls,0); assert.equal(evidence.status,null); assert.equal(evidence.ok,false);
});

test('authorization and network failures are sanitized',async()=>{
 const auth=await probeHermesMaintainerGithubProviderStatus({...scope,resolveAuthorization:async()=>{throw new Error('secret')},fetchImpl:async()=>{}});
 assert.equal(auth.status,null); assert.equal(JSON.stringify(auth).includes('secret'),false);
 const network=await probeHermesMaintainerGithubProviderStatus({...scope,resolveAuthorization:async()=>({ok:true,authorization:'Bearer opaque'}),fetchImpl:async()=>{throw new Error('network secret')}});
 assert.equal(network.status,null); assert.equal(JSON.stringify(network).includes('opaque'),false); assert.equal(JSON.stringify(network).includes('network secret'),false);
});
