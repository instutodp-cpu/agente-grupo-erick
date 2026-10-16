'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHermesMaintainerGithubWriteOperationalCanaryComposition}=require('../src/runtime/hermes-maintainer-github-write-operational-canary-composition');
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
const sha='b'.repeat(40);
const branch='hermes/canary/final-link';

function fixture(){
 const intent=buildHermesMaintainerScmWriteIntent({provider:'GITHUB',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,branch_name:branch});
 const fp=fingerprintHermesMaintainerScmWriteIntent(intent);
 const approvalRequest=buildHermesMaintainerScmWriteApprovalRequest(intent,fp);
 const approval=bindHermesMaintainerScmWriteApproval(approvalRequest,{decision:'APPROVED',intent_digest:fp.intent_digest,approval_reference:'human-final-link'});
 const authRequest=buildHermesMaintainerScmWriteAuthorizationRequest(approval);
 const grant=grantHermesMaintainerScmWriteAuthorization(authRequest,{decision:'AUTHORIZED',intent_digest:fp.intent_digest,authorization_reference:'control-final-link'});
 const gate={contract_version:'hermes_maintainer_staging_gate_v1',mission_id:'mission-final-link',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,status:'MAINTAINER_STAGING_GATE_PASSED_SIMULATION',staging_gate_passed:true,real_execution_enabled:false,production_enabled:false,network_enabled:false,credentials_enabled:false,write_enabled:false,simulation:true,blockers:[]};
 const single=buildHermesMaintainerSingleUseAuthorization(gate,{authorization_id:'single-final-link',issued_at:'2026-10-16T03:00:00.000Z',expires_at:'2026-10-16T04:00:00.000Z'});
 const ownership={contract_version:'hermes_maintainer_safe_workflow_durable_ownership_binding_v1',mission_id:'mission-final-link',workflow_digest:`sha256:${'1'.repeat(64)}`,intent_digest:fp.intent_digest,intent_count:1,authorization_binding_digest:`sha256:${'2'.repeat(64)}`,workflow_operation:'branch_prepare',durable_operation:'create_branch',target_handoff_contract:'hermes_maintainer_scm_write_durable_admission_handoff_v1',repository:REPOSITORY,base_ref:BASE_REF,ownership_source:'DURABLE_PERSISTENCE_RECEIPT',ownership_key:'final-link::attempt-ownership',persistence_key:'final-link',attempt_reference:'attempt-final-link',status:'MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_BOUND_SIMULATION',ownership_bound:true,ownership_exclusive:true,durable_replay_protection:true,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:[]};
 const durable=prepareHermesMaintainerSafeWorkflowDurableTarget(ownership,{operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,base_sha:sha,branch_name:branch});
 const target={target_type:TARGET_TYPE,repository:REPOSITORY,base_ref:BASE_REF,base_sha:sha,branch_name:branch,target_digest:null};
 target.target_digest=computeA3TargetDigest(target);
 const operator={operator_id:'operator-final-link',source_reference:'operator-proof-final-link',identity_verified:true,scope_verified:true,operator_binding_digest:null};
 operator.operator_binding_digest=computeA3OperatorBindingDigest(operator);
 const eligibility={eligibility_id:'a3-final-link',capability_id:CAPABILITY_ID,environment:'staging',operation:'create_branch',target_reference:target,action_intent_digest:fp.intent_digest,operator_binding:operator,source_evidence:{family:SOURCE_FAMILY,approval_binding:approval,authorization_grant:grant,single_use_authorization:single,durable_target:durable},cost_control:{requested_units:0,maximum_units:0},protected_actions:Object.fromEntries(PROTECTED_ACTION_FIELDS.map(field=>[field,false])),evaluation_time:'2026-10-16T03:15:00.000Z'};
 const canary=prepareHermesMaintainerGithubWriteCanary({repository:REPOSITORY,operation:'create_branch',ref:'refs/heads/'+branch,sha});
 return {eligibility,grant,canary};
}

