'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {prepareHermesMaintainerGithubWriteCanary}=require('../src/core/hermes-maintainer-github-write-canary-contract');

const valid=()=>({
 repository:'instutodp-cpu/agente-grupo-erick',
 operation:'create_branch',
 ref:'refs/heads/hermes/canary/first-write',
 sha:'0123456789abcdef0123456789abcdef01234567'
});

test('prepares only the fixed inert create-branch canary',()=>{
 const result=prepareHermesMaintainerGithubWriteCanary(valid());
 assert.equal(result.status,'CANARY_PREPARED');
 assert.equal(result.canary_valid,true);
 assert.equal(result.provider,'GITHUB');
 assert.equal(result.environment,'staging');
 assert.equal(result.execution_authorized,false);
 assert.equal(result.credential_material_present,false);
 assert.equal(result.network_call_performed,false);
 assert.equal(result.write_performed,false);
 assert.equal(result.production_used,false);
});

test('fails closed for repository operation ref and sha drift',()=>{
 assert.equal(prepareHermesMaintainerGithubWriteCanary({...valid(),repository:'other/repo'}).reason,'REPOSITORY_NOT_ALLOWED');
 assert.equal(prepareHermesMaintainerGithubWriteCanary({...valid(),operation:'delete_branch'}).reason,'OPERATION_NOT_ALLOWED');
 assert.equal(prepareHermesMaintainerGithubWriteCanary({...valid(),ref:'refs/heads/main'}).reason,'REF_NOT_ALLOWED');
 assert.equal(prepareHermesMaintainerGithubWriteCanary({...valid(),ref:'refs/heads/hermes/other'}).reason,'REF_NOT_ALLOWED');
 assert.equal(prepareHermesMaintainerGithubWriteCanary({...valid(),ref:'refs/heads/hermes/canary/a..b'}).reason,'REF_NOT_ALLOWED');
 assert.equal(prepareHermesMaintainerGithubWriteCanary({...valid(),sha:'ABC'}).reason,'SHA_NOT_ALLOWED');
});

test('fails closed when any extra write-surface field is supplied',()=>{
 for(const extra of [
  {method:'DELETE'},
  {url:'https://example.invalid'},
  {force:true},
  {body:{ref:'refs/heads/main'}}
 ]){
  const result=prepareHermesMaintainerGithubWriteCanary({...valid(),...extra});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.canary_valid,false);
  assert.equal(result.reason,'CANARY_FIELDS_INVALID');
 }
});

test('fails closed when required fields are missing or input is not a plain object',()=>{
 const {sha,...missingSha}=valid();
 assert.equal(prepareHermesMaintainerGithubWriteCanary(missingSha).reason,'CANARY_FIELDS_INVALID');
 assert.equal(prepareHermesMaintainerGithubWriteCanary(null).reason,'CANARY_FIELDS_INVALID');
 assert.equal(prepareHermesMaintainerGithubWriteCanary([]).reason,'CANARY_FIELDS_INVALID');
});
