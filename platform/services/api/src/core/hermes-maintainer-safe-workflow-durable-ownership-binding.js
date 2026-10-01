'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { READY, OWNERSHIP_CONTRACT, validateHermesMaintainerSafeWorkflowDurableOwnershipRequirement } = require('./hermes-maintainer-safe-workflow-durable-ownership-requirement');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_durable_ownership_binding_v1';
const BOUND='MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_BOUND_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_BINDING_BLOCKED';

function bindHermesMaintainerSafeWorkflowDurableOwnership(requirement,ownership){
 const blockers=[],rv=validateHermesMaintainerSafeWorkflowDurableOwnershipRequirement(requirement);
 if(!rv.valid)blockers.push(...rv.errors.map(e=>`requirement::${e}`));
 if(rv.valid&&(requirement.status!==READY||requirement.ownership_requirement_ready!==true))blockers.push('ownership_requirement_not_ready');
 if(!ownership||ownership.contract_version!==OWNERSHIP_CONTRACT||ownership.status!=='SCM_WRITE_DURABLE_OWNERSHIP_BOUND'||ownership.binding_valid!==true||ownership.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT')blockers.push('durable_ownership_invalid');
 if(ownership?.intent_digest!==requirement?.intent_digest)blockers.push('intent_digest_mismatch');
 if(ownership?.durable_replay_protection!==true||ownership?.ownership_exclusive!==true)blockers.push('durable_ownership_guarantees_invalid');
 if(ownership?.execution_authorized!==false||ownership?.credential_material_present!==false||ownership?.network_call_performed!==false||ownership?.write_performed!==false||ownership?.production_used!==false)blockers.push('durable_ownership_state_invalid');
 const u=uniqueSorted(blockers),bound=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:bound?requirement.mission_id:'mission_not_available',workflow_digest:bound?requirement.workflow_digest:null,intent_digest:bound?requirement.intent_digest:null,intent_count:bound?requirement.intent_count:0,authorization_binding_digest:bound?requirement.authorization_binding_digest:null,workflow_operation:bound?requirement.workflow_operation:'operation_not_available',durable_operation:bound?requirement.durable_operation:null,target_handoff_contract:bound?requirement.target_handoff_contract:null,repository:bound?requirement.repository:'repository_not_available',base_ref:bound?requirement.base_ref:'ref_not_available',ownership_source:bound?ownership.ownership_source:null,ownership_key:bound?ownership.ownership_key:null,persistence_key:bound?ownership.persistence_key:null,attempt_reference:bound?ownership.attempt_reference:null,status:bound?BOUND:BLOCKED,ownership_bound:bound,ownership_exclusive:bound,durable_replay_protection:bound,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowDurableOwnershipBinding(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['ownership_binding_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![BOUND,BLOCKED].includes(v.status)||v.ownership_bound!==(v.status===BOUND))e.push('status_invalid');
 if(v.ownership_bound&&(!isNonEmptyString(v.mission_id)||!isCanonicalContentDigest(v.workflow_digest)||!isCanonicalContentDigest(v.intent_digest)||!isCanonicalContentDigest(v.authorization_binding_digest)||!isNonEmptyString(v.durable_operation)||!isNonEmptyString(v.target_handoff_contract)||!isNonEmptyString(v.repository)||!isNonEmptyString(v.base_ref)||v.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT'||!isNonEmptyString(v.ownership_key)||!isNonEmptyString(v.persistence_key)||!isNonEmptyString(v.attempt_reference)))e.push('identity_invalid');
 if(v.ownership_bound&&(!Number.isInteger(v.intent_count)||v.intent_count<1))e.push('intent_count_invalid');
 if(v.ownership_exclusive!==v.ownership_bound||v.durable_replay_protection!==v.ownership_bound)e.push('ownership_guarantees_invalid');
 for(const f of ['execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.ownership_bound&&v.blockers.length)e.push('bound_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,BOUND,CONTRACT_VERSION,bindHermesMaintainerSafeWorkflowDurableOwnership,validateHermesMaintainerSafeWorkflowDurableOwnershipBinding};
