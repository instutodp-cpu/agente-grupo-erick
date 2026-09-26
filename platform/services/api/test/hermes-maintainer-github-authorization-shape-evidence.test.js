'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectHermesMaintainerGithubAuthorizationShapeEvidence}=require('../src/runtime/hermes-maintainer-github-authorization-shape-evidence');

test('reports only authorization shape for valid bearer material',()=>{
 const evidence=collectHermesMaintainerGithubAuthorizationShapeEvidence({ok:true,authorization:'Bearer opaque-secret'});
 assert.deepEqual(evidence,{
  evidence_version:'hermes_maintainer_github_authorization_shape_evidence_v1',
  credential_reference:'github_read_only_staging',resolution_ok:true,
  authorization_present:true,bearer_prefix_valid:true,material_nonempty:true,material_trimmed:true,
  credential_material_present:false,authorization_value_present:false
 });
 const serialized=JSON.stringify(evidence);
 assert.equal(serialized.includes('opaque-secret'),false);
 assert.equal(serialized.includes('Bearer opaque-secret'),false);
});

test('detects malformed or whitespace-padded material without exposing it',()=>{
 const malformed=collectHermesMaintainerGithubAuthorizationShapeEvidence({ok:true,authorization:'token opaque'});
 assert.equal(malformed.bearer_prefix_valid,false);assert.equal(malformed.material_nonempty,false);
 const padded=collectHermesMaintainerGithubAuthorizationShapeEvidence({ok:true,authorization:'Bearer opaque\n'});
 assert.equal(padded.bearer_prefix_valid,true);assert.equal(padded.material_nonempty,true);assert.equal(padded.material_trimmed,false);
 assert.equal(JSON.stringify(padded).includes('opaque'),false);
});

test('fails closed for unavailable resolution',()=>{
 const evidence=collectHermesMaintainerGithubAuthorizationShapeEvidence(null);
 assert.equal(evidence.resolution_ok,false);assert.equal(evidence.authorization_present,false);
 assert.equal(evidence.bearer_prefix_valid,false);assert.equal(evidence.material_nonempty,false);
});
