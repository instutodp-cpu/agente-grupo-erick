'use strict';
const {preflightHermesMaintainerGithubWriteOperationalAdmission}=require('./hermes-maintainer-github-write-operational-admission-composition');
const {preflightHermesMaintainerGithubUpdateFileOperationalAdmission}=require('./hermes-maintainer-github-update-file-operational-admission-composition');
const {preflightHermesMaintainerGithubCreatePullRequestOperationalAdmission}=require('./hermes-maintainer-github-create-pull-request-operational-admission-composition');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_operational_input_builder_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_OPERATIONAL_INPUT_BLOCKED',input_valid:false,operational:null,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([reason])});}
function buildHermesMaintainerTrustedE2eOperationalInput(input={}){
 if(!input.repository_read||!input.branch?.controlled_execution||!input.branch?.mutation_input||!input.edit?.controlled_execution||!input.edit?.mutation_input||!input.pull_request?.controlled_execution||!input.pull_request?.mutation_input)return blocked('WORKFLOW_EVIDENCE_MISSING');
 const branchName=typeof input.branch?.canary?.ref==='string'?input.branch.canary.ref.replace(/^refs\/heads\//,''):null;
 if(typeof branchName!=='string'||!branchName.startsWith('hermes/'))return blocked('BRANCH_SCOPE_INVALID');
 const branchTarget=Object.freeze({repository:REPOSITORY,operation:'create_branch',branch_name:branchName});
 const editTarget=Object.freeze({repository:REPOSITORY,operation:'update_file',branch:branchName});
 const pullTarget=Object.freeze({repository:REPOSITORY,operation:'create_pull_request',base:'main',head:branchName,draft:true});
 const b=preflightHermesMaintainerGithubWriteOperationalAdmission(input.branch?.grant,input.branch?.canary,input.branch?.operational_input);
 const e=preflightHermesMaintainerGithubUpdateFileOperationalAdmission(input.edit?.grant,editTarget,input.edit?.operational_input);
 const p=preflightHermesMaintainerGithubCreatePullRequestOperationalAdmission(input.pull_request?.grant,pullTarget,input.pull_request?.operational_input);
 if(b?.admission_preflight_valid!==true||e?.admission_preflight_valid!==true||p?.admission_preflight_valid!==true)return blocked('OPERATIONAL_ADMISSION_PREFLIGHT_INVALID');
 const operational=Object.freeze({repository_read:input.repository_read,branch:Object.freeze({...input.branch,target:branchTarget}),edit:Object.freeze({...input.edit,target:editTarget}),pull_request:Object.freeze({...input.pull_request,target:pullTarget})});
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_OPERATIONAL_INPUT_READY',input_valid:true,operational,production_used:false,merge_authority:false,human_merge_required:true});
}
module.exports={CONTRACT_VERSION,buildHermesMaintainerTrustedE2eOperationalInput};