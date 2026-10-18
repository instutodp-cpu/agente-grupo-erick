'use strict';
const {buildHermesMaintainerScmWriteIntent}=require('../core/hermes-maintainer-scm-write-intent');
const {fingerprintHermesMaintainerScmWriteIntent}=require('../core/hermes-maintainer-scm-write-intent-fingerprint');
const {buildHermesMaintainerScmWriteApprovalRequest}=require('../core/hermes-maintainer-scm-write-approval-request');
const update=require('../core/hermes-maintainer-github-update-file-human-authorization');
const pull=require('../core/hermes-maintainer-github-create-pull-request-human-authorization');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_approval_request_preparation_v2',REPOSITORY='instutodp-cpu/agente-grupo-erick';
function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_APPROVAL_REQUESTS_BLOCKED',prepared:false,approval_requests:null,execution_authorized:false,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([reason])});}
function prepareHermesMaintainerTrustedE2eApprovalRequests(input={}){
 const branch=typeof input.branch_name==='string'?input.branch_name:null,edit=input.edit,pullInput=input.pull_request;
 if(!branch?.startsWith('hermes/'))return blocked('BRANCH_SCOPE_INVALID');
 if(!edit||edit.branch!==branch||!edit.path||!edit.current_blob_sha||typeof edit.content!=='string'||!edit.message)return blocked('EDIT_PAYLOAD_MISSING');
 if(!pullInput||pullInput.base!=='main'||pullInput.head!==branch||pullInput.draft!==true||!pullInput.title||typeof pullInput.body!=='string')return blocked('PULL_REQUEST_PAYLOAD_MISSING');
 try{
  const bi=buildHermesMaintainerScmWriteIntent({provider:'GITHUB',operation:'create_branch',repository:REPOSITORY,base_ref:'main',branch_name:branch}),bf=fingerprintHermesMaintainerScmWriteIntent(bi),br=buildHermesMaintainerScmWriteApprovalRequest(bi,bf);
  const ei=update.buildHermesMaintainerGithubUpdateFileIntent({provider:'GITHUB',operation:'update_file',repository:REPOSITORY,branch_name:branch,path:edit.path,current_blob_sha:edit.current_blob_sha,content:edit.content,message:edit.message}),ef=update.fingerprintHermesMaintainerGithubUpdateFileIntent(ei),er=update.buildHermesMaintainerGithubUpdateFileApprovalRequest(ei,ef);
  const pi=pull.buildHermesMaintainerGithubCreatePullRequestIntent({provider:'GITHUB',operation:'create_pull_request',repository:REPOSITORY,base:'main',head:branch,draft:true,title:pullInput.title,body:pullInput.body}),pf=pull.fingerprintHermesMaintainerGithubCreatePullRequestIntent(pi),pr=pull.buildHermesMaintainerGithubCreatePullRequestApprovalRequest(pi,pf);
  if(br.request_valid!==true||er.request_valid!==true||pr.request_valid!==true)return blocked('OFFICIAL_APPROVAL_REQUEST_INVALID');
  return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_APPROVAL_REQUESTS_PREPARED',prepared:true,approval_requests:Object.freeze({branch:br,edit:er,pull_request:pr}),execution_authorized:false,production_used:false,merge_authority:false,human_merge_required:true});
 }catch{return blocked('OFFICIAL_APPROVAL_PREPARATION_FAILED');}
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerTrustedE2eApprovalRequests};
