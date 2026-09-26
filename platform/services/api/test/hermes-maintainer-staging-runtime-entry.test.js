'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHermesMaintainerStagingRuntimeEntry}=require('../src/runtime/hermes-maintainer-staging-runtime-entry');

test('composes the trusted staging runtime entry from an injected process-like environment',async()=>{
 const entry=createHermesMaintainerStagingRuntimeEntry({environment:{HERMES_GITHUB_READ_ONLY_STAGING_TOKEN:'opaque'}});
 const resolution=await entry.resolveAuthorization('github_read_only_staging');
 assert.equal(resolution.ok,true);
 assert.equal(resolution.authorization,'Bearer opaque');
 assert.equal(entry.credential_material_present,false);
 assert.equal(JSON.stringify(entry).includes('opaque'),false);
});

test('fails closed when the staging runtime value is unavailable',async()=>{
 const entry=createHermesMaintainerStagingRuntimeEntry({environment:{}});
 const resolution=await entry.resolveAuthorization('github_read_only_staging');
 assert.equal(resolution.ok,false);
 assert.equal(JSON.stringify(resolution).includes('Bearer'),false);
});

test('does not allow an arbitrary credential reference to reach the environment',async()=>{
 const environment={HERMES_GITHUB_READ_ONLY_STAGING_TOKEN:'opaque',OTHER:'other'};
 const entry=createHermesMaintainerStagingRuntimeEntry({environment});
 const resolution=await entry.resolveAuthorization('other');
 assert.equal(resolution.ok,false);
});
