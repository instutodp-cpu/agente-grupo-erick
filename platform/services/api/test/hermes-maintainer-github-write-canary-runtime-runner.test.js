'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {buildHermesMaintainerScmWriteIntent}=require('../src/core/hermes-maintainer-scm-write-intent');
const {fingerprintHermesMaintainerScmWriteIntent}=require('../src/core/hermes-maintainer-scm-write-intent-fingerprint');
const {buildHermesMaintainerScmWriteApprovalRequest}=require('../src/core/hermes-maintainer-scm-write-approval-request');
const {bindHermesMaintainerScmWriteApproval}=require('../src/core/hermes-maintainer-scm-write-approval-binding');
const {buildHermesMaintainerScmWriteAuthorizationRequest}=require('../src/core/hermes-maintainer-scm-write-authorization-request');
const {grantHermesMaintainerScmWriteAuthorization}=require('../src/core/hermes-maintainer-scm-write-authorization-grant');
const {buildHermesMaintainerSingleUseAuthorization}=require('../src/core/hermes-maintainer-single-use-execution-authorization');
const {prepareHermesMaintainerSafeWorkflowDurableTarget}=require('../src/core/hermes-maintainer-safe-workflow-durable-target');
const {prepareHermesMaintainerGithubWriteCanary}=require('../src/core/hermes-maintainer-github-write-canary-contract');
const {
 PROTECTED_ACTION_FIELDS,TARGET_TYPE,CAPABILITY_ID,SOURCE_FAMILY,
 computeA3TargetDigest,computeA3OperatorBindingDigest
}=require('../src/core/a3-scoped-external-action-eligibility');
const {
 PREEXECUTION_BLOCKED,PREEXECUTION_READY,
 createHermesMaintainerGithubWriteCanaryRuntimeRunner
}=require('../src/runtime/hermes-maintainer-github-write-canary-runtime-runner');

const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const BASE_REF='main';
const BRANCH='hermes/canary/a3-preexecution';
const BASE_SHA='a'.repeat(40);
const URL='https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/git/refs';

function buildEvidence(){
 const intent=buildHermesMaintainerScmWriteIntent({provider:'GITHUB',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,branch_name:BRANCH});
 const fp=fingerprintHermesMaintainerScmWriteIntent(intent);
 const approvalRequest=buildHermesMaintainerScmWriteApprovalRequest(intent,fp);
 const approval=bindHermesMaintainerScmWriteApproval(approvalRequest,{decision:'APPROVED',intent_digest:fp.intent_digest,approval_reference:'human-a3-preexecution'});
 const authRequest=buildHermesMaintainerScmWriteAuthorizationRequest(approval);
 const grant=grantHermesMaintainerScmWriteAuthorization(authRequest,{decision:'AUTHORIZED',intent_digest:fp.intent_digest,authorization_reference:'control-a3-preexecution'});
 const gate={contract_version:'hermes_maintainer_staging_gate_v1',mission_id:'mission-a3-preexecution',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,status:'MAINTAINER_STAGING_GATE_PASSED_SIMULATION',staging_gate_passed:true,real_execution_enabled:false,production_enabled:false,network_enabled:false,credentials_enabled:false,write_enabled:false,simulation:true,blockers:[]};
 const single=buildHermesMaintainerSingleUseAuthorization(gate,{authorization_id:'single-a3-preexecution',issued_at:'2026-10-16T12:00:00.000Z',expires_at:'2026-10-16T13:00:00.000Z'});
 const ownership={contract_version:'hermes_maintainer_safe_workflow_durable_ownership_binding_v1',mission_id:'mission-a3-preexecution',workflow_digest:`sha256:${'1'.repeat(64)}`,intent_digest:fp.intent_digest,intent_count:1,authorization_binding_digest:`sha256:${'2'.repeat(64)}`,workflow_operation:'branch_prepare',durable_operation:'create_branch',target_handoff_contract:'hermes_maintainer_scm_write_durable_admission_handoff_v1',repository:REPOSITORY,base_ref:BASE_REF,ownership_source:'DURABLE_PERSISTENCE_RECEIPT',ownership_key:'a3-preexecution::attempt-ownership',persistence_key:'a3-preexecution',attempt_reference:'attempt-a3-preexecution',status:'MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_BOUND_SIMULATION',ownership_bound:true,ownership_exclusive:true,durable_replay_protection:true,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:[]};
 const durable=prepareHermesMaintainerSafeWorkflowDurableTarget(ownership,{operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,base_sha:BASE_SHA,branch_name:BRANCH});
 return {approval,grant,single,durable,intentDigest:fp.intent_digest};
}

