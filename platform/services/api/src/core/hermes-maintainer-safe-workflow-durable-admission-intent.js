'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { ROUTED, validateHermesMaintainerSafeWorkflowOperationRouting } = require('./hermes-maintainer-safe-workflow-operation-routing');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_durable_admission_intent_v1';
const PREPARED='MAINTAINER_SAFE_WORKFLOW_DURABLE_ADMISSION_INTENT_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_DURABLE_ADMISSION_INTENT_BLOCKED';
const HANDOFFS=Object.freeze({
 create_branch:'hermes_maintainer_scm_write_durable_admission_handoff_v1',
 update_file:'hermes_maintainer_github_update_file_durable_admission_handoff_v1',
 create_pull_request:'hermes_maintainer_github_create_pull_request_durable_admission_handoff_v1'
});

function prepareHermesMaintainerSafeWorkflowDurableAdmissionIntent(route){
 const blockers=[],rv=validateHermesMaintainerSafeWorkflowOperationRouting(route);
 if(!rv.valid)blockers.push(...rv.errors.map(e=>`route::${e}`));
 if(rv.valid&&(route.status!==ROUTED||route.route_prepared!==true))blockers.push('operation_route_not_ready');
 if(rv.valid&&!Object.hasOwn(HANDOFFS,route.durable_operation))blockers.push('durable_operation_not_supported');
 const u=uniqueSorted(blockers),prepared=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:prepared?route.mission_id:'mission_not_available',workflow_digest:prepared?route.workflow_digest:null,intent_digest:prepared?route.intent_digest:null,intent_count:prepared?route.intent_count:0,authorization_binding_digest:prepared?route.authorization_binding_digest:null,workflow_operation:prepared?route.workflow_operation:'operation_not_available',durable_operation:prepared?route.durable_operation:null,target_handoff_contract:prepared?HANDOFFS[route.durable_operation]:null,repository:prepared?route.repository:'repository_not_available',base_ref:prepared?route.base_ref:'ref_not_available',status:prepared?PREPARED:BLOCKED,admission_intent_prepared:prepared,ownership_required:true,durable_replay_protection_required:true,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowDurableAdmissionIntent(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['durable_admission_intent_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![PREPARED,BLOCKED].includes(v.status)||v.admission_intent_prepared!==(v.status===PREPARED))e.push('status_invalid');
 if(v.admission_intent_prepared&&(!isNonEmptyString(v.mission_id)||!isCanonicalContentDigest(v.workflow_digest)||!isCanonicalContentDigest(v.intent_digest)||!isCanonicalContentDigest(v.authorization_binding_digest)||HANDOFFS[v.durable_operation]!==v.target_handoff_contract||!isNonEmptyString(v.repository)||!isNonEmptyString(v.base_ref)))e.push('identity_invalid');
 if(v.admission_intent_prepared&&(!Number.isInteger(v.intent_count)||v.intent_count<1))e.push('intent_count_invalid');
 if(v.ownership_required!==true||v.durable_replay_protection_required!==true)e.push('durability_requirements_invalid');
 for(const f of ['execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.admission_intent_prepared&&v.blockers.length)e.push('prepared_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,HANDOFFS,PREPARED,prepareHermesMaintainerSafeWorkflowDurableAdmissionIntent,validateHermesMaintainerSafeWorkflowDurableAdmissionIntent};
