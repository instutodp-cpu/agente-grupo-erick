'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubCreatePullRequestCredentialComposition}=require('../src/runtime/hermes-maintainer-github-create-pull-request-credential-composition');
const input={capability:'github_create_pull_request_hermes_branch_staging',provider:'GITHUB',operation:'create_pull_request',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick'};

test('composes isolated draft PR scope, source and resolver',async()=>{
 const c=createHermesMaintainerGithubCreatePullRequestCredentialComposition({environment:{HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN:'opaque-pr-token'}});
 const scope=c.defineScope(input);const out=await c.resolve(scope);
 assert.equal(c.credential_reference,'github_create_pull_request_hermes_branch_staging');
 assert.equal(out.status,'GITHUB_CREATE_PULL_REQUEST_CREDENTIAL_RESOLVED');assert.equal(out.authorization,'Bearer opaque-pr-token');
 assert.equal(out.credential_material_present,false);assert.equal(out.network_call_performed,false);assert.equal(out.write_performed,false);assert.equal(out.production_used,false);
});

test('construction is inert and credential is read only on explicit resolution',async()=>{
 let reads=0;const environment={};Object.defineProperty(environment,'HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN',{get(){reads++;return 'opaque';}});
 const c=createHermesMaintainerGithubCreatePullRequestCredentialComposition({environment});assert.equal(reads,0);
 const scope=c.defineScope(input);assert.equal(reads,0);await c.resolve(scope);assert.equal(reads,1);
});

test('update_file scope cannot resolve through draft PR composition',async()=>{
 let reads=0;const environment={};Object.defineProperty(environment,'HERMES_GITHUB_CREATE_PULL_REQUEST_STAGING_TOKEN',{get(){reads++;return 'opaque';}});
 const c=createHermesMaintainerGithubCreatePullRequestCredentialComposition({environment});
 const scope=c.defineScope({...input,capability:'github_update_file_hermes_branch_staging',operation:'update_file'});const out=await c.resolve(scope);
 assert.equal(out.resolution_valid,false);assert.equal(reads,0);
});
