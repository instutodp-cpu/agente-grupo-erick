'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { PREPARED: BINDING_PREPARED, validateHermesMaintainerSafeWorkflowIntentBinding } = require('./hermes-maintainer-safe-workflow-intent-binding');
const { REQUESTED, validateHermesMaintainerExecutionAuthorizationRequest } = require('./hermes-maintainer-execution-authorization-request');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_authorization_admission_v1';
const ADMITTED='MAINTAINER_SAFE_WORKFLOW_AUTHORIZATION_ADMITTED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_AUTHORIZATION_ADMISSION_BLOCKED';

function admitHermesMaintainerSafeWorkflowAuthorization(binding,request){
 const blockers=[],bv=validateHermesMaintainerSafeWorkflowIntentBinding(binding),rv=validateHermesMaintainerExecutionAuthorizationRequest(request);
 if(!bv.valid)blockers.push(...bv.errors.map(e=>`binding::${e}`));if(!rv.valid)blockers.push(...rv.errors.map(e=>`request::${e}`));
 if(bv.valid&&(binding.status!==BINDING_PREPARED||binding.binding_prepared!==true))blockers.push('binding_not_ready');
 if(rv.valid&&(request.status!==REQUESTED||request.authorization_requested!==true))blockers.push('authorization_request_not_ready');
 if(bv.valid&&rv.valid&&binding.mission_id!==request.mission_id)blockers.push('mission_id_mismatch');
 if(bv.valid&&rv.valid&&binding.intent_digest!==request.intent_digest)blockers.push('intent_digest_mismatch');
 if(bv.valid&&rv.valid&&binding.intent_count!==request.intent_count)blockers.push('intent_count_mismatch');
 const u=uniqueSorted(blockers),admitted=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:admitted?binding.mission_id:'mission_not_available',workflow_digest:admitted?binding.workflow_digest:null,intent_digest:admitted?binding.intent_digest:null,intent_count:admitted?binding.intent_count:0,status:admitted?ADMITTED:BLOCKED,admitted,authorization_requested:admitted,authorization_granted:false,execution_eligible:false,execution_authorized:false,authority_consumed:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowAuthorizationAdmission(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['admission_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![ADMITTED,BLOCKED].includes(v.status)||v.admitted!==(v.status===ADMITTED))e.push('status_invalid');
 if(v.admitted&&(!isNonEmptyString(v.mission_id)||!isCanonicalContentDigest(v.workflow_digest)||!isCanonicalContentDigest(v.intent_digest)))e.push('identity_invalid');
 if(v.admitted&&(!Number.isInteger(v.intent_count)||v.intent_count<1||v.authorization_requested!==true))e.push('admitted_request_invalid');
 for(const f of ['authorization_granted','execution_eligible','execution_authorized','authority_consumed','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.admitted&&v.blockers.length)e.push('admitted_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={ADMITTED,BLOCKED,CONTRACT_VERSION,admitHermesMaintainerSafeWorkflowAuthorization,validateHermesMaintainerSafeWorkflowAuthorizationAdmission};
