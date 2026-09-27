'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ALLOWED_ENVIRONMENT_KEY,createHermesMaintainerWriteRuntimeEnvironmentReader}=require('../src/runtime/hermes-maintainer-write-runtime-environment-reader');

test('reads only the fixed create-branch staging environment key',async()=>{
 const readEnvironment=createHermesMaintainerWriteRuntimeEnvironmentReader({environment:{[ALLOWED_ENVIRONMENT_KEY]:'opaque-material'}});
 assert.equal(await readEnvironment(ALLOWED_ENVIRONMENT_KEY),'opaque-material');
});

test('rejects the read-only key and arbitrary environment keys',async()=>{
 const readEnvironment=createHermesMaintainerWriteRuntimeEnvironmentReader({environment:{HERMES_GITHUB_READ_ONLY_STAGING_TOKEN:'read-material',OTHER:'other'}});
 await assert.rejects(()=>readEnvironment('HERMES_GITHUB_READ_ONLY_STAGING_TOKEN'),/ENVIRONMENT_KEY_NOT_ALLOWED/);
 await assert.rejects(()=>readEnvironment('OTHER'),/ENVIRONMENT_KEY_NOT_ALLOWED/);
});

test('fails closed when create-branch staging material is absent',async()=>{
 const readEnvironment=createHermesMaintainerWriteRuntimeEnvironmentReader({environment:{}});
 assert.equal(await readEnvironment(ALLOWED_ENVIRONMENT_KEY),undefined);
});

test('reader metadata exposes no credential material',()=>{
 const environment={[ALLOWED_ENVIRONMENT_KEY]:'opaque-material'};
 const readEnvironment=createHermesMaintainerWriteRuntimeEnvironmentReader({environment});
 assert.equal(Object.hasOwn(readEnvironment,'token'),false);
 assert.equal(Object.hasOwn(readEnvironment,'authorization'),false);
});
