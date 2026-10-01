'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { PREPARED, validateHermesMaintainerSafeWorkflowDurableAdmissionIntent } = require('./hermes-maintainer-safe-workflow-durable-admission-intent');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_durable_ownership_requirement_v1';
const OWNERSHIP_CONTRACT='hermes_maintainer_scm_write_durable_ownership_binding_v1';
const READY='MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_REQUIRED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_REQUIREMENT_BLOCKED';

function requireHermesMaintainerSafeWorkflowDurableOwnership(admissionIntent){
 const blockers=[],iv=validateHermesMaintainerSafeWorkflowDurableAdmissionIntent(admissionIntent);
 if(!iv.valid)blockers.push(...iv.errors.map(e=>`admission_intent::${e}`));
 if(iv.valid&&(admissionIntent.status!==PREPARED||admissionIntent.admission_intent_prepared!==true))blockers.push('durable_admission_intent_not_ready');
 const u=uniqueSorted(blockers),ready=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ready?admissionIntent.mission_id:'mission_not_available',workflow_digest:ready?admissionIntent.workflow_digest:null,intent_digest:ready?admissionIntent.intent_digest:null,intent_count:ready?admissionIntent.intent_count:0,authorization_binding_digest:ready?admissionIntent.authorization_binding_digest:null,workflow_operation:ready?admissionIntent.workflow_operation:'operation_not_available',durable_operation:ready?admissionIntent.durable_operation:null,target_handoff_contract:ready?admissionIntent.target_handoff_contract:null,required_ownership_contract:OWNERSHIP_CONTRACT,repository:ready?admissionIntent.repository:'repository_not_available',base_ref:ready?admissionIntent.base_ref:'ref_not_available',status:ready?READY:BLOCKED,ownership_requirement_ready:ready,ownership_bound:false,ownership_exclusive_required:true,durable_replay_protection_required:true,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowDurableOwnershipRequirement(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['ownership_requirement_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![READY,BLOCKED].includes(v.status)||v.ownership_requirement_ready!==(v.status===READY))e.push('status_invalid');
 if(v.required_ownership_contract!==OWNERSHIP_CONTRACT||v.ownership_bound!==false||v.ownership_exclusive_required!==true||v.durable_replay_protection_required!==true)e.push('ownership_boundary_invalid');
 if(v.ownership_requirement_ready&&(!isNonEmptyString(v.mission_id)||!isCanonicalContentDigest(v.workflow_digest)||!isCanonicalContentDigest(v.intent_digest)||!isCanonicalContentDigest(v.authorization_binding_digest)||!isNonEmptyString(v.durable_operation)||!isNonEmptyString(v.target_handoff_contract)||!isNonEmptyString(v.repository)||!isNonEmptyString(v.base_ref)))e.push('identity_invalid');
 if(v.ownership_requirement_ready&&(!Number.isInteger(v.intent_count)||v.intent_count<1))e.push('intent_count_invalid');
 for(const f of ['execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.ownership_requirement_ready&&v.blockers.length)e.push('ready_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,OWNERSHIP_CONTRACT,READY,requireHermesMaintainerSafeWorkflowDurableOwnership,validateHermesMaintainerSafeWorkflowDurableOwnershipRequirement};
