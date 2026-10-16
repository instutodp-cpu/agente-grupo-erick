'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteOperationalAdmissionComposition,preflightHermesMaintainerGithubWriteOperationalAdmission}=require('../src/runtime/hermes-maintainer-github-write-operational-admission-composition');
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
const sha='a'.repeat(40);
const branch='hermes/canary/operational-admission';
function fixture(){
 const intent=buildHermesMaintainerScmWriteIntent({provider:'GITHUB',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,branch_name:branch});
 const fp=fingerprintHermesMaintainerScmWriteIntent(intent);
 const approvalRequest=buildHermesMaintainerScmWriteApprovalRequest(intent,fp);
 const approval=bindHermesMaintainerScmWriteApproval(approvalRequest,{decision:'APPROVED',intent_digest:fp.intent_digest,approval_reference:'human-operational-admission'});
 const authRequest=buildHermesMaintainerScmWriteAuthorizationRequest(approval);
 const grant=grantHermesMaintainerScmWriteAuthorization(authRequest,{decision:'AUTHORIZED',intent_digest:fp.intent_digest,authorization_reference:'control-operational-admission'});
 const gate={contract_version:'hermes_maintainer_staging_gate_v1',mission_id:'mission-operational-admission',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,status:'MAINTAINER_STAGING_GATE_PASSED_SIMULATION',staging_gate_passed:true,real_execution_enabled:false,production_enabled:false,network_enabled:false,credentials_enabled:false,write_enabled:false,simulation:true,blockers:[]};
 const single=buildHermesMaintainerSingleUseAuthorization(gate,{authorization_id:'single-operational-admission',issued_at:'2026-10-16T03:00:00.000Z',expires_at:'2026-10-16T04:00:00.000Z'});
 const ownership={contract_version:'hermes_maintainer_safe_workflow_durable_ownership_binding_v1',mission_id:'mission-operational-admission',workflow_digest:`sha256:${'1'.repeat(64)}`,intent_digest:fp.intent_digest,intent_count:1,authorization_binding_digest:`sha256:${'2'.repeat(64)}`,workflow_operation:'branch_prepare',durable_operation:'create_branch',target_handoff_contract:'hermes_maintainer_scm_write_durable_admission_handoff_v1',repository:REPOSITORY,base_ref:BASE_REF,ownership_source:'DURABLE_PERSISTENCE_RECEIPT',ownership_key:'operational-admission::attempt-ownership',persistence_key:'operational-admission',attempt_reference:'attempt-operational-admission',status:'MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_BOUND_SIMULATION',ownership_bound:true,ownership_exclusive:true,durable_replay_protection:true,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:[]};
 const durable=prepareHermesMaintainerSafeWorkflowDurableTarget(ownership,{operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,base_sha:sha,branch_name:branch});
 const target={target_type:TARGET_TYPE,repository:REPOSITORY,base_ref:BASE_REF,base_sha:sha,branch_name:branch,target_digest:null};target.target_digest=computeA3TargetDigest(target);
 const operator={operator_id:'operator-operational-admission',source_reference:'operator-proof-operational-admission',identity_verified:true,scope_verified:true,operator_binding_digest:null};operator.operator_binding_digest=computeA3OperatorBindingDigest(operator);
 const eligibility={eligibility_id:'a3-operational-admission',capability_id:CAPABILITY_ID,environment:'staging',operation:'create_branch',target_reference:target,action_intent_digest:fp.intent_digest,operator_binding:operator,source_evidence:{family:SOURCE_FAMILY,approval_binding:approval,authorization_grant:grant,single_use_authorization:single,durable_target:durable},cost_control:{requested_units:0,maximum_units:0},protected_actions:Object.fromEntries(PROTECTED_ACTION_FIELDS.map(field=>[field,false])),evaluation_time:'2026-10-16T03:15:00.000Z'};
 const canary=prepareHermesMaintainerGithubWriteCanary({repository:REPOSITORY,operation:'create_branch',ref:'refs/heads/'+branch,sha});
 return {eligibility,grant,canary};
}
function input(){return {consumption_reference:'consume-1',attempt_reference:'attempt-1',capability_reference:'capability-1',admission_reference:'admission-1'};}
function pool(){
 const rows=new Map();
 const client={async query(sql,args){
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
  const table=sql.includes('attempt_ownership')?'ownership':'consumption';
  const key=args[0];if(sql.startsWith('SELECT ')){const row=rows.get(table+':'+key);return {rows:row?[row]:[]};}
  if(rows.has(table+':'+key))return {rows:[]};
  if(table==='ownership')rows.set(table+':'+key,{ownership_key:args[0],persistence_key:args[1],intent_digest:args[2],authorization_reference:args[3],consumption_reference:args[4],attempt_reference:args[5]});
  else rows.set(table+':'+key,{persistence_key:args[0],intent_digest:args[1],authorization_reference:args[2],consumption_reference:args[3]});
  return {rows:[rows.get(table+':'+key)]};
 },release(){}};
 return {connect:async()=>client,async query(sql,args){const table=sql.includes('attempt_ownership')?'ownership':'consumption';const row=rows.get(table+':'+args[0]);return {rows:row?[row]:[]};}};
}

