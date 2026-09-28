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

test('ignores no alternate write surface because only explicit fields are consumed',()=>{
 const input={...valid(),method:'DELETE',url:'https://example.invalid',force:true,body:{ref:'refs/heads/main'}};
 const result=prepareHermesMaintainerGithubWriteCanary(input);
 assert.equal(result.status,'CANARY_PREPARED');
 assert.equal(Object.prototype.hasOwnProperty.call(result,'method'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(result,'url'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(result,'force'),false);
 assert.equal(Object.prototype.hasOwnProperty.call(result,'body'),false);
});
