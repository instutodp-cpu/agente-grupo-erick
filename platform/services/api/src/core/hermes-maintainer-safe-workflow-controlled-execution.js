'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { PREPARED_STATUS: SAFE_PREPARED, validateHermesMaintainerSafeWorkflowExecutionHandoff } = require('./hermes-maintainer-safe-workflow-execution-handoff');
const { PREPARED: EXECUTION_PREPARED, validateHermesMaintainerControlledExecution } = require('./hermes-maintainer-controlled-executor');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_controlled_execution_v1';
const PREPARED_STATUS='MAINTAINER_SAFE_WORKFLOW_CONTROLLED_EXECUTION_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_CONTROLLED_EXECUTION_BLOCKED';

function bindHermesMaintainerSafeWorkflowControlledExecution(safeHandoff,execution){
 const blockers=[],sv=validateHermesMaintainerSafeWorkflowExecutionHandoff(safeHandoff),ev=validateHermesMaintainerControlledExecution(execution);
 if(!sv.valid)blockers.push(...sv.errors.map(e=>`safe_handoff::${e}`));if(!ev.valid)blockers.push(...ev.errors.map(e=>`execution::${e}`));
 if(sv.valid&&(safeHandoff.status!==SAFE_PREPARED||safeHandoff.handoff_prepared!==true))blockers.push('safe_handoff_not_ready');
 if(ev.valid&&(execution.status!==EXECUTION_PREPARED||execution.execution_prepared!==true))blockers.push('controlled_execution_not_ready');
 if(sv.valid&&ev.valid&&safeHandoff.mission_id!==execution.mission_id)blockers.push('mission_id_mismatch');
 const u=uniqueSorted(blockers),prepared=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:prepared?safeHandoff.mission_id:'mission_not_available',workflow_digest:prepared?safeHandoff.workflow_digest:null,intent_digest:prepared?safeHandoff.intent_digest:null,intent_count:prepared?safeHandoff.intent_count:0,authorization_binding_digest:prepared?safeHandoff.authorization_binding_digest:null,operation:prepared?execution.operation:'operation_not_available',repository:prepared?execution.repository:'repository_not_available',base_ref:prepared?execution.base_ref:'ref_not_available',status:prepared?PREPARED_STATUS:BLOCKED,execution_prepared:prepared,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowControlledExecution(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['safe_controlled_execution_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![PREPARED_STATUS,BLOCKED].includes(v.status)||v.execution_prepared!==(v.status===PREPARED_STATUS))e.push('status_invalid');
 if(v.execution_prepared&&(!isNonEmptyString(v.mission_id)||!isCanonicalContentDigest(v.workflow_digest)||!isCanonicalContentDigest(v.intent_digest)||!isCanonicalContentDigest(v.authorization_binding_digest)||!isNonEmptyString(v.operation)||!isNonEmptyString(v.repository)||!isNonEmptyString(v.base_ref)))e.push('identity_invalid');
 if(v.execution_prepared&&(!Number.isInteger(v.intent_count)||v.intent_count<1))e.push('intent_count_invalid');
 for(const f of ['execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.execution_prepared&&v.blockers.length)e.push('prepared_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,PREPARED_STATUS,bindHermesMaintainerSafeWorkflowControlledExecution,validateHermesMaintainerSafeWorkflowControlledExecution};
