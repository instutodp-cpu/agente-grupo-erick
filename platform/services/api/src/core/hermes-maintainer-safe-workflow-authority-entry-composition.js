'use strict';
const {routeHermesMaintainerSafeWorkflowOperation}=require('./hermes-maintainer-safe-workflow-operation-routing');
const {prepareHermesMaintainerSafeWorkflowDurableAdmissionIntent}=require('./hermes-maintainer-safe-workflow-durable-admission-intent');
const {requireHermesMaintainerSafeWorkflowDurableOwnership}=require('./hermes-maintainer-safe-workflow-durable-ownership-requirement');
const {bindHermesMaintainerSafeWorkflowDurableOwnership}=require('./hermes-maintainer-safe-workflow-durable-ownership-binding');
const {prepareHermesMaintainerSafeWorkflowDurableTarget}=require('./hermes-maintainer-safe-workflow-durable-target');
const {routeHermesMaintainerSafeWorkflowDurableHandoff}=require('./hermes-maintainer-safe-workflow-durable-handoff-routing');
const {requireHermesMaintainerSafeWorkflowDurableExecution}=require('./hermes-maintainer-safe-workflow-durable-execution-requirement');
const {requireHermesMaintainerSafeWorkflowExecutionChain}=require('./hermes-maintainer-safe-workflow-execution-chain-requirement');
const {requireHermesMaintainerSafeWorkflowAuthority}=require('./hermes-maintainer-safe-workflow-authority-requirement');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_authority_entry_composition_v1';
function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_AUTHORITY_ENTRY_BLOCKED',prepared:false,stage,value:value||null,authority_requirement:null,merge_authority:false,human_merge_required:true});}
function prepareHermesMaintainerSafeWorkflowAuthorityEntry(controlledExecution,{ownership,target}={}){
 const route=routeHermesMaintainerSafeWorkflowOperation(controlledExecution);if(!route.route_prepared)return blocked('operation_route',route);
 const intent=prepareHermesMaintainerSafeWorkflowDurableAdmissionIntent(route);if(!intent.admission_intent_prepared)return blocked('durable_admission_intent',intent);
 const ownershipRequirement=requireHermesMaintainerSafeWorkflowDurableOwnership(intent);if(!ownershipRequirement.ownership_requirement_ready)return blocked('ownership_requirement',ownershipRequirement);
 const ownershipBinding=bindHermesMaintainerSafeWorkflowDurableOwnership(ownershipRequirement,ownership);if(!ownershipBinding.ownership_bound)return blocked('ownership_binding',ownershipBinding);
 const durableTarget=prepareHermesMaintainerSafeWorkflowDurableTarget(ownershipBinding,target);if(!durableTarget.target_prepared)return blocked('durable_target',durableTarget);
 const handoff=routeHermesMaintainerSafeWorkflowDurableHandoff(durableTarget,ownership);if(!handoff.handoff_routed)return blocked('durable_handoff',handoff);
 const execution=requireHermesMaintainerSafeWorkflowDurableExecution(handoff);if(!execution.execution_requirement_prepared)return blocked('execution_requirement',execution);
 const chain=requireHermesMaintainerSafeWorkflowExecutionChain(execution);if(!chain.execution_chain_prepared)return blocked('execution_chain',chain);
 const authority=requireHermesMaintainerSafeWorkflowAuthority(chain);if(!authority.authority_requirement_prepared)return blocked('authority_requirement',authority);
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_AUTHORITY_ENTRY_PREPARED',prepared:true,stage:'prepared',authority_requirement:authority,authority_granted:false,execution_authorized:false,production_used:false,merge_authority:false,human_merge_required:true});
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerSafeWorkflowAuthorityEntry};
