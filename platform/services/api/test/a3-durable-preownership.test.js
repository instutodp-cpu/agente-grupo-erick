'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildUpdateA3,buildPullA3}=require('./helpers/a3-maintenance-operation-test-data');
const a3=require('../src/core/a3-scoped-external-action-eligibility');
function pending(data){return{...data.eligibilityInput,source_evidence:{...data.eligibilityInput.source_evidence,durable_target:null}};}
function owner(data,overrides={}){return{
 contract_version:'hermes_maintainer_scm_write_durable_ownership_binding_v1',
 status:'SCM_WRITE_DURABLE_OWNERSHIP_BOUND',binding_valid:true,ownership_source:'DURABLE_PERSISTENCE_RECEIPT',
 ownership_key:'proof-001::attempt-ownership',persistence_key:'proof-001',
 intent_digest:data.grant.intent_digest,authorization_reference:data.grant.authorization_reference,
 consumption_reference:'consume-001',attempt_reference:'attempt-001',
 durable_replay_protection:true,ownership_exclusive:true,execution_authorized:false,
 credential_material_present:false,network_call_performed:false,write_performed:false,
 production_used:false,blockers:[],...overrides};}
for(const make of [buildUpdateA3,buildPullA3]){
 const operation=make().eligibilityInput.operation;
 test(operation+' pending ownership accepts only strict scoped A3; does not authorize',()=>{
  const data=make(),candidate=pending(data);
  assert.equal(a3.validateA3ScopedExternalActionPreOwnershipInput(candidate).valid,true);
  assert.equal(a3.evaluateA3ScopedExternalActionEligibility(candidate).a3_eligible,false);
  for(const bad of [
   {...candidate,source_evidence:{...candidate.source_evidence,durable_target:{authorized:true}}},
   {...candidate,environment:'production'},
   {...candidate,protected_actions:{...candidate.protected_actions,merge_main:true}},
   {...candidate,action_intent_digest:'sha256:'+'c'.repeat(64)},
   {...candidate,source_evidence:{...candidate.source_evidence,authorization_grant:{...data.grant,approval_reference:'drift'},durable_target:null}}
  ])assert.equal(a3.validateA3ScopedExternalActionPreOwnershipInput(bad).valid,false);
 });
 test(operation+' fully rejects fake ownership and binds real receipt shape',()=>{
  const data=make(),candidate=pending(data),proof=owner(data);
  const full={...candidate,source_evidence:{...candidate.source_evidence,durable_target:proof}};
  assert.equal(a3.evaluateA3ScopedExternalActionEligibility(full).a3_eligible,true);
  for(const mutation of [
   {ownership_source:'SIMULATION'},
   {ownership_key:'wrong'},
   {authorization_reference:'wrong'},
   {intent_digest:'sha256:'+'a'.repeat(64)},
   {durable_replay_protection:false},
   {execution_authorized:true},
   {consumption_reference:''},
   {simulated:true}
  ])assert.equal(a3.evaluateA3ScopedExternalActionEligibility({...candidate,source_evidence:{...candidate.source_evidence,durable_target:owner(data,mutation)}}).a3_eligible,false);
 });
}
