'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHermesMaintainerScmWriteIntent } = require('../src/core/hermes-maintainer-scm-write-intent');
const { fingerprintHermesMaintainerScmWriteIntent } = require('../src/core/hermes-maintainer-scm-write-intent-fingerprint');
const { buildHermesMaintainerScmWriteApprovalRequest } = require('../src/core/hermes-maintainer-scm-write-approval-request');
const { bindHermesMaintainerScmWriteApproval } = require('../src/core/hermes-maintainer-scm-write-approval-binding');
const { buildHermesMaintainerScmWriteAuthorizationRequest } = require('../src/core/hermes-maintainer-scm-write-authorization-request');
const { grantHermesMaintainerScmWriteAuthorization } = require('../src/core/hermes-maintainer-scm-write-authorization-grant');
const { buildHermesMaintainerSingleUseAuthorization } = require('../src/core/hermes-maintainer-single-use-execution-authorization');
const { prepareHermesMaintainerSafeWorkflowDurableTarget } = require('../src/core/hermes-maintainer-safe-workflow-durable-target');
const { prepareHermesMaintainerGithubWriteCanary } = require('../src/core/hermes-maintainer-github-write-canary-contract');
const { PROTECTED_ACTION_FIELDS, TARGET_TYPE, CAPABILITY_ID, SOURCE_FAMILY, computeA3TargetDigest, computeA3OperatorBindingDigest, evaluateA3ScopedExternalActionEligibility } = require('../src/core/a3-scoped-external-action-eligibility');

const REPOSITORY='instutodp-cpu/agente-grupo-erick', BASE_REF='main', BRANCH='hermes/canary/a3-proof', BASE_SHA='a'.repeat(40);
function buildEvidence(){
  const intent=buildHermesMaintainerScmWriteIntent({provider:'GITHUB',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,branch_name:BRANCH});
  const fp=fingerprintHermesMaintainerScmWriteIntent(intent);
  const approvalRequest=buildHermesMaintainerScmWriteApprovalRequest(intent,fp);
  const approval=bindHermesMaintainerScmWriteApproval(approvalRequest,{decision:'APPROVED',intent_digest:fp.intent_digest,approval_reference:'human-a3-e2e'});
  const authRequest=buildHermesMaintainerScmWriteAuthorizationRequest(approval);
  const grant=grantHermesMaintainerScmWriteAuthorization(authRequest,{decision:'AUTHORIZED',intent_digest:fp.intent_digest,authorization_reference:'control-a3-e2e'});
  const gate={contract_version:'hermes_maintainer_staging_gate_v1',mission_id:'mission-a3-e2e',operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,status:'MAINTAINER_STAGING_GATE_PASSED_SIMULATION',staging_gate_passed:true,real_execution_enabled:false,production_enabled:false,network_enabled:false,credentials_enabled:false,write_enabled:false,simulation:true,blockers:[]};
  const single=buildHermesMaintainerSingleUseAuthorization(gate,{authorization_id:'single-a3-e2e',issued_at:'2026-10-16T03:00:00.000Z',expires_at:'2026-10-16T04:00:00.000Z'});
  const ownership={contract_version:'hermes_maintainer_safe_workflow_durable_ownership_binding_v1',mission_id:'mission-a3-e2e',workflow_digest:`sha256:${'1'.repeat(64)}`,intent_digest:fp.intent_digest,intent_count:1,authorization_binding_digest:`sha256:${'2'.repeat(64)}`,workflow_operation:'branch_prepare',durable_operation:'create_branch',target_handoff_contract:'hermes_maintainer_scm_write_durable_admission_handoff_v1',repository:REPOSITORY,base_ref:BASE_REF,ownership_source:'DURABLE_PERSISTENCE_RECEIPT',ownership_key:'a3-e2e::attempt-ownership',persistence_key:'a3-e2e',attempt_reference:'attempt-a3-e2e',status:'MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_BOUND_SIMULATION',ownership_bound:true,ownership_exclusive:true,durable_replay_protection:true,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:[]};
  const durable=prepareHermesMaintainerSafeWorkflowDurableTarget(ownership,{operation:'create_branch',repository:REPOSITORY,base_ref:BASE_REF,base_sha:BASE_SHA,branch_name:BRANCH});
  return {approval,grant,single,durable,intentDigest:fp.intent_digest};
}
function eligibilityInput(){
  const e=buildEvidence();
  const target={target_type:TARGET_TYPE,repository:REPOSITORY,base_ref:BASE_REF,base_sha:BASE_SHA,branch_name:BRANCH,target_digest:null};target.target_digest=computeA3TargetDigest(target);
  const operator={operator_id:'operator-a3-e2e',source_reference:'operator-proof-a3-e2e',identity_verified:true,scope_verified:true,operator_binding_digest:null};operator.operator_binding_digest=computeA3OperatorBindingDigest(operator);
  return {eligibility_id:'a3-e2e-proof',capability_id:CAPABILITY_ID,environment:'staging',operation:'create_branch',target_reference:target,action_intent_digest:e.intentDigest,operator_binding:operator,source_evidence:{family:SOURCE_FAMILY,approval_binding:e.approval,authorization_grant:e.grant,single_use_authorization:e.single,durable_target:e.durable},cost_control:{requested_units:0,maximum_units:0},protected_actions:Object.fromEntries(PROTECTED_ACTION_FIELDS.map(f=>[f,false])),evaluation_time:'2026-10-16T03:15:00.000Z'};
}

test('official approval -> authorization -> single-use -> durable exact target -> A3 eligibility composes E2E without execution',()=>{
  const input=eligibilityInput();
  const eligibility=evaluateA3ScopedExternalActionEligibility(input);
  const canary=prepareHermesMaintainerGithubWriteCanary({repository:REPOSITORY,operation:'create_branch',ref:`refs/heads/${BRANCH}`,sha:BASE_SHA});
  assert.equal(eligibility.a3_eligible,true);
  assert.equal(eligibility.base_sha,BASE_SHA);
  assert.equal(canary.canary_valid,true);
  assert.equal(canary.ref,`refs/heads/${input.target_reference.branch_name}`);
  assert.equal(canary.sha,input.target_reference.base_sha);
  assert.equal(eligibility.execution_authorized,false);
  assert.equal(eligibility.external_network_called,false);
  assert.equal(eligibility.provider_invoked,false);
  assert.equal(eligibility.production_allowed,false);
  assert.equal(input.source_evidence.authorization_grant.authorization_consumed,false);
  assert.equal(input.source_evidence.single_use_authorization.consumed,false);
  assert.equal(input.source_evidence.durable_target.operational_authority_consumed,false);
  assert.equal(canary.network_call_performed,false);
  assert.equal(canary.write_performed,false);
});

test('E2E proof fails closed when execution SHA drifts from durable target',()=>{
  const input=eligibilityInput();
  input.target_reference.base_sha='b'.repeat(40);
  input.target_reference.target_digest=computeA3TargetDigest(input.target_reference);
  const eligibility=evaluateA3ScopedExternalActionEligibility(input);
  assert.equal(eligibility.a3_eligible,false);
  assert.ok(eligibility.blockers.includes('durable_target_base_sha_mismatch'));
  assert.equal(eligibility.execution_authorized,false);
  assert.equal(eligibility.external_network_called,false);
});
