'use strict';
const { isNonEmptyString, isPlainObject, uniqueSorted }=require('./read-only-adapter-contract');
const { BOUND, validateHermesMaintainerSafeWorkflowAuthorityEvidenceBinding }=require('./hermes-maintainer-safe-workflow-authority-evidence-binding');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_authorized_composition_requirement_v1';
const READY='MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_COMPOSITION_REQUIREMENT_PREPARED_SIMULATION',BLOCKED='MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_COMPOSITION_REQUIREMENT_BLOCKED';
const COMPOSITIONS=Object.freeze({
 create_branch:Object.freeze(['hermes_maintainer_scm_write_durable_capability_v1','hermes_maintainer_github_durable_create_branch_request_v1','hermes_maintainer_github_durable_write_admission_v1']),
 update_file:Object.freeze(['hermes_maintainer_github_update_file_capability_v1','hermes_maintainer_github_update_file_request_v1','hermes_maintainer_github_update_file_admission_v1','hermes_maintainer_github_update_file_durable_admission_v1']),
 create_pull_request:Object.freeze(['hermes_maintainer_github_create_pull_request_capability_v1','hermes_maintainer_github_create_pull_request_request_v1','hermes_maintainer_github_create_pull_request_admission_v1','hermes_maintainer_github_create_pull_request_durable_admission_v1'])
});
function requireHermesMaintainerSafeWorkflowAuthorizedComposition(binding){
 const blockers=[],bv=validateHermesMaintainerSafeWorkflowAuthorityEvidenceBinding(binding);
 if(!bv.valid)blockers.push(...bv.errors.map(e=>`authority_binding::${e}`));
 if(bv.valid&&(binding.status!==BOUND||binding.authority_evidence_bound!==true))blockers.push('authority_evidence_not_bound');
 const chain=COMPOSITIONS[binding?.durable_operation];if(!chain)blockers.push('durable_operation_unsupported');
 const u=uniqueSorted(blockers),ready=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ready?binding.mission_id:'mission_not_available',workflow_digest:ready?binding.workflow_digest:null,intent_digest:ready?binding.intent_digest:null,authorization_binding_digest:ready?binding.authorization_binding_digest:null,durable_operation:ready?binding.durable_operation:null,ownership_key:ready?binding.ownership_key:null,attempt_reference:ready?binding.attempt_reference:null,status:ready?READY:BLOCKED,authorized_composition_prepared:ready,required_contract_chain:ready?chain:null,authority_consumption_point:ready?chain.at(-1):null,authority_grant_invoked:false,authority_consumed:false,composition_invoked:false,durable_admission_invoked:false,execution_boundary_invoked:false,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowAuthorizedCompositionRequirement(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['authorized_composition_requirement_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![READY,BLOCKED].includes(v.status)||v.authorized_composition_prepared!==(v.status===READY))e.push('status_invalid');
 if(v.authorized_composition_prepared&&(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.durable_operation)||!Array.isArray(v.required_contract_chain)||v.required_contract_chain.length<3||!v.required_contract_chain.every(isNonEmptyString)||v.authority_consumption_point!==v.required_contract_chain.at(-1)))e.push('composition_invalid');
 for(const f of ['authority_grant_invoked','authority_consumed','composition_invoked','durable_admission_invoked','execution_boundary_invoked','execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,COMPOSITIONS,CONTRACT_VERSION,READY,requireHermesMaintainerSafeWorkflowAuthorizedComposition,validateHermesMaintainerSafeWorkflowAuthorizedCompositionRequirement};
