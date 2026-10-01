'use strict';
const { isNonEmptyString, isPlainObject, uniqueSorted }=require('./read-only-adapter-contract');
const { READY, validateHermesMaintainerSafeWorkflowAuthorityRequirement }=require('./hermes-maintainer-safe-workflow-authority-requirement');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_authority_evidence_binding_v1';
const BOUND='MAINTAINER_SAFE_WORKFLOW_AUTHORITY_EVIDENCE_BOUND_SIMULATION',BLOCKED='MAINTAINER_SAFE_WORKFLOW_AUTHORITY_EVIDENCE_BLOCKED';
function bindHermesMaintainerSafeWorkflowAuthorityEvidence(requirement,evidence={}){
 const blockers=[],rv=validateHermesMaintainerSafeWorkflowAuthorityRequirement(requirement);
 if(!rv.valid)blockers.push(...rv.errors.map(e=>`authority_requirement::${e}`));
 if(rv.valid&&(requirement.status!==READY||requirement.authority_requirement_prepared!==true))blockers.push('authority_requirement_not_ready');
 if(evidence.decision!=='GRANTED')blockers.push('authority_decision_invalid');
 if(evidence.capability!==requirement?.required_capability)blockers.push('authority_capability_mismatch');
 if(evidence.intent_digest!==requirement?.intent_digest)blockers.push('authority_intent_mismatch');
 if(evidence.attempt_reference!==requirement?.attempt_reference)blockers.push('authority_attempt_mismatch');
 if(!isNonEmptyString(evidence.capability_reference))blockers.push('authority_reference_invalid');
 if(requirement?.human_approval_required===true&&(!isNonEmptyString(evidence.approval_reference)||!isNonEmptyString(evidence.authorization_reference)))blockers.push('human_authorization_evidence_required');
 const u=uniqueSorted(blockers),bound=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:bound?requirement.mission_id:'mission_not_available',workflow_digest:bound?requirement.workflow_digest:null,intent_digest:bound?requirement.intent_digest:null,authorization_binding_digest:bound?requirement.authorization_binding_digest:null,durable_operation:bound?requirement.durable_operation:null,ownership_key:bound?requirement.ownership_key:null,attempt_reference:bound?requirement.attempt_reference:null,status:bound?BOUND:BLOCKED,authority_evidence_bound:bound,authority_source_contract:bound?requirement.authority_source_contract:null,authority_grant_contract:bound?requirement.authority_grant_contract:null,required_capability:bound?requirement.required_capability:null,capability_reference:bound?evidence.capability_reference:null,approval_reference:bound&&requirement.human_approval_required?evidence.approval_reference:null,authorization_reference:bound&&requirement.human_approval_required?evidence.authorization_reference:null,human_approval_required:bound?requirement.human_approval_required:null,authority_grant_invoked:false,authority_consumed:false,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowAuthorityEvidenceBinding(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['authority_evidence_binding_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![BOUND,BLOCKED].includes(v.status)||v.authority_evidence_bound!==(v.status===BOUND))e.push('status_invalid');
 if(v.authority_evidence_bound&&(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.durable_operation)||!isNonEmptyString(v.capability_reference)||typeof v.human_approval_required!=='boolean'))e.push('identity_invalid');
 if(v.authority_evidence_bound&&v.human_approval_required&&(!isNonEmptyString(v.approval_reference)||!isNonEmptyString(v.authorization_reference)))e.push('human_authorization_evidence_invalid');
 for(const f of ['authority_grant_invoked','authority_consumed','execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,BOUND,CONTRACT_VERSION,bindHermesMaintainerSafeWorkflowAuthorityEvidence,validateHermesMaintainerSafeWorkflowAuthorityEvidenceBinding};
