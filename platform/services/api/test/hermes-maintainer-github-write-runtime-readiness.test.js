'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {checkHermesMaintainerGithubWriteRuntimeReadiness}=require('../src/runtime/hermes-maintainer-github-write-runtime-readiness');

test('readiness reports ready without resolving credential or performing network or write',()=>{
 let fetchCalls=0;
 let timeoutCalls=0;
 const result=checkHermesMaintainerGithubWriteRuntimeReadiness({
  environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},
  fetchImpl:async()=>{fetchCalls++;return {status:201};},
  createTimeoutSignal:()=>{timeoutCalls++;return new AbortController().signal;}
 });
 assert.equal(result.status,'READY');
 assert.equal(result.ready,true);
 assert.equal(result.credential_reference,'github_create_branch_staging');
 assert.equal(result.credential_material_present,false);
 assert.equal(result.network_call_performed,false);
 assert.equal(result.write_performed,false);
 assert.equal(result.production_used,false);
 assert.equal(fetchCalls,0);
 assert.equal(timeoutCalls,0);
 assert.equal(Object.prototype.hasOwnProperty.call(result,'execute'),false);
});

test('readiness fails closed for every missing runtime prerequisite',()=>{
 const fetchImpl=async()=>({status:201});
 const createTimeoutSignal=()=>new AbortController().signal;
 assert.equal(checkHermesMaintainerGithubWriteRuntimeReadiness({}).reason,'ENVIRONMENT_UNAVAILABLE');
 assert.equal(checkHermesMaintainerGithubWriteRuntimeReadiness({environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},createTimeoutSignal}).reason,'FETCH_UNAVAILABLE');
 assert.equal(checkHermesMaintainerGithubWriteRuntimeReadiness({environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl}).reason,'TIMEOUT_SIGNAL_FACTORY_UNAVAILABLE');
 assert.equal(checkHermesMaintainerGithubWriteRuntimeReadiness({environment:{},fetchImpl,createTimeoutSignal}).reason,'WRITE_CREDENTIAL_UNAVAILABLE');
});
