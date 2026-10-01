'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { ROUTED, validateHermesMaintainerSafeWorkflowDurableHandoffRouting } = require('./hermes-maintainer-safe-workflow-durable-handoff-routing');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_durable_execution_requirement_v1';
const READY='MAINTAINER_SAFE_WORKFLOW_DURABLE_EXECUTION_REQUIREMENT_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_DURABLE_EXECUTION_REQUIREMENT_BLOCKED';
const REQUIREMENTS=Object.freeze({
 create_branch:Object.freeze({admission_contract:'hermes_maintainer_github_durable_write_admission_v1',execution_boundary_contract:'hermes_maintainer_github_durable_write_execution_boundary_v1'}),
 update_file:Object.freeze({admission_contract:'hermes_maintainer_github_update_file_durable_admission_v1',execution_boundary_contract:'hermes_maintainer_github_update_file_durable_execution_boundary_v1'}),
 create_pull_request:Object.freeze({admission_contract:'hermes_maintainer_github_create_pull_request_durable_admission_v1',execution_boundary_contract:'hermes_maintainer_github_create_pull_request_durable_execution_boundary_v1'})
});
function requireHermesMaintainerSafeWorkflowDurableExecution(routing){
 const blockers=[],rv=validateHermesMaintainerSafeWorkflowDurableHandoffRouting(routing);
 if(!rv.valid)blockers.push(...rv.errors.map(e=>`handoff_routing::${e}`));
 if(rv.valid&&(routing.status!==ROUTED||routing.handoff_routed!==true||routing.handoff?.handoff_valid!==true))blockers.push('durable_handoff_not_ready');
 const requirement=REQUIREMENTS[routing?.durable_operation];if(!requirement)blockers.push('durable_operation_unsupported');
 if(routing?.handoff?.intent_digest!==routing?.intent_digest||routing?.handoff?.ownership_key!==routing?.ownership_key||routing?.handoff?.attempt_reference!==routing?.attempt_reference)blockers.push('handoff_identity_mismatch');
 const u=uniqueSorted(blockers),ready=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ready?routing.mission_id:'mission_not_available',workflow_digest:ready?routing.workflow_digest:null,intent_digest:ready?routing.intent_digest:null,authorization_binding_digest:ready?routing.authorization_binding_digest:null,durable_operation:ready?routing.durable_operation:null,ownership_key:ready?routing.ownership_key:null,attempt_reference:ready?routing.attempt_reference:null,admission_contract:ready?requirement.admission_contract:null,execution_boundary_contract:ready?requirement.execution_boundary_contract:null,status:ready?READY:BLOCKED,execution_requirement_prepared:ready,admission_invoked:false,execution_boundary_invoked:false,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowDurableExecutionRequirement(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['durable_execution_requirement_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![READY,BLOCKED].includes(v.status)||v.execution_requirement_prepared!==(v.status===READY))e.push('status_invalid');
 if(v.execution_requirement_prepared&&(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.durable_operation)||!isNonEmptyString(v.ownership_key)||!isNonEmptyString(v.attempt_reference)||!isNonEmptyString(v.admission_contract)||!isNonEmptyString(v.execution_boundary_contract)))e.push('identity_invalid');
 for(const f of ['admission_invoked','execution_boundary_invoked','execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.execution_requirement_prepared&&v.blockers.length)e.push('ready_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,READY,REQUIREMENTS,requireHermesMaintainerSafeWorkflowDurableExecution,validateHermesMaintainerSafeWorkflowDurableExecutionRequirement};
