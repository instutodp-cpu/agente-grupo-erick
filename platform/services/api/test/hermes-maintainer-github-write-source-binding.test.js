'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {REFERENCE,createHermesMaintainerGithubWriteSourceBinding}=require('../src/core/hermes-maintainer-github-write-source-binding');

test('binds only the create-branch staging reference to an injected secret source',async()=>{
 let seen;
 const binding=createHermesMaintainerGithubWriteSourceBinding({readSecret:async ref=>(seen=ref,'opaque-material')});
 assert.equal(await binding.resolveSecret(REFERENCE),'opaque-material');
 assert.equal(seen,REFERENCE);
 assert.equal(binding.credential_material_present,false);
 assert.equal(binding.network_call_performed,false);
 assert.equal(binding.write_performed,false);
 assert.equal(binding.production_used,false);
});

test('rejects arbitrary references before invoking the secret source',async()=>{
 let calls=0;
 const binding=createHermesMaintainerGithubWriteSourceBinding({readSecret:async()=>{calls++;return 'opaque';}});
 await assert.rejects(()=>binding.resolveSecret('github_read_only_staging'),/REFERENCE_NOT_ALLOWED/);
 assert.equal(calls,0);
});

test('fails closed when the source returns no material',async()=>{
 const binding=createHermesMaintainerGithubWriteSourceBinding({readSecret:async()=>''});
 await assert.rejects(()=>binding.resolveSecret(REFERENCE),/SECRET_UNAVAILABLE/);
});

test('binding metadata exposes no credential material',()=>{
 const binding=createHermesMaintainerGithubWriteSourceBinding({readSecret:async()=> 'opaque-material'});
 const metadata=JSON.stringify(binding);
 assert.equal(metadata.includes('opaque-material'),false);
 assert.equal(Object.hasOwn(binding,'token'),false);
 assert.equal(Object.hasOwn(binding,'authorization'),false);
});
