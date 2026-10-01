'use strict';
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { PREPARED, validateHermesMaintainerSafeWorkflowExecutionChainRequirement } = require('./hermes-maintainer-safe-workflow-execution-chain-requirement');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_authority_requirement_v1';
const READY='MAINTAINER_SAFE_WORKFLOW_AUTHORITY_REQUIREMENT_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_AUTHORITY_REQUIREMENT_BLOCKED';
const AUTHORITIES=Object.freeze({
 create_branch:Object.freeze({source_contract:'hermes_maintainer_scm_write_durable_admission_handoff_v1',grant_contract:'hermes_maintainer_scm_write_durable_capability_v1',human_approval_required:false,capability:'github_create_branch_staging'}),
 update_file:Object.freeze({source_contract:'hermes_maintainer_github_update_file_authorization_request_v1',grant_contract:'hermes_maintainer_scm_write_authorization_grant_v1',human_approval_required:true,capability:'github_update_file_hermes_branch_staging'}),
 create_pull_request:Object.freeze({source_contract:'hermes_maintainer_github_create_pull_request_authorization_request_v1',grant_contract:'hermes_maintainer_scm_write_authorization_grant_v1',human_approval_required:true,capability:'github_create_pull_request_hermes_branch_staging'})
});
function requireHermesMaintainerSafeWorkflowAuthority(chain){
 const blockers=[],cv=validateHermesMaintainerSafeWorkflowExecutionChainRequirement(chain);
 if(!cv.valid)blockers.push(...cv.errors.map(e=>`execution_chain::${e}`));
 if(cv.valid&&(chain.status!==PREPARED||chain.execution_chain_prepared!==true))blockers.push('execution_chain_not_ready');
 const authority=AUTHORITIES[chain?.durable_operation];if(!authority)blockers.push('durable_operation_unsupported');
 const u=uniqueSorted(blockers),ready=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ready?chain.mission_id:'mission_not_available',workflow_digest:ready?chain.workflow_digest:null,intent_digest:ready?chain.intent_digest:null,authorization_binding_digest:ready?chain.authorization_binding_digest:null,durable_operation:ready?chain.durable_operation:null,ownership_key:ready?chain.ownership_key:null,attempt_reference:ready?chain.attempt_reference:null,status:ready?READY:BLOCKED,authority_requirement_prepared:ready,authority_source_contract:ready?authority.source_contract:null,authority_grant_contract:ready?authority.grant_contract:null,required_capability:ready?authority.capability:null,human_approval_required:ready?authority.human_approval_required:null,authority_grant_present:false,authority_consumed:false,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowAuthorityRequirement(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['authority_requirement_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![READY,BLOCKED].includes(v.status)||v.authority_requirement_prepared!==(v.status===READY))e.push('status_invalid');
 if(v.authority_requirement_prepared&&(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.durable_operation)||!isNonEmptyString(v.authority_source_contract)||!isNonEmptyString(v.authority_grant_contract)||!isNonEmptyString(v.required_capability)||typeof v.human_approval_required!=='boolean'))e.push('identity_invalid');
 for(const f of ['authority_grant_present','authority_consumed','execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.authority_requirement_prepared&&v.blockers.length)e.push('ready_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={AUTHORITIES,BLOCKED,CONTRACT_VERSION,READY,requireHermesMaintainerSafeWorkflowAuthority,validateHermesMaintainerSafeWorkflowAuthorityRequirement};
