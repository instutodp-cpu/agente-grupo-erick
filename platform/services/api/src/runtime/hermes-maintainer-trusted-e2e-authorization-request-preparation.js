'use strict';
const {buildHermesMaintainerScmWriteAuthorizationRequest}=require('../core/hermes-maintainer-scm-write-authorization-request');
const update=require('../core/hermes-maintainer-github-update-file-human-authorization');
const pull=require('../core/hermes-maintainer-github-create-pull-request-human-authorization');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_authorization_request_preparation_v1';
function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_AUTHORIZATION_REQUESTS_BLOCKED',prepared:false,authorization_requests:null,execution_authorized:false,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([reason])});}
function prepareHermesMaintainerTrustedE2eAuthorizationRequests(input={}){
 const b=input.approval_bindings;
 if(!b?.branch||!b?.edit||!b?.pull_request)return blocked('APPROVAL_BINDINGS_MISSING');
 const branch=buildHermesMaintainerScmWriteAuthorizationRequest(b.branch);
 const edit=update.buildHermesMaintainerGithubUpdateFileAuthorizationRequest(b.edit);
 const pr=pull.buildHermesMaintainerGithubCreatePullRequestAuthorizationRequest(b.pull_request);
 if(branch.request_valid!==true||edit.request_valid!==true||pr.request_valid!==true)return blocked('OFFICIAL_AUTHORIZATION_REQUEST_INVALID');
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_AUTHORIZATION_REQUESTS_PREPARED',prepared:true,authorization_requests:Object.freeze({branch,edit,pull_request:pr}),execution_authorized:false,production_used:false,merge_authority:false,human_merge_required:true});
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerTrustedE2eAuthorizationRequests};