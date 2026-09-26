'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {REFERENCE,ENV_KEY,createHermesMaintainerStagingSecretSource}=require('../src/core/hermes-maintainer-staging-secret-source');
test('reads only the fixed staging key through injected environment reader',async()=>{let seen;const s=createHermesMaintainerStagingSecretSource({readEnvironment:async k=>(seen=k,'opaque')});assert.equal(await s.readSecret(REFERENCE),'opaque');assert.equal(seen,ENV_KEY);});
test('rejects arbitrary reference before environment access',async()=>{let calls=0;const s=createHermesMaintainerStagingSecretSource({readEnvironment:async()=>{calls++;return 'opaque'}});await assert.rejects(()=>s.readSecret('other'),/REFERENCE_NOT_ALLOWED/);assert.equal(calls,0);});
test('sanitizes environment reader failures',async()=>{const s=createHermesMaintainerStagingSecretSource({readEnvironment:async()=>{throw new Error('secret-detail')}});await assert.rejects(()=>s.readSecret(REFERENCE),/SECRET_SOURCE_UNAVAILABLE/);});
test('fails closed for absent material',async()=>{const s=createHermesMaintainerStagingSecretSource({readEnvironment:async()=>undefined});await assert.rejects(()=>s.readSecret(REFERENCE),/SECRET_UNAVAILABLE/);});
test('does not capture or expose credential material in metadata',()=>{const s=createHermesMaintainerStagingSecretSource({readEnvironment:async()=> 'opaque'});assert.equal(JSON.stringify(s).includes('opaque'),false);assert.equal(Object.prototype.hasOwnProperty.call(s,'token'),false);});
