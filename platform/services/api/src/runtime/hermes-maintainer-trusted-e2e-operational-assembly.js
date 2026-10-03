'use strict';
const {prepareHermesMaintainerTrustedE2eControlledExecutions}=require('./hermes-maintainer-trusted-e2e-controlled-execution-composition');
const {prepareHermesMaintainerTrustedE2eOperationalEvidence}=require('./hermes-maintainer-trusted-e2e-operational-evidence-preparation');
const {prepareHermesMaintainerTrustedE2eAuthorizedOperational}=require('./hermes-maintainer-trusted-e2e-authorized-operational-composition');
const {adaptHermesMaintainerTrustedE2eExternalDecisions}=require('./hermes-maintainer-trusted-e2e-external-decision-adapter');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_operational_assembly_v1';
function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_OPERATIONAL_ASSEMBLY_BLOCKED',prepared:false,stage,value:value||null,operational:null,authorization_consumed:false,production_used:false,merge_authority:false,human_merge_required:true});}
function prepareHermesMaintainerTrustedE2eOperationalAssembly(input={}){
 const executions=prepareHermesMaintainerTrustedE2eControlledExecutions({mission_id:input.mission_id,branch_name:input.branch_name});
 if(executions.prepared!==true)return blocked('controlled_executions',executions);
 const evidence=prepareHermesMaintainerTrustedE2eOperationalEvidence({
  branch_name:input.branch_name,base_sha:input.base_sha,execution_reference:input.execution_reference,
  repository_read:input.repository_read,
  branch:{controlled_execution:executions.controlled_executions.branch},
  edit:{controlled_execution:executions.controlled_executions.edit,path:input.edit?.path,current_blob_sha:input.edit?.current_blob_sha,content:input.edit?.content,message:input.edit?.message},
  pull_request:{controlled_execution:executions.controlled_executions.pull_request,title:input.pull_request?.title,body:input.pull_request?.body}
 });
 if(evidence.prepared!==true)return blocked('operational_evidence',evidence);
 const decisions=input.external_decision_references?adaptHermesMaintainerTrustedE2eExternalDecisions({branch_name:input.branch_name,references:input.external_decision_references}):{adapted:true,human_decisions:input.human_decisions,authorization_decisions:input.authorization_decisions};
 if(decisions.adapted!==true)return blocked('external_decisions',decisions);
 const authorized=prepareHermesMaintainerTrustedE2eAuthorizedOperational({branch_name:input.branch_name,human_decisions:decisions.human_decisions,authorization_decisions:decisions.authorization_decisions,operational_evidence:evidence.operational_evidence});
 if(authorized.prepared!==true)return blocked('authorized_operational',authorized);
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_OPERATIONAL_ASSEMBLY_PREPARED',prepared:true,operational:authorized.operational,authorization_consumed:false,production_used:false,merge_authority:false,human_merge_required:true});
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerTrustedE2eOperationalAssembly};
