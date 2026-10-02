'use strict';
const {composeHermesMaintainerSafeWorkflowCapability}=require('./hermes-maintainer-safe-workflow-capability-composition');
const {composeHermesMaintainerSafeWorkflowRequest}=require('./hermes-maintainer-safe-workflow-request-composition');
const {composeHermesMaintainerSafeWorkflowAdmission}=require('./hermes-maintainer-safe-workflow-admission-composition');
const {composeHermesMaintainerSafeWorkflowCredentialScope}=require('./hermes-maintainer-safe-workflow-credential-scope-composition');
const {prepareHermesMaintainerSafeWorkflowExecutionBoundaryHandoff}=require('./hermes-maintainer-safe-workflow-execution-boundary-handoff');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_mutation_orchestration_v1';
function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_MUTATION_BLOCKED',completed:false,stage,value:value||null,receipt:null,merge_authority:false,human_merge_required:true});}
function createHermesMaintainerSafeWorkflowMutationOrchestration({executionInvocation,finalizationInvocation}={}){
 if(typeof executionInvocation?.execute!=='function')throw new TypeError('executionInvocation_required');
 if(typeof finalizationInvocation?.finalize!=='function')throw new TypeError('finalizationInvocation_required');
 return Object.freeze({contract_version:CONTRACT_VERSION,async execute(handoff,{durable_handoff,grant,target,request_input,admission_reference,ownership}={}){
  const capability=composeHermesMaintainerSafeWorkflowCapability(handoff,{durable_handoff,grant,target});if(!capability.capability_composed)return blocked('capability',capability);
  const request=composeHermesMaintainerSafeWorkflowRequest(capability,{request_input});if(!request.request_composed)return blocked('request',request);
  const admission=composeHermesMaintainerSafeWorkflowAdmission(request,capability,{admission_reference,ownership});if(!admission.admission_composed)return blocked('admission',admission);
  const scope=composeHermesMaintainerSafeWorkflowCredentialScope(admission);if(!scope.credential_scope_composed)return blocked('credential_scope',scope);
  const boundary=prepareHermesMaintainerSafeWorkflowExecutionBoundaryHandoff(scope);if(!boundary.execution_boundary_handoff_ready)return blocked('execution_boundary_handoff',boundary);
  const execution=await executionInvocation.execute(boundary,admission.admission);if(execution.status!=='MAINTAINER_SAFE_WORKFLOW_EXECUTION_SUCCEEDED')return blocked('execution',execution);
  const finalization=await finalizationInvocation.finalize(admission.durable_operation,admission.admission,execution);if(finalization.status!=='MAINTAINER_SAFE_WORKFLOW_FINALIZATION_CONFIRMED')return blocked('finalization',finalization);
  return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_MUTATION_COMPLETED',completed:true,stage:'completed',operation:admission.durable_operation,execution,receipt:finalization.receipt,production_used:false,merge_authority:false,human_merge_required:true});
 }});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerSafeWorkflowMutationOrchestration};
