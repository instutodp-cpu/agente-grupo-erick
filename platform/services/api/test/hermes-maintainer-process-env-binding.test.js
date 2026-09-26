'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHermesMaintainerProcessEnvBinding}=require('../src/runtime/hermes-maintainer-process-env-binding');

test('binds a process-like environment to the staging runtime without exposing material',async()=>{
 const runtime=createHermesMaintainerProcessEnvBinding({environment:{HERMES_GITHUB_READ_ONLY_STAGING_TOKEN:'opaque'}});
 const resolution=await runtime.resolveAuthorization('github_read_only_staging');
 assert.equal(resolution.ok,true);
 assert.equal(resolution.authorization,'Bearer opaque');
 assert.equal(runtime.credential_material_present,false);
 assert.equal(JSON.stringify(runtime).includes('opaque'),false);
});

test('fails closed when process-like environment has no staging material',async()=>{
 const runtime=createHermesMaintainerProcessEnvBinding({environment:{}});
 const resolution=await runtime.resolveAuthorization('github_read_only_staging');
 assert.equal(resolution.ok,false);
 assert.equal(JSON.stringify(resolution).includes('Bearer'),false);
});
