'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteCanaryExecutionGuard}=require('../src/core/hermes-maintainer-github-write-canary-execution-guard');

const ref='refs/heads/hermes/canary/first-write';
const sha='0123456789abcdef0123456789abcdef01234567';
const canary=()=>({contract_version:'hermes_maintainer_github_write_canary_contract_v1',status:'CANARY_PREPARED',canary_valid:true,provider:'GITHUB',environment:'staging',repository:'instutodp-cpu/agente-grupo-erick',operation:'create_branch',ref,sha,credential_material_present:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false});
const admission=()=>({contract_version:'hermes_maintainer_github_durable_write_admission_v1',status:'GITHUB_DURABLE_WRITE_REQUEST_ADMITTED',admission_valid:true,provider:'GITHUB',operation:'create_branch',repository:'instutodp-cpu/agente-grupo-erick',ownership_source:'DURABLE_PERSISTENCE_RECEIPT',execution_authorized:true,request:{method:'POST',url:'https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/git/refs',body:{ref,sha}}});

test('delegates only when official canary and durable admission bind to identical ref and sha',async()=>{
 let calls=0;
 const guard=createHermesMaintainerGithubWriteCanaryExecutionGuard({execute:async value=>{calls++;return {status:'SIMULATED',admission:value};}});
 const result=await guard.execute(canary(),admission());
 assert.equal(calls,1);
 assert.equal(result.status,'SIMULATED');
});

test('fails closed when admission drifts from canary',async()=>{
 let calls=0;
 const guard=createHermesMaintainerGithubWriteCanaryExecutionGuard({execute:async()=>{calls++;}});
 const drift=admission();
 drift.request={...drift.request,body:{...drift.request.body,ref:'refs/heads/hermes/canary/other'}};
 const result=await guard.execute(canary(),drift);
 assert.equal(result.status,'CANARY_EXECUTION_BLOCKED');
 assert.equal(result.blockers.includes('CANARY_ADMISSION_BINDING_MISMATCH'),true);
 assert.equal(result.execution_performed,false);
 assert.equal(result.network_call_performed,false);
 assert.equal(result.write_performed,false);
 assert.equal(calls,0);
});

test('rejects non-canary refs and invalid durable admission before delegation',async()=>{
 let calls=0;
 const guard=createHermesMaintainerGithubWriteCanaryExecutionGuard({execute:async()=>{calls++;}});
 const badCanary={...canary(),ref:'refs/heads/hermes/other'};
 const badAdmission={...admission(),execution_authorized:false};
 const result=await guard.execute(badCanary,badAdmission);
 assert.equal(result.status,'CANARY_EXECUTION_BLOCKED');
 assert.equal(result.blockers.includes('CANARY_SCOPE_INVALID'),true);
 assert.equal(result.blockers.includes('DURABLE_ADMISSION_INVALID'),true);
 assert.equal(calls,0);
});
