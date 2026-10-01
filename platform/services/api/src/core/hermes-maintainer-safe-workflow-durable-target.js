'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { BOUND, validateHermesMaintainerSafeWorkflowDurableOwnershipBinding } = require('./hermes-maintainer-safe-workflow-durable-ownership-binding');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_durable_target_v1';
const READY='MAINTAINER_SAFE_WORKFLOW_DURABLE_TARGET_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_DURABLE_TARGET_BLOCKED';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const BRANCH=/^hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/;
const UPDATE_BRANCH=/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/;
const SHA=/^[a-f0-9]{40}$/;

function prepareHermesMaintainerSafeWorkflowDurableTarget(binding,target={}){
 const blockers=[],bv=validateHermesMaintainerSafeWorkflowDurableOwnershipBinding(binding);
 if(!bv.valid)blockers.push(...bv.errors.map(e=>`ownership_binding::${e}`));
 if(bv.valid&&(binding.status!==BOUND||binding.ownership_bound!==true))blockers.push('ownership_binding_not_ready');
 if(binding?.repository!==REPOSITORY||binding?.base_ref!=='main')blockers.push('binding_scope_invalid');
 const op=binding?.durable_operation;
 if(target.operation!==op||target.repository!==REPOSITORY)blockers.push('target_scope_invalid');
 if(op==='create_branch'){
  if(target.base_ref!=='main'||!isNonEmptyString(target.branch_name)||!BRANCH.test(target.branch_name)||target.branch_name.includes('..')||!isNonEmptyString(target.base_sha)||!SHA.test(target.base_sha))blockers.push('create_branch_target_invalid');
 }else if(op==='update_file'){
  if(!isNonEmptyString(target.branch)||!UPDATE_BRANCH.test(target.branch)||target.branch.includes('..'))blockers.push('update_file_target_invalid');
 }else if(op==='create_pull_request'){
  if(target.base!=='main'||target.draft!==true||!isNonEmptyString(target.head)||!UPDATE_BRANCH.test(target.head)||target.head.includes('..'))blockers.push('create_pull_request_target_invalid');
 }else blockers.push('durable_operation_unsupported');
 const u=uniqueSorted(blockers),ready=u.length===0;
 const material=ready?Object.freeze(op==='create_branch'?{operation:op,repository:REPOSITORY,base_ref:'main',base_sha:target.base_sha,branch_name:target.branch_name}:op==='update_file'?{operation:op,repository:REPOSITORY,branch:target.branch}:{operation:op,repository:REPOSITORY,base:'main',head:target.head,draft:true}):null;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ready?binding.mission_id:'mission_not_available',workflow_digest:ready?binding.workflow_digest:null,intent_digest:ready?binding.intent_digest:null,authorization_binding_digest:ready?binding.authorization_binding_digest:null,durable_operation:ready?op:null,target_handoff_contract:ready?binding.target_handoff_contract:null,ownership_key:ready?binding.ownership_key:null,attempt_reference:ready?binding.attempt_reference:null,status:ready?READY:BLOCKED,target_prepared:ready,target:material,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowDurableTarget(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['durable_target_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![READY,BLOCKED].includes(v.status)||v.target_prepared!==(v.status===READY))e.push('status_invalid');
 if(v.target_prepared&&(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.durable_operation)||!isNonEmptyString(v.target_handoff_contract)||!isNonEmptyString(v.ownership_key)||!isNonEmptyString(v.attempt_reference)||!isPlainObject(v.target)))e.push('identity_invalid');
 for(const f of ['execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.target_prepared&&v.blockers.length)e.push('ready_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,READY,prepareHermesMaintainerSafeWorkflowDurableTarget,validateHermesMaintainerSafeWorkflowDurableTarget};
