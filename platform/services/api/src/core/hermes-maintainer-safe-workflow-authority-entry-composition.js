'use strict';
const {isCanonicalContentDigest}=require('./canonical-content-digest');
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
const CAPABILITIES=Object.freeze({create_branch:'github_create_branch_staging',update_file:'github_update_file_hermes_branch_staging',create_pull_request:'github_create_pull_request_hermes_branch_staging'});
function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_AUTHORITY_ENTRY_BLOCKED',prepared:false,stage,value:value||null,authority_requirement:null,merge_authority:false,human_merge_required:true});}
function prepareHermesMaintainerSafeWorkflowAuthorityEntry(controlledExecution,{ownership,target,authority_evidence}={}){
 const route=routeHermesMaintainerSafeWorkflowOperation(controlledExecution);if(!route.route_prepared)return blocked('operation_route',route);
 if(!isCanonicalContentDigest(authority_evidence?.intent_digest)||authority_evidence.intent_digest!==ownership?.intent_digest||authority_evidence.attempt_reference!==ownership?.attempt_reference||authority_evidence.capability!==CAPABILITIES[route.durable_operation])return blocked('operational_authority_bridge',{status:'MAINTAINER_SAFE_WORKFLOW_OPERATIONAL_AUTHORITY_BRIDGE_BLOCKED',bridge_valid:false});
 const durableRoute=Object.freeze({...route,intent_digest:authority_evidence.intent_digest});
 const intent=prepareHermesMaintainerSafeWorkflowDurableAdmissionIntent(durableRoute);if(!intent.admission_intent_prepared)return blocked('durable_admission_intent',intent);
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
