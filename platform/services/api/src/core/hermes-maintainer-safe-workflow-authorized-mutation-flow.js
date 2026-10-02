'use strict';
const {prepareHermesMaintainerSafeWorkflowAuthorityEntry}=require('./hermes-maintainer-safe-workflow-authority-entry-composition');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_authorized_mutation_flow_v1';
function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_FLOW_BLOCKED',completed:false,stage,value:value||null,receipt:null,merge_authority:false,human_merge_required:true});}
function createHermesMaintainerSafeWorkflowAuthorizedMutationFlow({authorizedMutationEntry}={}){
 if(typeof authorizedMutationEntry?.execute!=='function')throw new TypeError('authorizedMutationEntry_required');
 return Object.freeze({contract_version:CONTRACT_VERSION,async execute(controlledExecution,{ownership,target,authority_evidence,mutation_input}={}){
  const entry=prepareHermesMaintainerSafeWorkflowAuthorityEntry(controlledExecution,{ownership,target});
  if(!entry.prepared)return blocked('authority_entry',entry);
  if(!authority_evidence)return blocked('authority_evidence_missing',entry.authority_requirement);
  const result=await authorizedMutationEntry.execute(entry.authority_requirement,authority_evidence,mutation_input);
  if(result.status!=='MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_COMPLETED')return blocked('authorized_mutation',result);
  return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_FLOW_COMPLETED',completed:true,stage:'completed',operation:result.operation,receipt:result.receipt,production_used:false,merge_authority:false,human_merge_required:true});
 }});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerSafeWorkflowAuthorizedMutationFlow};
