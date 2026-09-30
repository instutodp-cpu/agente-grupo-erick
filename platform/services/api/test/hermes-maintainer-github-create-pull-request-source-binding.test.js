'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {REFERENCE,createHermesMaintainerGithubCreatePullRequestSourceBinding}=require('../src/core/hermes-maintainer-github-create-pull-request-source-binding');

test('resolves only the isolated create_pull_request credential reference',async()=>{
 let seen;
 const binding=createHermesMaintainerGithubCreatePullRequestSourceBinding({readSecret:async reference=>{seen=reference;return 'opaque-pr-token';}});
 assert.equal(await binding.resolveSecret(REFERENCE),'opaque-pr-token');
 assert.equal(seen,REFERENCE);
 assert.equal(binding.credential_material_present,false);
 assert.equal(binding.network_call_performed,false);
 assert.equal(binding.write_performed,false);
 assert.equal(binding.production_used,false);
});

test('rejects update_file reference without reading secret',async()=>{
 let reads=0;
 const binding=createHermesMaintainerGithubCreatePullRequestSourceBinding({readSecret:async()=>{reads++;return 'wrong';}});
 await assert.rejects(()=>binding.resolveSecret('github_update_file_hermes_branch_staging'),/REFERENCE_NOT_ALLOWED/);
 assert.equal(reads,0);
});

test('fails closed when secret source is unavailable',async()=>{
 const binding=createHermesMaintainerGithubCreatePullRequestSourceBinding({readSecret:async()=>undefined});
 await assert.rejects(()=>binding.resolveSecret(REFERENCE),/SECRET_UNAVAILABLE/);
});
