'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { ADMITTED, validateHermesMaintainerSafeWorkflowAuthorizationAdmission } = require('./hermes-maintainer-safe-workflow-authorization-admission');
const { PREPARED, validateHermesMaintainerAuthorizationBinding, verifyHermesMaintainerAuthorizationBinding } = require('./hermes-maintainer-authorization-binding');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_authorization_binding_v1';
const PREPARED_STATUS='MAINTAINER_SAFE_WORKFLOW_AUTHORIZATION_BINDING_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_AUTHORIZATION_BINDING_BLOCKED';

function bindHermesMaintainerSafeWorkflowAuthorization(admission,request,binding){
 const blockers=[],av=validateHermesMaintainerSafeWorkflowAuthorizationAdmission(admission),bv=validateHermesMaintainerAuthorizationBinding(binding),vv=verifyHermesMaintainerAuthorizationBinding(request,binding);
 if(!av.valid)blockers.push(...av.errors.map(e=>`admission::${e}`));if(!bv.valid)blockers.push(...bv.errors.map(e=>`binding::${e}`));if(!vv.valid)blockers.push(...vv.errors.map(e=>`verification::${e}`));
 if(av.valid&&(admission.status!==ADMITTED||admission.admitted!==true))blockers.push('admission_not_ready');
 if(bv.valid&&(binding.status!==PREPARED||binding.binding_prepared!==true))blockers.push('authorization_binding_not_ready');
 if(av.valid&&bv.valid&&admission.mission_id!==binding.mission_id)blockers.push('mission_id_mismatch');
 if(av.valid&&bv.valid&&admission.intent_digest!==binding.intent_digest)blockers.push('intent_digest_mismatch');
 if(av.valid&&bv.valid&&admission.intent_count!==binding.intent_count)blockers.push('intent_count_mismatch');
 const u=uniqueSorted(blockers),prepared=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:prepared?admission.mission_id:'mission_not_available',workflow_digest:prepared?admission.workflow_digest:null,intent_digest:prepared?admission.intent_digest:null,intent_count:prepared?admission.intent_count:0,authorization_binding_digest:prepared?binding.binding_digest:null,status:prepared?PREPARED_STATUS:BLOCKED,binding_prepared:prepared,authorization_granted:false,execution_eligible:false,execution_authorized:false,authority_consumed:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowAuthorizationBinding(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['safe_authorization_binding_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![PREPARED_STATUS,BLOCKED].includes(v.status)||v.binding_prepared!==(v.status===PREPARED_STATUS))e.push('status_invalid');
 if(v.binding_prepared&&(!isNonEmptyString(v.mission_id)||!isCanonicalContentDigest(v.workflow_digest)||!isCanonicalContentDigest(v.intent_digest)||!isCanonicalContentDigest(v.authorization_binding_digest)))e.push('identity_invalid');
 if(v.binding_prepared&&(!Number.isInteger(v.intent_count)||v.intent_count<1))e.push('intent_count_invalid');
 for(const f of ['authorization_granted','execution_eligible','execution_authorized','authority_consumed','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.binding_prepared&&v.blockers.length)e.push('prepared_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,PREPARED_STATUS,bindHermesMaintainerSafeWorkflowAuthorization,validateHermesMaintainerSafeWorkflowAuthorizationBinding};
