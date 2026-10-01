'use strict';
const h=require('../core/hermes-maintainer-github-create-pull-request-human-authorization');
const {createHermesMaintainerGithubCreatePullRequestOperationalAcceptanceGate}=require('./hermes-maintainer-github-create-pull-request-operational-acceptance-gate');
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
async function runHermesMaintainerGithubCreatePullRequestStagingCanary({pool,environment,fetchImpl,createTimeoutSignal,input}={}){
 if(!input||input.confirmation!=='EXECUTE_CREATE_PULL_REQUEST_STAGING_CANARY')throw new TypeError('explicit_canary_confirmation_required');
 const intent=h.buildHermesMaintainerGithubCreatePullRequestIntent({provider:'GITHUB',operation:'create_pull_request',repository:REPOSITORY,base:'main',head:input.head,draft:true});
 const fp=h.fingerprintHermesMaintainerGithubCreatePullRequestIntent(intent),ar=h.buildHermesMaintainerGithubCreatePullRequestApprovalRequest(intent,fp);
 const binding=h.bindHermesMaintainerGithubCreatePullRequestApproval(ar,{decision:'APPROVED',intent_digest:fp.intent_digest,approval_reference:input.approval_reference});
 const auth=h.buildHermesMaintainerGithubCreatePullRequestAuthorizationRequest(binding);
 const grant=h.grantHermesMaintainerGithubCreatePullRequestAuthorization(auth,{decision:'AUTHORIZED',intent_digest:fp.intent_digest,authorization_reference:input.authorization_reference});
 if(grant.authorization_valid!==true)throw new TypeError('canary_authorization_invalid');
 return createHermesMaintainerGithubCreatePullRequestOperationalAcceptanceGate({pool,environment,fetchImpl,createTimeoutSignal,timeoutMs:15000}).execute(grant,{repository:REPOSITORY,operation:'create_pull_request',base:'main',head:input.head,draft:true},input);
}
module.exports={runHermesMaintainerGithubCreatePullRequestStagingCanary};
