'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubUpdateFileCredentialComposition}=require('../src/runtime/hermes-maintainer-github-update-file-credential-composition');

function validScope(composition){
 return composition.defineScope({capability:'github_update_file_hermes_branch_staging',provider:'GITHUB',operation:'update_file',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick'});
}
test('composes isolated update-file staging credential path without network or write',async()=>{
 const composition=createHermesMaintainerGithubUpdateFileCredentialComposition({environment:{HERMES_GITHUB_UPDATE_FILE_STAGING_TOKEN:'opaque-material'}});
 const result=await composition.resolve(validScope(composition));
 assert.equal(result.status,'GITHUB_UPDATE_FILE_CREDENTIAL_RESOLVED');
 assert.equal(result.resolution_valid,true);
 assert.equal(result.authorization,'Bearer opaque-material');
 assert.equal(composition.credential_reference,'github_update_file_hermes_branch_staging');
 assert.equal(composition.network_call_performed,false);
 assert.equal(composition.write_performed,false);
 assert.equal(composition.production_used,false);
});
test('fails closed when update-file credential material is absent',async()=>{
 const composition=createHermesMaintainerGithubUpdateFileCredentialComposition({environment:{}});
 const result=await composition.resolve(validScope(composition));
 assert.equal(result.resolution_valid,false);
 assert.equal(result.authorization,null);
 assert.deepEqual(result.blockers,['RESOLUTION_FAILED']);
});
test('does not accept create-branch credential as update-file authority',async()=>{
 const composition=createHermesMaintainerGithubUpdateFileCredentialComposition({environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'create-branch-only'}});
 const result=await composition.resolve(validScope(composition));
 assert.equal(result.resolution_valid,false);
 assert.equal(result.authorization,null);
});
test('blocked scope never resolves credential material',async()=>{
 const composition=createHermesMaintainerGithubUpdateFileCredentialComposition({environment:{HERMES_GITHUB_UPDATE_FILE_STAGING_TOKEN:'opaque-material'}});
 for(const input of [
  {capability:'github_create_branch_staging',provider:'GITHUB',operation:'create_branch',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick'},
  {capability:'github_update_file_hermes_branch_staging',provider:'GITHUB',operation:'update_file',environment:'production',repository:'instutodp-cpu/agente-grupo-erick'}
 ]){
  const result=await composition.resolve(composition.defineScope(input));
  assert.equal(result.resolution_valid,false);
  assert.equal(result.authorization,null);
  assert.deepEqual(result.blockers,['SCOPE_NOT_ALLOWED']);
 }
});
