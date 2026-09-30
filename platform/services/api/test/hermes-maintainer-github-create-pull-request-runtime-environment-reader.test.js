'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ALLOWED_ENVIRONMENT_KEY,createHermesMaintainerGithubCreatePullRequestRuntimeEnvironmentReader}=require('../src/runtime/hermes-maintainer-github-create-pull-request-runtime-environment-reader');

test('reads only isolated create_pull_request staging environment key',async()=>{
 const environment={[ALLOWED_ENVIRONMENT_KEY]:'opaque-pr-token',HERMES_GITHUB_UPDATE_FILE_STAGING_TOKEN:'wrong'};
 const read=createHermesMaintainerGithubCreatePullRequestRuntimeEnvironmentReader({environment});
 assert.equal(await read(ALLOWED_ENVIRONMENT_KEY),'opaque-pr-token');
 await assert.rejects(()=>read('HERMES_GITHUB_UPDATE_FILE_STAGING_TOKEN'),/ENVIRONMENT_KEY_NOT_ALLOWED/);
});

test('does not read environment during construction and returns undefined when absent',async()=>{
 let reads=0;const environment={};Object.defineProperty(environment,ALLOWED_ENVIRONMENT_KEY,{get(){reads++;return undefined;}});
 const read=createHermesMaintainerGithubCreatePullRequestRuntimeEnvironmentReader({environment});
 assert.equal(reads,0);assert.equal(await read(ALLOWED_ENVIRONMENT_KEY),undefined);assert.equal(reads,1);
});

test('requires explicit environment object',()=>{assert.throws(()=>createHermesMaintainerGithubCreatePullRequestRuntimeEnvironmentReader(),/environment required/);});
