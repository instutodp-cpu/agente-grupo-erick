'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildHermesMaintainerGithubRepositoryReaderRequest,validateHermesMaintainerGithubRepositoryReaderRequest}=require('../src/core/hermes-maintainer-github-repository-reader-contract');
const input={provider:'GITHUB',repository:'instutodp-cpu/agente-grupo-erick',ref:'main',path:'README.md',method:'GET',read_only:true};
test('prepares exact read-only GitHub repository request contract',()=>{const r=buildHermesMaintainerGithubRepositoryReaderRequest(input);assert.equal(r.request_valid,true);assert.equal(r.credential_reference_required,true);assert.equal(r.credential_material_present,false);assert.equal(r.network_call_performed,false);assert.equal(r.write_performed,false);assert.equal(r.production_used,false);assert.equal(validateHermesMaintainerGithubRepositoryReaderRequest(r).valid,true);});
test('rejects non GitHub provider',()=>assert.equal(buildHermesMaintainerGithubRepositoryReaderRequest({...input,provider:'OTHER'}).request_valid,false));
test('rejects non GET method',()=>assert.equal(buildHermesMaintainerGithubRepositoryReaderRequest({...input,method:'POST'}).request_valid,false));
test('rejects malformed repository',()=>assert.equal(buildHermesMaintainerGithubRepositoryReaderRequest({...input,repository:'invalid'}).request_valid,false));
test('rejects non read-only request',()=>assert.equal(buildHermesMaintainerGithubRepositoryReaderRequest({...input,read_only:false}).request_valid,false));
