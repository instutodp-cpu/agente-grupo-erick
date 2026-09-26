'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectHermesMaintainerRuntimeReadinessEvidence}=require('../src/runtime/hermes-maintainer-runtime-readiness-evidence');

test('emits sanitized readiness evidence for an available runtime credential',async()=>{
 const result=await collectHermesMaintainerRuntimeReadinessEvidence({runtimeFactory:()=>({
  resolveAuthorization:async()=>({ok:true,authorization:'Bearer opaque'})
 })});
 assert.equal(result.ready,true);
 assert.equal(result.reason,'READY');
 assert.equal(result.credential_material_present,false);
 assert.equal(Object.hasOwn(result,'authorization'),false);
 assert.equal(JSON.stringify(result).includes('opaque'),false);
});

test('emits sanitized unavailable evidence without credential material',async()=>{
 const result=await collectHermesMaintainerRuntimeReadinessEvidence({runtimeFactory:()=>({
  resolveAuthorization:async()=>({ok:false,reason:'SECRET_UNAVAILABLE'})
 })});
 assert.equal(result.ready,false);
 assert.equal(result.reason,'CREDENTIAL_UNAVAILABLE');
 assert.equal(JSON.stringify(result).includes('SECRET_UNAVAILABLE'),false);
});

test('sanitizes runtime construction failures',async()=>{
 const result=await collectHermesMaintainerRuntimeReadinessEvidence({runtimeFactory:()=>{throw new Error('sensitive')}});
 assert.equal(result.ready,false);
 assert.equal(result.reason,'RUNTIME_UNAVAILABLE');
 assert.equal(JSON.stringify(result).includes('sensitive'),false);
});
