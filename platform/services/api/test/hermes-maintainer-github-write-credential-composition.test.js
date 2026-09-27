'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteCredentialComposition}=require('../src/runtime/hermes-maintainer-github-write-credential-composition');

function validScope(composition){
 return composition.defineScope({capability:'github_create_branch_staging',provider:'GITHUB',operation:'create_branch',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick'});
}

test('composes the fixed create-branch staging credential path without network or write',async()=>{
 const composition=createHermesMaintainerGithubWriteCredentialComposition({environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'opaque-material'}});
 const result=await composition.resolve(validScope(composition));
 assert.equal(result.status,'GITHUB_WRITE_CREDENTIAL_RESOLVED');
 assert.equal(result.resolution_valid,true);
 assert.equal(result.authorization,'Bearer opaque-material');
 assert.equal(composition.credential_material_present,false);
 assert.equal(composition.network_call_performed,false);
 assert.equal(composition.write_performed,false);
 assert.equal(composition.production_used,false);
});

test('fails closed when write credential material is absent',async()=>{
 const composition=createHermesMaintainerGithubWriteCredentialComposition({environment:{}});
 const result=await composition.resolve(validScope(composition));
 assert.equal(result.status,'GITHUB_WRITE_CREDENTIAL_RESOLUTION_BLOCKED');
 assert.equal(result.resolution_valid,false);
 assert.equal(result.authorization,null);
 assert.deepEqual(result.blockers,['RESOLUTION_FAILED']);
});

test('does not accept the read-only staging credential as write material',async()=>{
 const composition=createHermesMaintainerGithubWriteCredentialComposition({environment:{HERMES_GITHUB_READ_ONLY_STAGING_TOKEN:'read-only-material'}});
 const result=await composition.resolve(validScope(composition));
 assert.equal(result.resolution_valid,false);
 assert.equal(result.authorization,null);
});

test('blocked scope never resolves credential material',async()=>{
 const composition=createHermesMaintainerGithubWriteCredentialComposition({environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'opaque-material'}});
 const scope=composition.defineScope({capability:'github_read_only_staging',provider:'GITHUB',operation:'read',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick'});
 const result=await composition.resolve(scope);
 assert.equal(result.resolution_valid,false);
 assert.equal(result.authorization,null);
 assert.deepEqual(result.blockers,['SCOPE_NOT_ALLOWED']);
});
