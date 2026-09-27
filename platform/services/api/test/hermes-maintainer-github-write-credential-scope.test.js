'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CAPABILITY,defineHermesMaintainerGithubWriteCredentialScope}=require('../src/core/hermes-maintainer-github-write-credential-scope');

function valid(){return {capability:CAPABILITY,provider:'GITHUB',operation:'create_branch',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick'};}

test('defines only the staging GitHub create-branch credential scope',()=>{
 const out=defineHermesMaintainerGithubWriteCredentialScope(valid());
 assert.equal(out.status,'GITHUB_WRITE_CREDENTIAL_SCOPE_DEFINED');
 assert.equal(out.scope_valid,true);
 assert.equal(out.credential_reference,CAPABILITY);
 assert.equal(out.credential_material_present,false);
 assert.equal(out.credential_resolution_performed,false);
 assert.equal(out.authorization_header_present,false);
 assert.equal(out.network_call_performed,false);
 assert.equal(out.write_performed,false);
 assert.equal(out.production_used,false);
});

test('fails closed for scope drift',()=>{
 for(const patch of [{capability:'other'},{provider:'OTHER'},{operation:'update_ref'},{environment:'production'},{repository:'other/repo'}]){
  const out=defineHermesMaintainerGithubWriteCredentialScope({...valid(),...patch});
  assert.equal(out.scope_valid,false);
  assert.equal(out.credential_reference,null);
  assert.ok(out.blockers.length>0);
 }
});

test('does not accept credential material or authorize execution',()=>{
 const out=defineHermesMaintainerGithubWriteCredentialScope({...valid(),token:'not-used',authorization:'not-used'});
 assert.equal(out.scope_valid,true);
 assert.equal(Object.hasOwn(out,'token'),false);
 assert.equal(Object.hasOwn(out,'authorization'),false);
 assert.equal(Object.hasOwn(out,'execution_authorized'),false);
});
