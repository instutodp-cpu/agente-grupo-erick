'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { PREPARED_STATUS, validateHermesMaintainerSafeWorkflowControlledExecution } = require('./hermes-maintainer-safe-workflow-controlled-execution');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_operation_routing_v1';
const ROUTED='MAINTAINER_SAFE_WORKFLOW_OPERATION_ROUTED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_OPERATION_ROUTING_BLOCKED';
const ROUTES=Object.freeze({branch_prepare:'create_branch',code_edit_prepare:'update_file',pull_request_prepare:'create_pull_request'});

function routeHermesMaintainerSafeWorkflowOperation(execution){
 const blockers=[],ev=validateHermesMaintainerSafeWorkflowControlledExecution(execution);
 if(!ev.valid)blockers.push(...ev.errors.map(e=>`execution::${e}`));
 if(ev.valid&&(execution.status!==PREPARED_STATUS||execution.execution_prepared!==true))blockers.push('controlled_execution_not_ready');
 if(ev.valid&&!Object.hasOwn(ROUTES,execution.operation))blockers.push('operation_not_mutation_route');
 const u=uniqueSorted(blockers),routed=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:routed?execution.mission_id:'mission_not_available',workflow_digest:routed?execution.workflow_digest:null,intent_digest:routed?execution.intent_digest:null,intent_count:routed?execution.intent_count:0,authorization_binding_digest:routed?execution.authorization_binding_digest:null,workflow_operation:routed?execution.operation:'operation_not_available',durable_operation:routed?ROUTES[execution.operation]:null,repository:routed?execution.repository:'repository_not_available',base_ref:routed?execution.base_ref:'ref_not_available',status:routed?ROUTED:BLOCKED,route_prepared:routed,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowOperationRouting(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['operation_routing_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![ROUTED,BLOCKED].includes(v.status)||v.route_prepared!==(v.status===ROUTED))e.push('status_invalid');
 if(v.route_prepared&&(!isNonEmptyString(v.mission_id)||!isCanonicalContentDigest(v.workflow_digest)||!isCanonicalContentDigest(v.intent_digest)||!isCanonicalContentDigest(v.authorization_binding_digest)||ROUTES[v.workflow_operation]!==v.durable_operation||!isNonEmptyString(v.repository)||!isNonEmptyString(v.base_ref)))e.push('identity_invalid');
 if(v.route_prepared&&(!Number.isInteger(v.intent_count)||v.intent_count<1))e.push('intent_count_invalid');
 for(const f of ['execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.route_prepared&&v.blockers.length)e.push('routed_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,ROUTED,ROUTES,routeHermesMaintainerSafeWorkflowOperation,validateHermesMaintainerSafeWorkflowOperationRouting};
