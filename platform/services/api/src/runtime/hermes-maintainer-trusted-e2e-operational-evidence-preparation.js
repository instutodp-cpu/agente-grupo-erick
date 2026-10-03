'use strict';
const {prepareHermesMaintainerGithubWriteCanary}=require('../core/hermes-maintainer-github-write-canary-contract');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_operational_evidence_preparation_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const SHA_RE=/^[a-f0-9]{40}$/;
function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_OPERATIONAL_EVIDENCE_BLOCKED',prepared:false,operational_evidence:null,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([reason])});}
function refs(prefix,operation){return Object.freeze({consumption_reference:`${prefix}:consumption:${operation}`,attempt_reference:`${prefix}:attempt:${operation}`,capability_reference:`${prefix}:capability:${operation}`,admission_reference:`${prefix}:admission:${operation}`});}
function prepareHermesMaintainerTrustedE2eOperationalEvidence(input={}){
 const branch=input.branch_name,sha=input.base_sha,prefix=input.execution_reference;
 if(typeof branch!=='string'||!/^hermes\/canary\/[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(branch))return blocked('BRANCH_SCOPE_INVALID');
 if(typeof sha!=='string'||!SHA_RE.test(sha))return blocked('BASE_SHA_INVALID');
 if(typeof prefix!=='string'||prefix.trim()===''||prefix.length>160)return blocked('EXECUTION_REFERENCE_INVALID');
 if(!input.repository_read||!input.branch?.controlled_execution||!input.branch?.mutation_input||!input.edit?.controlled_execution||!input.edit?.mutation_input||!input.pull_request?.controlled_execution||!input.pull_request?.mutation_input)return blocked('WORKFLOW_EVIDENCE_MISSING');
 const canary=prepareHermesMaintainerGithubWriteCanary({repository:REPOSITORY,operation:'create_branch',ref:`refs/heads/${branch}`,sha});
 if(canary.canary_valid!==true)return blocked('CANARY_INVALID');
 const b=refs(prefix,'create_branch'),e=refs(prefix,'update_file'),p=refs(prefix,'create_pull_request');
 if(!input.edit.path||!input.edit.current_blob_sha||!input.edit.content||!input.edit.message)return blocked('EDIT_OPERATIONAL_FIELDS_MISSING');
 if(!input.pull_request.title||!input.pull_request.body)return blocked('PULL_REQUEST_OPERATIONAL_FIELDS_MISSING');
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_OPERATIONAL_EVIDENCE_PREPARED',prepared:true,operational_evidence:Object.freeze({
  repository_read:input.repository_read,
  branch:Object.freeze({canary,controlled_execution:input.branch.controlled_execution,mutation_input:input.branch.mutation_input,operational_input:b}),
  edit:Object.freeze({controlled_execution:input.edit.controlled_execution,mutation_input:input.edit.mutation_input,operational_input:Object.freeze({...e,path:input.edit.path,current_blob_sha:input.edit.current_blob_sha,content:input.edit.content,message:input.edit.message})}),
  pull_request:Object.freeze({controlled_execution:input.pull_request.controlled_execution,mutation_input:input.pull_request.mutation_input,operational_input:Object.freeze({...p,title:input.pull_request.title,body:input.pull_request.body})})
 }),production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([])});
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerTrustedE2eOperationalEvidence};