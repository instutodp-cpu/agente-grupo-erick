'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { PREPARED_STATUS: SAFE_PREPARED, validateHermesMaintainerSafeWorkflowAuthorizationBinding } = require('./hermes-maintainer-safe-workflow-authorization-binding');
const { PREPARED_STATUS: HANDOFF_PREPARED, validateHermesMaintainerExecutionHandoffAdapter } = require('./hermes-maintainer-execution-handoff-adapter');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_execution_handoff_v1';
const PREPARED_STATUS='MAINTAINER_SAFE_WORKFLOW_EXECUTION_HANDOFF_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_EXECUTION_HANDOFF_BLOCKED';

function bindHermesMaintainerSafeWorkflowExecutionHandoff(safeBinding,handoff){
 const blockers=[],sv=validateHermesMaintainerSafeWorkflowAuthorizationBinding(safeBinding),hv=validateHermesMaintainerExecutionHandoffAdapter(handoff);
 if(!sv.valid)blockers.push(...sv.errors.map(e=>`safe_binding::${e}`));if(!hv.valid)blockers.push(...hv.errors.map(e=>`handoff::${e}`));
 if(sv.valid&&(safeBinding.status!==SAFE_PREPARED||safeBinding.binding_prepared!==true))blockers.push('safe_binding_not_ready');
 if(hv.valid&&(handoff.status!==HANDOFF_PREPARED||handoff.handoff_prepared!==true))blockers.push('execution_handoff_not_ready');
 if(sv.valid&&hv.valid&&safeBinding.mission_id!==handoff.mission_id)blockers.push('mission_id_mismatch');
 if(sv.valid&&hv.valid&&safeBinding.intent_digest!==handoff.intent_digest)blockers.push('intent_digest_mismatch');
 if(sv.valid&&hv.valid&&safeBinding.intent_count!==handoff.intent_count)blockers.push('intent_count_mismatch');
 if(sv.valid&&hv.valid&&safeBinding.authorization_binding_digest!==handoff.binding_digest)blockers.push('authorization_binding_digest_mismatch');
 const u=uniqueSorted(blockers),prepared=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:prepared?safeBinding.mission_id:'mission_not_available',workflow_digest:prepared?safeBinding.workflow_digest:null,intent_digest:prepared?safeBinding.intent_digest:null,intent_count:prepared?safeBinding.intent_count:0,authorization_binding_digest:prepared?safeBinding.authorization_binding_digest:null,status:prepared?PREPARED_STATUS:BLOCKED,handoff_prepared:prepared,execution_eligible:false,execution_authorized:false,authority_consumed:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowExecutionHandoff(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['safe_execution_handoff_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![PREPARED_STATUS,BLOCKED].includes(v.status)||v.handoff_prepared!==(v.status===PREPARED_STATUS))e.push('status_invalid');
 if(v.handoff_prepared&&(!isNonEmptyString(v.mission_id)||!isCanonicalContentDigest(v.workflow_digest)||!isCanonicalContentDigest(v.intent_digest)||!isCanonicalContentDigest(v.authorization_binding_digest)))e.push('identity_invalid');
 if(v.handoff_prepared&&(!Number.isInteger(v.intent_count)||v.intent_count<1))e.push('intent_count_invalid');
 for(const f of ['execution_eligible','execution_authorized','authority_consumed','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.handoff_prepared&&v.blockers.length)e.push('prepared_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,PREPARED_STATUS,bindHermesMaintainerSafeWorkflowExecutionHandoff,validateHermesMaintainerSafeWorkflowExecutionHandoff};
