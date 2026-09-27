'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {defineHermesMaintainerGithubWriteCredentialScope,CAPABILITY}=require('../src/core/hermes-maintainer-github-write-credential-scope');
const {REFERENCE,createHermesMaintainerGithubWriteCredentialResolver}=require('../src/core/hermes-maintainer-github-write-credential-resolution');

function scope(){return defineHermesMaintainerGithubWriteCredentialScope({capability:CAPABILITY,provider:'GITHUB',operation:'create_branch',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick'});}

test('resolves only the official create-branch staging scope without exposing raw material',async()=>{
 let seen;
 const resolver=createHermesMaintainerGithubWriteCredentialResolver({resolveSecret:async ref=>(seen=ref,'opaque-material')});
 const out=await resolver.resolve(scope());
 assert.equal(seen,REFERENCE);
 assert.equal(out.status,'GITHUB_WRITE_CREDENTIAL_RESOLVED');
 assert.equal(out.resolution_valid,true);
 assert.equal(out.authorization,'Bearer opaque-material');
 assert.equal(out.credential_material_present,false);
 assert.equal(out.credential_resolution_performed,true);
 assert.equal(out.authorization_header_present,true);
 assert.equal(out.network_call_performed,false);
 assert.equal(out.write_performed,false);
 assert.equal(out.production_used,false);
 assert.equal(Object.hasOwn(out,'token'),false);
});

test('rejects scope drift without invoking secret resolution',async()=>{
 let calls=0;
 const resolver=createHermesMaintainerGithubWriteCredentialResolver({resolveSecret:async()=>{calls++;return 'x';}});
 const bad={...scope(),operation:'update_ref'};
 const out=await resolver.resolve(bad);
 assert.equal(out.resolution_valid,false);
 assert.equal(out.authorization,null);
 assert.equal(calls,0);
});

test('rejects pre-resolution state drift',async()=>{
 let calls=0;
 const resolver=createHermesMaintainerGithubWriteCredentialResolver({resolveSecret:async()=>{calls++;return 'x';}});
 const out=await resolver.resolve({...scope(),network_call_performed:true});
 assert.equal(out.resolution_valid,false);
 assert.deepEqual(out.blockers,['PRERESOLUTION_STATE_INVALID']);
 assert.equal(calls,0);
});

test('sanitizes secret resolver failures',async()=>{
 const resolver=createHermesMaintainerGithubWriteCredentialResolver({resolveSecret:async()=>{throw new Error('sensitive-detail');}});
 const out=await resolver.resolve(scope());
 assert.equal(out.status,'GITHUB_WRITE_CREDENTIAL_RESOLUTION_BLOCKED');
 assert.equal(out.authorization,null);
 assert.equal(out.credential_material_present,false);
 assert.equal(JSON.stringify(out).includes('sensitive-detail'),false);
});
