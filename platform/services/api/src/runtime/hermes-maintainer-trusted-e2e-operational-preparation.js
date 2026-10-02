'use strict';
const {createHermesMaintainerGithubWriteOperationalAdmissionComposition}=require('./hermes-maintainer-github-write-operational-admission-composition');
const {createHermesMaintainerGithubUpdateFileOperationalAdmissionComposition}=require('./hermes-maintainer-github-update-file-operational-admission-composition');
const {createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition}=require('./hermes-maintainer-github-create-pull-request-operational-admission-composition');
const {prepareHermesMaintainerTrustedE2eCanaryWorkflow}=require('./hermes-maintainer-trusted-e2e-canary-workflow-preparation');
const COMPOSITION_VERSION='hermes_maintainer_trusted_e2e_operational_preparation_v1';
function blocked(stage,value){return Object.freeze({composition_version:COMPOSITION_VERSION,status:'MAINTAINER_TRUSTED_E2E_OPERATIONAL_PREPARATION_BLOCKED',prepared:false,stage,value:value||null,workflow:null,production_used:false,merge_authority:false,human_merge_required:true});}
function createHermesMaintainerTrustedE2eOperationalPreparation({pool}={}){
 const branchAdmission=createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool});
 const editAdmission=createHermesMaintainerGithubUpdateFileOperationalAdmissionComposition({pool});
 const pullAdmission=createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition({pool});
 return Object.freeze({composition_version:COMPOSITION_VERSION,async prepare(input={}){
  const b=await branchAdmission.prepare(input.branch?.grant,input.branch?.canary,input.branch?.operational_input);
  if(b?.admission_valid!==true)return blocked('branch_admission',b);
  const e=await editAdmission.prepare(input.edit?.grant,input.edit?.target,input.edit?.operational_input);
  if(e?.admission_valid!==true)return blocked('edit_admission',e);
  const p=await pullAdmission.prepare(input.pull_request?.grant,input.pull_request?.target,input.pull_request?.operational_input);
  if(p?.admission_valid!==true)return blocked('pull_request_admission',p);
  const prepared=prepareHermesMaintainerTrustedE2eCanaryWorkflow({
   repository_read:input.repository_read,
   branch:{controlled_execution:input.branch?.controlled_execution,target:input.branch?.target,admission:b,grant:input.branch?.grant,mutation_input:input.branch?.mutation_input},
   edit:{controlled_execution:input.edit?.controlled_execution,target:input.edit?.target,admission:e,grant:input.edit?.grant,mutation_input:input.edit?.mutation_input},
   pull_request:{controlled_execution:input.pull_request?.controlled_execution,target:input.pull_request?.target,admission:p,grant:input.pull_request?.grant,mutation_input:input.pull_request?.mutation_input}
  });
  if(prepared?.prepared!==true)return blocked('workflow_preparation',prepared);
  return Object.freeze({composition_version:COMPOSITION_VERSION,status:'MAINTAINER_TRUSTED_E2E_OPERATIONAL_PREPARED',prepared:true,stage:'prepared',workflow:prepared.workflow,production_used:false,merge_authority:false,human_merge_required:true});
 }});
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerTrustedE2eOperationalPreparation};
