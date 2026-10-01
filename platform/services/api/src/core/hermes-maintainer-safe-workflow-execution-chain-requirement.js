'use strict';
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { READY, validateHermesMaintainerSafeWorkflowDurableExecutionRequirement } = require('./hermes-maintainer-safe-workflow-durable-execution-requirement');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_execution_chain_requirement_v1';
const PREPARED='MAINTAINER_SAFE_WORKFLOW_EXECUTION_CHAIN_REQUIREMENT_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_EXECUTION_CHAIN_REQUIREMENT_BLOCKED';
const CHAINS=Object.freeze({
 create_branch:Object.freeze(['hermes_maintainer_scm_write_durable_capability_v1','hermes_maintainer_github_durable_create_branch_request_v1','hermes_maintainer_github_durable_write_admission_v1','hermes_maintainer_github_durable_write_execution_boundary_v1']),
 update_file:Object.freeze(['hermes_maintainer_github_update_file_capability_v1','hermes_maintainer_github_update_file_request_v1','hermes_maintainer_github_update_file_admission_v1','hermes_maintainer_github_update_file_durable_admission_v1','hermes_maintainer_github_update_file_durable_execution_boundary_v1']),
 create_pull_request:Object.freeze(['hermes_maintainer_github_create_pull_request_capability_v1','hermes_maintainer_github_create_pull_request_request_v1','hermes_maintainer_github_create_pull_request_admission_v1','hermes_maintainer_github_create_pull_request_durable_admission_v1','hermes_maintainer_github_create_pull_request_durable_execution_boundary_v1'])
});
function requireHermesMaintainerSafeWorkflowExecutionChain(requirement){
 const blockers=[],rv=validateHermesMaintainerSafeWorkflowDurableExecutionRequirement(requirement);
 if(!rv.valid)blockers.push(...rv.errors.map(e=>`execution_requirement::${e}`));
 if(rv.valid&&(requirement.status!==READY||requirement.execution_requirement_prepared!==true))blockers.push('execution_requirement_not_ready');
 const chain=CHAINS[requirement?.durable_operation];if(!chain)blockers.push('durable_operation_unsupported');
 if(chain&&(!chain.includes(requirement.admission_contract)||chain.at(-1)!==requirement.execution_boundary_contract))blockers.push('execution_contract_chain_mismatch');
 const u=uniqueSorted(blockers),ready=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ready?requirement.mission_id:'mission_not_available',workflow_digest:ready?requirement.workflow_digest:null,intent_digest:ready?requirement.intent_digest:null,authorization_binding_digest:ready?requirement.authorization_binding_digest:null,durable_operation:ready?requirement.durable_operation:null,ownership_key:ready?requirement.ownership_key:null,attempt_reference:ready?requirement.attempt_reference:null,status:ready?PREPARED:BLOCKED,execution_chain_prepared:ready,required_contract_chain:ready?chain:null,chain_invoked:false,execution_boundary_invoked:false,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowExecutionChainRequirement(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['execution_chain_requirement_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![PREPARED,BLOCKED].includes(v.status)||v.execution_chain_prepared!==(v.status===PREPARED))e.push('status_invalid');
 if(v.execution_chain_prepared&&(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.durable_operation)||!isNonEmptyString(v.ownership_key)||!isNonEmptyString(v.attempt_reference)||!Array.isArray(v.required_contract_chain)||v.required_contract_chain.length<4||!v.required_contract_chain.every(isNonEmptyString)))e.push('identity_invalid');
 for(const f of ['chain_invoked','execution_boundary_invoked','execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.execution_chain_prepared&&v.blockers.length)e.push('ready_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CHAINS,CONTRACT_VERSION,PREPARED,requireHermesMaintainerSafeWorkflowExecutionChain,validateHermesMaintainerSafeWorkflowExecutionChainRequirement};
