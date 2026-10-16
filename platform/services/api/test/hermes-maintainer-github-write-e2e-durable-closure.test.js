'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteE2eDurableClosure}=require('../src/runtime/hermes-maintainer-github-write-e2e-durable-closure');
const {buildHermesMaintainerScmWriteIntent}=require('../src/core/hermes-maintainer-scm-write-intent');
const {fingerprintHermesMaintainerScmWriteIntent}=require('../src/core/hermes-maintainer-scm-write-intent-fingerprint');
const {buildHermesMaintainerScmWriteApprovalRequest}=require('../src/core/hermes-maintainer-scm-write-approval-request');
const {bindHermesMaintainerScmWriteApproval}=require('../src/core/hermes-maintainer-scm-write-approval-binding');
const {buildHermesMaintainerScmWriteAuthorizationRequest}=require('../src/core/hermes-maintainer-scm-write-authorization-request');
const {grantHermesMaintainerScmWriteAuthorization}=require('../src/core/hermes-maintainer-scm-write-authorization-grant');
const {buildHermesMaintainerSingleUseAuthorization}=require('../src/core/hermes-maintainer-single-use-execution-authorization');
const {prepareHermesMaintainerSafeWorkflowDurableTarget}=require('../src/core/hermes-maintainer-safe-workflow-durable-target');
const {prepareHermesMaintainerGithubWriteCanary}=require('../src/core/hermes-maintainer-github-write-canary-contract');
const {PROTECTED_ACTION_FIELDS,TARGET_TYPE,CAPABILITY_ID,SOURCE_FAMILY,computeA3TargetDigest,computeA3OperatorBindingDigest}=require('../src/core/a3-scoped-external-action-eligibility');

const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const BASE_REF='main';
const sha='c'.repeat(40);
const branch='hermes/canary/e2e-durable-closure';

function fixture(){
 const intent=buildHermesMaintainerScmWriteIntent({provider:'GITHUB',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,branch_name:branch});
 const fp=fingerprintHermesMaintainerScmWriteIntent(intent);
 const approvalRequest=buildHermesMaintainerScmWriteApprovalRequest(intent,fp);
 const approval=bindHermesMaintainerScmWriteApproval(approvalRequest,{decision:'APPROVED',intent_digest:fp.intent_digest,approval_reference:'human-e2e'});
 const authRequest=buildHermesMaintainerScmWriteAuthorizationRequest(approval);
 const grant=grantHermesMaintainerScmWriteAuthorization(authRequest,{decision:'AUTHORIZED',intent_digest:fp.intent_digest,authorization_reference:'control-e2e'});
 const gate={contract_version:'hermes_maintainer_staging_gate_v1',mission_id:'mission-e2e',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,status:'MAINTAINER_STAGING_GATE_PASSED_SIMULATION',staging_gate_passed:true,real_execution_enabled:false,production_enabled:false,network_enabled:false,credentials_enabled:false,write_enabled:false,simulation:true,blockers:[]};
 const single=buildHermesMaintainerSingleUseAuthorization(gate,{authorization_id:'single-e2e',issued_at:'2026-10-16T03:00:00.000Z',expires_at:'2026-10-16T04:00:00.000Z'});
 const ownership={contract_version:'hermes_maintainer_safe_workflow_durable_ownership_binding_v1',mission_id:'mission-e2e',workflow_digest:`sha256:${'1'.repeat(64)}`,intent_digest:fp.intent_digest,intent_count:1,authorization_binding_digest:`sha256:${'2'.repeat(64)}`,workflow_operation:'branch_prepare',durable_operation:'create_branch',target_handoff_contract:'hermes_maintainer_scm_write_durable_admission_handoff_v1',repository:REPOSITORY,base_ref:BASE_REF,ownership_source:'DURABLE_PERSISTENCE_RECEIPT',ownership_key:'e2e::attempt-ownership',persistence_key:'e2e',attempt_reference:'attempt-e2e',status:'MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_BOUND_SIMULATION',ownership_bound:true,ownership_exclusive:true,durable_replay_protection:true,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:[]};
 const durable=prepareHermesMaintainerSafeWorkflowDurableTarget(ownership,{operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,base_sha:sha,branch_name:branch});
 const target={target_type:TARGET_TYPE,repository:REPOSITORY,base_ref:BASE_REF,base_sha:sha,branch_name:branch,target_digest:null};target.target_digest=computeA3TargetDigest(target);
 const operator={operator_id:'operator-e2e',source_reference:'operator-proof-e2e',identity_verified:true,scope_verified:true,operator_binding_digest:null};operator.operator_binding_digest=computeA3OperatorBindingDigest(operator);
 const eligibility={eligibility_id:'a3-e2e',capability_id:CAPABILITY_ID,environment:'staging',operation:'create_branch',target_reference:target,action_intent_digest:fp.intent_digest,operator_binding:operator,source_evidence:{family:SOURCE_FAMILY,approval_binding:approval,authorization_grant:grant,single_use_authorization:single,durable_target:durable},cost_control:{requested_units:0,maximum_units:0},protected_actions:Object.fromEntries(PROTECTED_ACTION_FIELDS.map(field=>[field,false])),evaluation_time:'2026-10-16T03:15:00.000Z'};
 const canary=prepareHermesMaintainerGithubWriteCanary({repository:REPOSITORY,operation:'create_branch',ref:'refs/heads/'+branch,sha});
 return {eligibility,grant,canary};
}
function input(){return {consumption_reference:'consume-e2e',attempt_reference:'attempt-e2e',capability_reference:'cap-e2e',admission_reference:'admission-e2e'};}
function pool(){
 const rows=new Map();
 const client={async query(sql,args){if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};let table;if(sql.includes('write_finalization'))table='finalization';else if(sql.includes('execution_outcome'))table='outcome';else if(sql.includes('attempt_ownership'))table='ownership';else table='consumption';const key=args[0];if(sql.startsWith('SELECT ')){const row=rows.get(table+':'+key);return {rows:row?[row]:[]};}if(rows.has(table+':'+key))return {rows:[]};let row;if(table==='finalization')row={finalization_key:args[0],finalization_digest:args[1],outcome_digest:args[2],intent_digest:args[3],attempt_reference:args[4],admission_reference:args[5],repository:args[6],operation:args[7],ref:args[8],sha:args[9],provider_status:args[10]};else if(table==='outcome')row={outcome_key:args[0],outcome_digest:args[1],intent_digest:args[2],attempt_reference:args[3],admission_reference:args[4],repository:args[5],operation:args[6],ref:args[7],sha:args[8],provider_status:args[9]};else if(table==='ownership')row={ownership_key:args[0],persistence_key:args[1],intent_digest:args[2],authorization_reference:args[3],consumption_reference:args[4],attempt_reference:args[5]};else row={persistence_key:args[0],intent_digest:args[1],authorization_reference:args[2],consumption_reference:args[3]};rows.set(table+':'+key,row);return {rows:[row]};},release(){}};
 return {connect:async()=>client,async query(sql,args){let table;if(sql.includes('write_finalization'))table='finalization';else if(sql.includes('execution_outcome'))table='outcome';else if(sql.includes('attempt_ownership'))table='ownership';else table='consumption';const row=rows.get(table+':'+args[0]);return {rows:row?[row]:[]};}};
}

