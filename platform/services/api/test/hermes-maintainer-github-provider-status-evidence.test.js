'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectHermesMaintainerGithubProviderStatusEvidence}=require('../src/runtime/hermes-maintainer-github-provider-status-evidence');

test('emits only sanitized provider status evidence',()=>{
 const evidence=collectHermesMaintainerGithubProviderStatusEvidence({
  status:403,ok:false,headers:{get:name=>name==='x-github-request-id'?'request-1':null},
  authorization:'Bearer must-not-escape',body:'must-not-escape'
 });
 assert.deepEqual(evidence,{
  evidence_version:'hermes_maintainer_github_provider_status_evidence_v1',
  provider:'GITHUB',method:'GET',read_only:true,status:403,ok:false,
  github_request_id_present:true,credential_material_present:false,
  response_body_present:false,write_performed:false
 });
 const serialized=JSON.stringify(evidence);
 assert.equal(serialized.includes('must-not-escape'),false);
 assert.equal(serialized.includes('authorization'),false);
 assert.equal(serialized.includes('body'),true);
});

test('fails closed to null status without response metadata',()=>{
 const evidence=collectHermesMaintainerGithubProviderStatusEvidence(null);
 assert.equal(evidence.status,null);
 assert.equal(evidence.ok,false);
 assert.equal(evidence.github_request_id_present,false);
 assert.equal(evidence.credential_material_present,false);
 assert.equal(evidence.write_performed,false);
});
