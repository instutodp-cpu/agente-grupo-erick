'use strict';
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_finalization_invocation_v1';
const FINALIZERS=Object.freeze({create_branch:'hermes_maintainer_github_write_operational_finalization_composition_v1',update_file:'hermes_maintainer_github_update_file_operational_finalization_composition_v1',create_pull_request:'hermes_maintainer_github_create_pull_request_operational_finalization_composition_v1'});
function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_FINALIZATION_BLOCKED',finalization_invoked:false,durable:false,receipt:null,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([reason])});}
function createHermesMaintainerSafeWorkflowFinalizationInvocation({finalizers}={}){
 return Object.freeze({contract_version:CONTRACT_VERSION,async finalize(operation,durableAdmission,executionInvocation){
  const finalizer=finalizers?.[operation];
  if(!FINALIZERS[operation]||!finalizer||finalizer.composition_version!==FINALIZERS[operation]||typeof finalizer.finalize!=='function')return blocked('OFFICIAL_FINALIZER_REQUIRED');
  if(!durableAdmission||durableAdmission.execution_authorized!==true)return blocked('DURABLE_ADMISSION_INVALID');
  if(!executionInvocation||executionInvocation.contract_version!=='hermes_maintainer_safe_workflow_execution_invocation_v1'||executionInvocation.status!=='MAINTAINER_SAFE_WORKFLOW_EXECUTION_SUCCEEDED'||executionInvocation.execution_invoked!==true||executionInvocation.write_performed!==true||executionInvocation.production_used!==false||!executionInvocation.execution)return blocked('EXECUTION_INVOCATION_NOT_CONFIRMED');
  const closed=await finalizer.finalize(durableAdmission,executionInvocation.execution);
  const ok=closed?.finalization_valid===true&&closed?.durable===true&&closed?.receipt?.receipt_valid===true&&closed?.production_used===false;
  return Object.freeze({contract_version:CONTRACT_VERSION,status:ok?'MAINTAINER_SAFE_WORKFLOW_FINALIZATION_CONFIRMED':'MAINTAINER_SAFE_WORKFLOW_FINALIZATION_FAILED',finalization_invoked:true,durable:ok,receipt:ok?closed.receipt:null,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze(ok?[]:['OFFICIAL_FINALIZATION_NOT_CONFIRMED'])});
 }});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerSafeWorkflowFinalizationInvocation};
