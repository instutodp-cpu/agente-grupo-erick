'use strict';
const {validateHermesMaintainerSafeWorkflowExecutionBoundaryHandoff,READY}=require('./hermes-maintainer-safe-workflow-execution-boundary-handoff');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_execution_invocation_v1';
const EXECUTORS=Object.freeze({create_branch:'hermes_maintainer_github_durable_write_runtime_composition_v1',update_file:'hermes_maintainer_github_update_file_runtime_composition_v1',create_pull_request:'hermes_maintainer_github_create_pull_request_runtime_composition_v1'});
function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_EXECUTION_BLOCKED',execution_invoked:false,execution:null,network_call_performed:false,write_performed:false,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([reason])});}
function createHermesMaintainerSafeWorkflowExecutionInvocation({runtimes}={}){
 return Object.freeze({contract_version:CONTRACT_VERSION,async execute(handoff,durableAdmission){
  const hv=validateHermesMaintainerSafeWorkflowExecutionBoundaryHandoff(handoff);
  if(!hv.valid||handoff.status!==READY||handoff.execution_boundary_handoff_ready!==true)return blocked('EXECUTION_BOUNDARY_HANDOFF_INVALID');
  const op=handoff.durable_operation,runtime=runtimes?.[op];
  if(!runtime||runtime.composition_version!==EXECUTORS[op]||typeof runtime.execute!=='function')return blocked('OFFICIAL_RUNTIME_REQUIRED');
  if(!durableAdmission||durableAdmission.execution_authorized!==true||durableAdmission.attempt_reference!==handoff.attempt_reference||durableAdmission.intent_digest!==handoff.intent_digest||durableAdmission.capability_reference!==handoff.capability_reference||durableAdmission.admission_reference!==handoff.admission_reference||durableAdmission.ownership_key!==handoff.ownership_key)return blocked('DURABLE_ADMISSION_BINDING_INVALID');
  const result=await runtime.execute(durableAdmission);
  const ok=result?.execution_performed===true&&result?.network_call_performed===true&&result?.write_performed===true&&result?.production_used===false;
  return Object.freeze({contract_version:CONTRACT_VERSION,status:ok?'MAINTAINER_SAFE_WORKFLOW_EXECUTION_SUCCEEDED':'MAINTAINER_SAFE_WORKFLOW_EXECUTION_FAILED',execution_invoked:true,execution:result||null,network_call_performed:result?.network_call_performed===true,write_performed:result?.write_performed===true,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze(ok?[]:['OFFICIAL_RUNTIME_EXECUTION_NOT_CONFIRMED'])});
 }});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerSafeWorkflowExecutionInvocation};
