'use strict';
const {grantHermesMaintainerScmWriteAuthorization}=require('../core/hermes-maintainer-scm-write-authorization-grant');
const update=require('../core/hermes-maintainer-github-update-file-human-authorization');
const pull=require('../core/hermes-maintainer-github-create-pull-request-human-authorization');
const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_authorization_grant_binding_v1';
function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_AUTHORIZATION_GRANTS_BLOCKED',granted:false,authorization_grants:null,execution_authorized:false,authorization_consumed:false,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([reason])});}
function bindHermesMaintainerTrustedE2eAuthorizationGrants(input={}){
 const r=input.authorization_requests,d=input.decisions;
 if(!r?.branch||!r?.edit||!r?.pull_request)return blocked('AUTHORIZATION_REQUESTS_MISSING');
 if(!d?.branch||!d?.edit||!d?.pull_request)return blocked('AUTHORIZATION_DECISIONS_MISSING');
 const branch=grantHermesMaintainerScmWriteAuthorization(r.branch,d.branch);
 const edit=update.grantHermesMaintainerGithubUpdateFileAuthorization(r.edit,d.edit);
 const pr=pull.grantHermesMaintainerGithubCreatePullRequestAuthorization(r.pull_request,d.pull_request);
 if(branch.authorization_valid!==true||edit.authorization_valid!==true||pr.authorization_valid!==true)return blocked('OFFICIAL_AUTHORIZATION_GRANT_INVALID');
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'TRUSTED_E2E_AUTHORIZATION_GRANTS_BOUND',granted:true,authorization_grants:Object.freeze({branch,edit,pull_request:pr}),execution_authorized:true,authorization_consumed:false,production_used:false,merge_authority:false,human_merge_required:true});
}
module.exports={CONTRACT_VERSION,bindHermesMaintainerTrustedE2eAuthorizationGrants};