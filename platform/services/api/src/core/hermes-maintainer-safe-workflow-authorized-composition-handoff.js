'use strict';
const { isNonEmptyString, isPlainObject, uniqueSorted }=require('./read-only-adapter-contract');
const { READY, validateHermesMaintainerSafeWorkflowAuthorizedCompositionRequirement }=require('./hermes-maintainer-safe-workflow-authorized-composition-requirement');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_authorized_composition_handoff_v1';
const PREPARED='MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_COMPOSITION_HANDOFF_PREPARED_SIMULATION',BLOCKED='MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_COMPOSITION_HANDOFF_BLOCKED';
const SOURCE_BINDINGS=Object.freeze({create_branch:'hermes_maintainer_github_write_source_binding_v1',update_file:'hermes_maintainer_github_update_file_source_binding_v1',create_pull_request:'hermes_maintainer_github_create_pull_request_source_binding_v1'});
function prepareHermesMaintainerSafeWorkflowAuthorizedCompositionHandoff(requirement){
 const blockers=[],rv=validateHermesMaintainerSafeWorkflowAuthorizedCompositionRequirement(requirement);
 if(!rv.valid)blockers.push(...rv.errors.map(e=>`composition_requirement::${e}`));
 if(rv.valid&&(requirement.status!==READY||requirement.authorized_composition_prepared!==true))blockers.push('authorized_composition_not_ready');
 const source=SOURCE_BINDINGS[requirement?.durable_operation];if(!source)blockers.push('source_binding_unsupported');
 const u=uniqueSorted(blockers),prepared=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:prepared?requirement.mission_id:'mission_not_available',workflow_digest:prepared?requirement.workflow_digest:null,intent_digest:prepared?requirement.intent_digest:null,authorization_binding_digest:prepared?requirement.authorization_binding_digest:null,durable_operation:prepared?requirement.durable_operation:null,ownership_key:prepared?requirement.ownership_key:null,attempt_reference:prepared?requirement.attempt_reference:null,status:prepared?PREPARED:BLOCKED,authorized_composition_handoff_prepared:prepared,required_contract_chain:prepared?requirement.required_contract_chain:null,authority_consumption_point:prepared?requirement.authority_consumption_point:null,credential_source_binding_contract:prepared?source:null,credential_resolution_required:prepared,credential_resolution_invoked:false,credential_material_present:false,authority_consumed:false,composition_invoked:false,durable_admission_invoked:false,execution_boundary_invoked:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowAuthorizedCompositionHandoff(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['authorized_composition_handoff_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![PREPARED,BLOCKED].includes(v.status)||v.authorized_composition_handoff_prepared!==(v.status===PREPARED))e.push('status_invalid');
 if(v.authorized_composition_handoff_prepared&&(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.durable_operation)||!Array.isArray(v.required_contract_chain)||!v.required_contract_chain.every(isNonEmptyString)||!isNonEmptyString(v.credential_source_binding_contract)||v.credential_resolution_required!==true))e.push('handoff_invalid');
 for(const f of ['credential_resolution_invoked','credential_material_present','authority_consumed','composition_invoked','durable_admission_invoked','execution_boundary_invoked','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,PREPARED,SOURCE_BINDINGS,prepareHermesMaintainerSafeWorkflowAuthorizedCompositionHandoff,validateHermesMaintainerSafeWorkflowAuthorizedCompositionHandoff};
