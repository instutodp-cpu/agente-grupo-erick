'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CONTRACT_VERSION,createHermesMaintainerGithubCreatePullRequestExecutionBoundary}=require('../src/core/hermes-maintainer-github-create-pull-request-execution-boundary');

const admission={contract_version:'hermes_maintainer_github_create_pull_request_durable_admission_v1',status:'GITHUB_CREATE_PULL_REQUEST_DURABLE_REQUEST_ADMITTED',admission_valid:true,execution_authorized:true,repository:'instutodp-cpu/agente-grupo-erick',base:'main',head:'hermes/test-branch',draft:true};
const credential={status:'GITHUB_CREATE_PULL_REQUEST_CREDENTIAL_RESOLVED',resolution_valid:true,authorization_header_present:true,credential_reference:'github_create_pull_request_hermes_branch_staging',network_call_performed:false,write_performed:false,production_used:false};

test('executes only after durable admission and credential resolution',async()=>{
 let calls=0;const boundary=createHermesMaintainerGithubCreatePullRequestExecutionBoundary({transport:async(request,authorization)=>{calls++;assert.equal(request.method,'POST');assert.equal(request.url,'/repos/instutodp-cpu/agente-grupo-erick/pulls');assert.deepEqual(request.body,{head:'hermes/test-branch',base:'main',draft:true});assert.equal(authorization,'Bearer opaque-pr-token');return {id:123};}});
 const out=await boundary.execute(admission,{...credential,authorization:'Bearer opaque-pr-token'});
 assert.equal(out.contract_version,CONTRACT_VERSION);assert.equal(out.execution_valid,true);assert.equal(out.network_call_performed,true);assert.equal(out.write_performed,true);assert.equal(out.production_used,false);assert.equal(calls,1);
});

test('blocks before transport when durable admission is invalid',async()=>{
 let calls=0;const boundary=createHermesMaintainerGithubCreatePullRequestExecutionBoundary({transport:async()=>{calls++;}});
 const out=await boundary.execute({...admission,execution_authorized:false},credential);
 assert.equal(out.execution_valid,false);assert.deepEqual(out.blockers,['DURABLE_ADMISSION_INVALID']);assert.equal(calls,0);
});

test('blocks before transport when credential is not resolved',async()=>{
 let calls=0;const boundary=createHermesMaintainerGithubCreatePullRequestExecutionBoundary({transport:async()=>{calls++;}});
 const out=await boundary.execute(admission,{...credential,resolution_valid:false});
 assert.equal(out.execution_valid,false);assert.deepEqual(out.blockers,['CREDENTIAL_NOT_RESOLVED']);assert.equal(calls,0);
});

test('requires explicit transport dependency',()=>{assert.throws(()=>createHermesMaintainerGithubCreatePullRequestExecutionBoundary(),/transport required/);});