test('closes the official durable write chain end to end only after valid A3 eligibility',async()=>{
 const f=fixture();let fetchCalls=0,body;
 const out=await createHermesMaintainerGithubWriteE2eDurableClosure({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async(_url,options)=>{fetchCalls++;body=JSON.parse(options.body);return {status:201};},createTimeoutSignal:()=>new AbortController().signal}).execute(f.eligibility,f.grant,f.canary,input());
 assert.equal(fetchCalls,1);assert.deepEqual(body,{ref:'refs/heads/'+branch,sha});
 assert.equal(out.status,'E2E_DURABLE_WRITE_CLOSURE_CONFIRMED');assert.equal(out.closure_valid,true);assert.equal(out.durable,true);
 assert.equal(out.execution.status,'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED');assert.equal(out.receipt.status,'GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED');
 assert.equal(out.receipt.admission_reference,'admission-e2e');assert.equal(out.receipt.ref,'refs/heads/'+branch);assert.equal(out.receipt.sha,sha);
 assert.equal(out.network_call_performed,true);assert.equal(out.write_performed,true);assert.equal(out.production_used,false);
});

test('replay fails closed before a second provider write after valid A3 eligibility',async()=>{
 const f=fixture();let fetchCalls=0;const composition=createHermesMaintainerGithubWriteE2eDurableClosure({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 const first=await composition.execute(f.eligibility,f.grant,f.canary,input());const replay=await composition.execute(f.eligibility,f.grant,f.canary,input());
 assert.equal(first.closure_valid,true);assert.equal(replay.status,'E2E_DURABLE_WRITE_CLOSURE_BLOCKED');assert.deepEqual(replay.blockers,['DURABLE_ADMISSION_NOT_CONFIRMED']);assert.equal(fetchCalls,1);
});

test('legacy E2E invocation without A3 eligibility fails closed before provider write',async()=>{
 const f=fixture();let fetchCalls=0;const composition=createHermesMaintainerGithubWriteE2eDurableClosure({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 const out=await composition.execute(f.grant,f.canary,input());
 assert.equal(out.status,'E2E_DURABLE_WRITE_CLOSURE_BLOCKED');assert.deepEqual(out.blockers,['DURABLE_ADMISSION_NOT_CONFIRMED']);assert.equal(fetchCalls,0);assert.equal(out.durable,false);
});

test('invalid canary fails closed before provider and finalization',async()=>{
 const f=fixture();let fetchCalls=0;const out=await createHermesMaintainerGithubWriteE2eDurableClosure({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal}).execute(f.eligibility,f.grant,{...f.canary,ref:'refs/heads/main'},input());
 assert.equal(out.status,'E2E_DURABLE_WRITE_CLOSURE_BLOCKED');assert.deepEqual(out.blockers,['DURABLE_ADMISSION_NOT_CONFIRMED']);assert.equal(fetchCalls,0);assert.equal(out.durable,false);
});

test('construction is inert and requires all existing runtime dependencies',()=>{
 let fetchCalls=0;const composition=createHermesMaintainerGithubWriteE2eDurableClosure({pool:pool(),environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl:async()=>{fetchCalls++;return {status:201};},createTimeoutSignal:()=>new AbortController().signal});
 assert.equal(composition.composition_version,'hermes_maintainer_github_write_e2e_durable_closure_v2');assert.equal(fetchCalls,0);assert.equal(composition.production_used,false);
 assert.throws(()=>createHermesMaintainerGithubWriteE2eDurableClosure(),/postgres_pool_required/);
});
