'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ALLOWED_ENVIRONMENT_KEY,createHermesMaintainerRuntimeEnvironmentReader}=require('../src/runtime/hermes-maintainer-runtime-environment-reader');

test('reads only the fixed staging environment key from injected runtime environment',async()=>{
 const readEnvironment=createHermesMaintainerRuntimeEnvironmentReader({environment:{[ALLOWED_ENVIRONMENT_KEY]:'opaque'}});
 assert.equal(await readEnvironment(ALLOWED_ENVIRONMENT_KEY),'opaque');
});

test('rejects arbitrary environment keys',async()=>{
 const readEnvironment=createHermesMaintainerRuntimeEnvironmentReader({environment:{OTHER:'opaque'}});
 await assert.rejects(()=>readEnvironment('OTHER'),/ENVIRONMENT_KEY_NOT_ALLOWED/);
});

test('fails closed when staging material is absent and exposes no material metadata',async()=>{
 const readEnvironment=createHermesMaintainerRuntimeEnvironmentReader({environment:{}});
 assert.equal(await readEnvironment(ALLOWED_ENVIRONMENT_KEY),undefined);
 assert.equal(JSON.stringify({ALLOWED_ENVIRONMENT_KEY}).includes('opaque'),false);
});