function input(){return {consumption_reference:'consume-final',attempt_reference:'attempt-final',capability_reference:'cap-final',admission_reference:'admission-final'};}
function pool(){
 const rows=new Map();
 const client={async query(sql,args){if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};const table=sql.includes('attempt_ownership')?'ownership':'consumption',key=args[0];if(sql.startsWith('SELECT ')){const row=rows.get(table+':'+key);return {rows:row?[row]:[]};}if(rows.has(table+':'+key))return {rows:[]};const row=table==='ownership'?{ownership_key:args[0],persistence_key:args[1],intent_digest:args[2],authorization_reference:args[3],consumption_reference:args[4],attempt_reference:args[5]}:{persistence_key:args[0],intent_digest:args[1],authorization_reference:args[2],consumption_reference:args[3]};rows.set(table+':'+key,row);return {rows:[row]};},release(){}};
 return {connect:async()=>client,async query(sql,args){const table=sql.includes('attempt_ownership')?'ownership':'consumption',row=rows.get(table+':'+args[0]);return {rows:row?[row]:[]};}};
}

function compositionWith(fetchImpl,persistencePool=pool()){
 return createHermesMaintainerGithubWriteOperationalCanaryComposition({pool:persistencePool,environment:{HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN:'synthetic-token'},fetchImpl,createTimeoutSignal:()=>new AbortController().signal});
}

test('links A3-qualified operational admission to guarded canary runner',async()=>{
 let fetchCalls=0,seen;
 const f=fixture();
 const composition=compositionWith(async(url,options)=>{fetchCalls++;seen={url,options};return {status:201};});
 const out=await composition.execute(f.eligibility,f.grant,f.canary,input());
 assert.equal(fetchCalls,1);
 assert.equal(seen.url,'https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/git/refs');
 assert.equal(seen.options.method,'POST');
 assert.deepEqual(JSON.parse(seen.options.body),{ref:'refs/heads/'+branch,sha});
 assert.equal(out.status,'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED');
 assert.equal(out.network_call_performed,true);
 assert.equal(out.production_used,false);
});

test('legacy three-argument path fails closed before persistence or provider call',async()=>{
 let fetchCalls=0,persistenceTouched=false;
 const f=fixture();
 const failPool={connect:async()=>{persistenceTouched=true;throw new Error('persistence_must_not_run');},query:async()=>{persistenceTouched=true;throw new Error('persistence_must_not_run');}};
 const composition=compositionWith(async()=>{fetchCalls++;return {status:201};},failPool);
 const out=await composition.execute(f.grant,f.canary,input());
 assert.equal(out.status,'OPERATIONAL_CANARY_EXECUTION_BLOCKED');
 assert.deepEqual(out.blockers,['DURABLE_ADMISSION_NOT_CONFIRMED']);
 assert.equal(fetchCalls,0);
 assert.equal(persistenceTouched,false);
 assert.equal(out.network_call_performed,false);
 assert.equal(out.write_performed,false);
});

test('replay fails closed before a second provider call',async()=>{
 let fetchCalls=0;
 const f=fixture();
 const composition=compositionWith(async()=>{fetchCalls++;return {status:201};});
 const first=await composition.execute(f.eligibility,f.grant,f.canary,input());
 const replay=await composition.execute(f.eligibility,f.grant,f.canary,input());
 assert.equal(first.status,'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED');
 assert.equal(replay.status,'OPERATIONAL_CANARY_EXECUTION_BLOCKED');
 assert.equal(fetchCalls,1);
 assert.equal(replay.network_call_performed,false);
 assert.equal(replay.write_performed,false);
});

test('invalid canary fails closed with zero provider calls',async()=>{
 let fetchCalls=0;
 const f=fixture();
 const composition=compositionWith(async()=>{fetchCalls++;return {status:201};});
 const out=await composition.execute(f.eligibility,f.grant,{...f.canary,ref:'refs/heads/main'},input());
 assert.equal(out.status,'OPERATIONAL_CANARY_EXECUTION_BLOCKED');
 assert.equal(fetchCalls,0);
 assert.equal(out.network_call_performed,false);
});

test('construction is inert',()=>{
 let fetchCalls=0;
 const composition=compositionWith(async()=>{fetchCalls++;return {status:201};});
 assert.equal(composition.composition_version,'hermes_maintainer_github_write_operational_canary_composition_v2');
 assert.equal(composition.credential_material_present,false);
 assert.equal(composition.network_call_performed,false);
 assert.equal(composition.write_performed,false);
 assert.equal(fetchCalls,0);
});
