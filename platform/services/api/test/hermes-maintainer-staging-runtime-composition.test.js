'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHermesMaintainerStagingRuntimeComposition}=require('../src/core/hermes-maintainer-staging-runtime-composition');

test('composes staging source, binding and authorization resolver without exposing material',async()=>{
 let seen;
 const c=createHermesMaintainerStagingRuntimeComposition({readEnvironment:async key=>(seen=key,'opaque-token')});
 const resolution=await c.resolveAuthorization('github_read_only_staging');
 assert.equal(seen,'HERMES_GITHUB_READ_ONLY_STAGING_TOKEN');
 assert.equal(resolution.ok,true);
 assert.equal(resolution.authorization,'Bearer opaque-token');
 assert.equal(c.credential_material_present,false);
 assert.equal(JSON.stringify(c).includes('opaque-token'),false);
});
test('fails closed when staging material is absent',async()=>{
 const c=createHermesMaintainerStagingRuntimeComposition({readEnvironment:async()=>undefined});
 const resolution=await c.resolveAuthorization('github_read_only_staging');
 assert.equal(resolution.ok,false);
 assert.equal(JSON.stringify(resolution).includes('Bearer'),false);
});
test('rejects non-fixed credential reference',async()=>{
 let calls=0;const c=createHermesMaintainerStagingRuntimeComposition({readEnvironment:async()=>{calls++;return 'opaque'}});
 const resolution=await c.resolveAuthorization('other');
 assert.equal(resolution.ok,false);assert.equal(calls,0);
});