test('requires evaluated A3 v2 evidence before building official durable admission',async()=>{
 const f=fixture();
 const composition=createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:pool()});
 const out=await composition.prepare(f.eligibility,f.grant,f.canary,input());
 assert.equal(out.contract_version,'hermes_maintainer_github_durable_write_admission_v1');
 assert.equal(out.status,'GITHUB_DURABLE_WRITE_REQUEST_ADMITTED');
 assert.equal(out.admission_valid,true);
 assert.equal(out.execution_authorized,true);
 assert.equal(out.ownership_source,'DURABLE_PERSISTENCE_RECEIPT');
 assert.equal(out.request.body.ref,'refs/heads/'+branch);
 assert.equal(out.request.body.sha,sha);
 assert.equal(out.network_call_performed,false);
 assert.equal(out.write_performed,false);
 assert.equal(out.production_used,false);
});

test('legacy path without A3 evidence fails closed before durable persistence',async()=>{
 let touched=false;
 const failPool={connect:async()=>{touched=true;throw new Error('persistence_must_not_run');},query:async()=>{touched=true;throw new Error('persistence_must_not_run');}};
 const f=fixture();
 const composition=createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:failPool});
 const out=await composition.prepare(f.grant,f.canary,input());
 assert.equal(out.status,'OPERATIONAL_ADMISSION_BLOCKED');
 assert.deepEqual(out.blockers,['A3_ELIGIBILITY_REQUIRED']);
 assert.equal(out.execution_authorized,false);
 assert.equal(touched,false);
});

test('A3 target SHA drift blocks before persistence',async()=>{
 let touched=false;
 const failPool={connect:async()=>{touched=true;throw new Error('persistence_must_not_run');},query:async()=>{touched=true;throw new Error('persistence_must_not_run');}};
 const f=fixture();
 f.eligibility.target_reference={...f.eligibility.target_reference,base_sha:'b'.repeat(40)};
 f.eligibility.target_reference.target_digest=computeA3TargetDigest(f.eligibility.target_reference);
 const out=await createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:failPool}).prepare(f.eligibility,f.grant,f.canary,input());
 assert.equal(out.status,'OPERATIONAL_ADMISSION_BLOCKED');
 assert.deepEqual(out.blockers,['A3_ELIGIBILITY_REQUIRED']);
 assert.equal(touched,false);
});

test('A3 intent drift blocks before persistence',async()=>{
 let touched=false;
 const failPool={connect:async()=>{touched=true;throw new Error('persistence_must_not_run');},query:async()=>{touched=true;throw new Error('persistence_must_not_run');}};
 const f=fixture();
 const badGrant={...f.grant,intent_digest:`sha256:${'f'.repeat(64)}`};
 const out=await createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:failPool}).prepare(f.eligibility,badGrant,f.canary,input());
 assert.equal(out.status,'OPERATIONAL_ADMISSION_BLOCKED');
 assert.deepEqual(out.blockers,['A3_ELIGIBILITY_REQUIRED']);
 assert.equal(touched,false);
});

test('preflight proves A3 is bound without authorizing execution',()=>{
 const f=fixture();
 const out=preflightHermesMaintainerGithubWriteOperationalAdmission(f.eligibility,f.grant,f.canary,input());
 assert.equal(out.admission_preflight_valid,true);
 assert.match(out.a3_eligibility_fingerprint,/^sha256:[a-f0-9]{64}$/);
});

test('durable consumption makes replay fail closed after valid A3 admission',async()=>{
 const f=fixture();
 const composition=createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:pool()});
 const first=await composition.prepare(f.eligibility,f.grant,f.canary,input());
 const replay=await composition.prepare(f.eligibility,f.grant,f.canary,input());
 assert.equal(first.admission_valid,true);
 assert.equal(replay.status,'OPERATIONAL_ADMISSION_BLOCKED');
 assert.deepEqual(replay.blockers,['DURABLE_CONSUMPTION_EXISTS']);
 assert.equal(replay.execution_authorized,false);
 assert.equal(replay.network_call_performed,false);
 assert.equal(replay.write_performed,false);
});

test('rejects grant/canary scope mismatch before durable persistence',async()=>{
 const f=fixture();
 const bad={...f.grant,branch_name:'hermes/canary/other'};
 const out=await createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:pool()}).prepare(f.eligibility,bad,f.canary,input());
 assert.equal(out.status,'OPERATIONAL_ADMISSION_BLOCKED');
 assert.deepEqual(out.blockers,['A3_ELIGIBILITY_REQUIRED']);
});

test('requires exact operational reference fields after valid A3 gate',async()=>{
 const f=fixture();
 const out=await createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool:pool()}).prepare(f.eligibility,f.grant,f.canary,{...input(),already_consumed:false});
 assert.equal(out.status,'OPERATIONAL_ADMISSION_BLOCKED');
 assert.deepEqual(out.blockers,['OPERATIONAL_INPUT_INVALID']);
});

test('requires injected Postgres pool and never constructs process or GitHub runtime dependencies',()=>{
 assert.throws(()=>createHermesMaintainerGithubWriteOperationalAdmissionComposition(),/postgres_pool_required/);
});
