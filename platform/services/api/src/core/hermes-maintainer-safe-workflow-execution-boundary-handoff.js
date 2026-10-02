'use strict';
const {isPlainObject,uniqueSorted}=require('./read-only-adapter-contract');
const {SCOPED,validateHermesMaintainerSafeWorkflowCredentialScopeComposition}=require('./hermes-maintainer-safe-workflow-credential-scope-composition');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_execution_boundary_handoff_v1';
const READY='MAINTAINER_SAFE_WORKFLOW_EXECUTION_BOUNDARY_HANDOFF_READY_SIMULATION',BLOCKED='MAINTAINER_SAFE_WORKFLOW_EXECUTION_BOUNDARY_HANDOFF_BLOCKED';
const BOUNDARIES=Object.freeze({
 create_branch:'hermes_maintainer_github_durable_write_runtime_composition_v1',
 update_file:'hermes_maintainer_github_update_file_runtime_composition_v1',
 create_pull_request:'hermes_maintainer_github_create_pull_request_runtime_composition_v1'
});
function prepareHermesMaintainerSafeWorkflowExecutionBoundaryHandoff(scopeComposition){
 const blockers=[],sv=validateHermesMaintainerSafeWorkflowCredentialScopeComposition(scopeComposition);
 if(!sv.valid)blockers.push(...sv.errors.map(e=>'credential_scope_composition::'+e));
 if(sv.valid&&(scopeComposition.status!==SCOPED||scopeComposition.credential_scope_composed!==true||scopeComposition.execution_authorized!==true))blockers.push('credential_scope_composition_not_ready');
 const boundary=BOUNDARIES[scopeComposition?.durable_operation];if(!boundary)blockers.push('durable_operation_unsupported');
 const u=uniqueSorted(blockers),ok=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ok?scopeComposition.mission_id:'mission_not_available',workflow_digest:ok?scopeComposition.workflow_digest:null,intent_digest:ok?scopeComposition.intent_digest:null,durable_operation:ok?scopeComposition.durable_operation:null,ownership_key:ok?scopeComposition.ownership_key:null,attempt_reference:ok?scopeComposition.attempt_reference:null,capability_reference:ok?scopeComposition.capability_reference:null,admission_reference:ok?scopeComposition.admission_reference:null,status:ok?READY:BLOCKED,execution_boundary_handoff_ready:ok,execution_boundary_contract:ok?boundary:null,credential_reference:ok?scopeComposition.credential_reference:null,credential_scope_contract:ok?scopeComposition.credential_scope_contract:null,credential_resolution_deferred_to_execution:ok,credential_resolution_invoked:false,credential_material_present:false,authorization_header_present:false,authority_consumed:ok,execution_boundary_invoked:false,execution_authorized:ok,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:ok,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowExecutionBoundaryHandoff(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['execution_boundary_handoff_must_be_object']};const ok=v.status===READY;
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![READY,BLOCKED].includes(v.status)||v.execution_boundary_handoff_ready!==ok)e.push('status_invalid');
 if(ok&&(!BOUNDARIES[v.durable_operation]||v.execution_boundary_contract!==BOUNDARIES[v.durable_operation]))e.push('execution_boundary_contract_invalid');
 for(const f of ['credential_resolution_invoked','credential_material_present','authorization_header_present','execution_boundary_invoked','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed'])if(v[f]!==false)e.push(f+'_must_be_false');
 for(const f of ['credential_resolution_deferred_to_execution','authority_consumed','execution_authorized','operational_authority_consumed'])if(v[f]!==ok)e.push(f+'_invalid');
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers))e.push('blockers_invalid');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,READY,prepareHermesMaintainerSafeWorkflowExecutionBoundaryHandoff,validateHermesMaintainerSafeWorkflowExecutionBoundaryHandoff};
