'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {checkHermesMaintainerCredentialReadiness}=require('../src/runtime/hermes-maintainer-credential-readiness');

test('reports ready without exposing resolved authorization',async()=>{
 const runtime={resolveAuthorization:async()=>({ok:true,authorization:'Bearer opaque'})};
 const result=await checkHermesMaintainerCredentialReadiness(runtime);
 assert.equal(result.ready,true);
 assert.equal(result.credential_material_present,false);
 assert.equal(result.reason,'READY');
 assert.equal(JSON.stringify(result).includes('opaque'),false);
 assert.equal(Object.hasOwn(result,'authorization'),false);
});

test('fails closed when credential is unavailable',async()=>{
 const runtime={resolveAuthorization:async()=>({ok:false,reason:'SECRET_UNAVAILABLE'})};
 const result=await checkHermesMaintainerCredentialReadiness(runtime);
 assert.equal(result.ready,false);
 assert.equal(result.reason,'CREDENTIAL_UNAVAILABLE');
});

test('sanitizes resolver failures',async()=>{
 const runtime={resolveAuthorization:async()=>{throw new Error('Bearer should-not-leak')}};
 const result=await checkHermesMaintainerCredentialReadiness(runtime);
 assert.equal(result.ready,false);
 assert.equal(JSON.stringify(result).includes('should-not-leak'),false);
});

test('fails closed without a trusted runtime resolver',async()=>{
 const result=await checkHermesMaintainerCredentialReadiness(null);
 assert.equal(result.ready,false);
 assert.equal(result.reason,'RUNTIME_UNAVAILABLE');
});
