'use strict';
const {bindHermesMaintainerScmWriteApproval}=require('../core/hermes-maintainer-scm-write-approval-binding');
const update=require('../core/hermes-maintainer-github-update-file-human-authorization');
const pull=require('../core/hermes-maintainer-github-create-pull-request-human-authorization');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_human_approval_binding_v1';
function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_HUMAN_APPROVAL_BINDING_BLOCKED',bound:false,approval_bindings:null,execution_authorized:false,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([reason])});}
function bindHermesMaintainerTrustedE2eHumanApprovals(input={}){
 const requests=input.approval_requests,decisions=input.decisions;
 if(!requests?.branch||!requests?.edit||!requests?.pull_request)return blocked('APPROVAL_REQUESTS_MISSING');
 if(!decisions?.branch||!decisions?.edit||!decisions?.pull_request)return blocked('HUMAN_DECISIONS_MISSING');
 const branch=bindHermesMaintainerScmWriteApproval(requests.branch,decisions.branch);
 const edit=update.bindHermesMaintainerGithubUpdateFileApproval(requests.edit,decisions.edit);
 const pr=pull.bindHermesMaintainerGithubCreatePullRequestApproval(requests.pull_request,decisions.pull_request);
 if(branch.approval_valid!==true||edit.approval_valid!==true||pr.approval_valid!==true)return blocked('HUMAN_APPROVAL_INVALID');
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_HUMAN_APPROVALS_BOUND',bound:true,approval_bindings:Object.freeze({branch,edit,pull_request:pr}),execution_authorized:false,production_used:false,merge_authority:false,human_merge_required:true});
}
module.exports={CONTRACT_VERSION,bindHermesMaintainerTrustedE2eHumanApprovals};