function eligibilityInput(){
 const e=buildEvidence();
 const target={target_type:TARGET_TYPE,repository:REPOSITORY,base_ref:BASE_REF,base_sha:BASE_SHA,branch_name:BRANCH,target_digest:null};
 target.target_digest=computeA3TargetDigest(target);
 const operator={operator_id:'operator-a3-preexecution',source_reference:'operator-proof-a3-preexecution',identity_verified:true,scope_verified:true,operator_binding_digest:null};
 operator.operator_binding_digest=computeA3OperatorBindingDigest(operator);
 return {eligibility_id:'a3-preexecution-proof',capability_id:CAPABILITY_ID,environment:'staging',operation:'create_branch',target_reference:target,action_intent_digest:e.intentDigest,operator_binding:operator,source_evidence:{family:SOURCE_FAMILY,approval_binding:e.approval,authorization_grant:e.grant,single_use_authorization:e.single,durable_target:e.durable},cost_control:{requested_units:0,maximum_units:0},protected_actions:Object.fromEntries(PROTECTED_ACTION_FIELDS.map(field=>[field,false])),evaluation_time:'2026-10-16T12:15:00.000Z'};
}

function canary(branch=BRANCH,sha=BASE_SHA){return prepareHermesMaintainerGithubWriteCanary({repository:REPOSITORY,operation:'create_branch',ref:`refs/heads/${branch}`,sha});}
function admission(intentDigest,branch=BRANCH,sha=BASE_SHA){return {contract_version:'hermes_maintainer_github_durable_write_admission_v1',status:'GITHUB_DURABLE_WRITE_REQUEST_ADMITTED',admission_valid:true,provider:'GITHUB',operation:'create_branch',repository:REPOSITORY,ownership_source:'DURABLE_PERSISTENCE_RECEIPT',intent_digest:intentDigest,execution_authorized:true,request:{method:'POST',url:URL,body:{ref:`refs/heads/${branch}`,sha}},network_call_performed:false,write_performed:false,production_used:false};}

function runnerFixture(){
 let fetchCalls=0;
 let timeoutCalls=0;
 const runner=createHermesMaintainerGithubWriteCanaryRuntimeRunner({
  environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},
  fetchImpl:async()=>{fetchCalls++;return {status:201};},
  createTimeoutSignal:()=>{timeoutCalls++;return new AbortController().signal;}
 });
 return {runner,get fetchCalls(){return fetchCalls;},get timeoutCalls(){return timeoutCalls;}};
}

test('runner construction is inert and exposes A3 preexecution gate before guarded execution',()=>{
 const fixture=runnerFixture();
 assert.equal(fixture.runner.runner_version,'hermes_maintainer_github_write_canary_runtime_runner_v2');
 assert.equal(fixture.runner.preexecution_gate_version,'hermes_a3_maintainer_github_write_preexecution_gate_v1');
 assert.equal(fixture.runner.environment,'staging');
 assert.equal(fixture.runner.credential_reference,'github_create_branch_staging');
 assert.equal(fixture.runner.credential_material_present,false);
 assert.equal(typeof fixture.runner.preflight,'function');
 assert.equal(typeof fixture.runner.execute,'function');
 assert.equal(fixture.fetchCalls,0);
 assert.equal(fixture.timeoutCalls,0);
});

test('preflight accepts only official A3 evidence bound to the same canary and durable admission without side effects',async()=>{
 const fixture=runnerFixture();
 const input=eligibilityInput();
 const result=await fixture.runner.preflight(input,canary(),admission(input.action_intent_digest));
 assert.equal(result.status,PREEXECUTION_READY);
 assert.equal(result.preexecution_ready,true);
 assert.equal(result.a3_eligible,true);
 assert.equal(result.execution_authorized,false);
 assert.equal(result.execution_started,false);
 assert.equal(result.execution_performed,false);
 assert.equal(result.network_call_performed,false);
 assert.equal(result.write_performed,false);
 assert.equal(result.production_used,false);
 assert.deepEqual(result.blockers,[]);
 assert.equal(fixture.fetchCalls,0);
 assert.equal(fixture.timeoutCalls,0);
});

test('preflight rejects forged eligibility summaries because it re-evaluates official source evidence',async()=>{
 const fixture=runnerFixture();
 const forged={eligibility_id:'forged',a3_eligible:true,status:'A3_SCOPED_EXTERNAL_ACTION_ELIGIBLE',base_sha:BASE_SHA,action_intent_digest:`sha256:${'3'.repeat(64)}`};
 const result=await fixture.runner.preflight(forged,canary(),admission(forged.action_intent_digest));
 assert.equal(result.status,PREEXECUTION_BLOCKED);
 assert.equal(result.preexecution_ready,false);
 assert.ok(result.blockers.includes('A3_ELIGIBILITY_INVALID'));
 assert.equal(fixture.fetchCalls,0);
});

test('preflight fails closed when exact target SHA or branch drifts from the A3 evidence',async()=>{
 const fixture=runnerFixture();
 const input=eligibilityInput();
 const otherCanary=canary('hermes/canary/a3-preexecution-other','b'.repeat(40));
 const otherAdmission=admission(input.action_intent_digest,'hermes/canary/a3-preexecution-other','b'.repeat(40));
 const result=await fixture.runner.preflight(input,otherCanary,otherAdmission);
 assert.equal(result.status,PREEXECUTION_BLOCKED);
 assert.ok(result.blockers.includes('A3_TARGET_BINDING_MISMATCH'));
 assert.ok(result.blockers.includes('A3_BASE_SHA_BINDING_MISMATCH'));
 assert.equal(fixture.fetchCalls,0);
});

test('preflight fails closed when durable admission intent is not the A3 intent',async()=>{
 const fixture=runnerFixture();
 const input=eligibilityInput();
 const result=await fixture.runner.preflight(input,canary(),admission(`sha256:${'9'.repeat(64)}`));
 assert.equal(result.status,PREEXECUTION_BLOCKED);
 assert.ok(result.blockers.includes('A3_ADMISSION_INTENT_BINDING_MISMATCH'));
 assert.equal(fixture.fetchCalls,0);
});

test('execute cannot reach runtime when A3 evidence is absent even if canary and admission look valid',async()=>{
 const fixture=runnerFixture();
 const input=eligibilityInput();
 const result=await fixture.runner.execute({},canary(),admission(input.action_intent_digest));
 assert.equal(result.status,'CANARY_EXECUTION_BLOCKED');
 assert.equal(result.execution_performed,false);
 assert.equal(result.network_call_performed,false);
 assert.equal(result.write_performed,false);
 assert.ok(result.blockers.includes('A3_ELIGIBILITY_INVALID'));
 assert.equal(fixture.fetchCalls,0);
 assert.equal(fixture.timeoutCalls,0);
});

test('official A3 evidence cannot bypass the existing canary/admission guard',async()=>{
 const fixture=runnerFixture();
 const input=eligibilityInput();
 const invalidAdmission={...admission(input.action_intent_digest),admission_valid:false};
 const result=await fixture.runner.preflight(input,canary(),invalidAdmission);
 assert.equal(result.status,PREEXECUTION_BLOCKED);
 assert.ok(result.blockers.includes('A3_CANARY_ADMISSION_GUARD_BLOCKED'));
 assert.ok(result.blockers.includes('DURABLE_ADMISSION_INVALID'));
 assert.equal(fixture.fetchCalls,0);
});

test('runner requires explicit dependencies and never falls back to globals',()=>{
 assert.throws(()=>createHermesMaintainerGithubWriteCanaryRuntimeRunner({}),/environment_required/);
 assert.throws(()=>createHermesMaintainerGithubWriteCanaryRuntimeRunner({environment:{}}),/fetchImpl_required/);
 assert.throws(()=>createHermesMaintainerGithubWriteCanaryRuntimeRunner({environment:{},fetchImpl:async()=>({status:201})}),/createTimeoutSignal_required/);
});
