'use strict';
const h=require('../core/hermes-maintainer-github-create-pull-request-human-authorization');
const {createHermesMaintainerGithubCreatePullRequestOperationalAcceptanceGate}=require('./hermes-maintainer-github-create-pull-request-operational-acceptance-gate');
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
async function runHermesMaintainerGithubCreatePullRequestStagingCanary({pool,environment,fetchImpl,createTimeoutSignal,input}={}){
 if(!input||input.confirmation!=='EXECUTE_CREATE_PULL_REQUEST_STAGING_CANARY')throw new TypeError('explicit_canary_confirmation_required');
 if(input.approval_decision!=='APPROVED'||input.authorization_decision!=='AUTHORIZED')throw new TypeError('explicit_external_decisions_required');
 if(!input.a3_eligibility_input||typeof input.a3_eligibility_input!=='object')throw new TypeError('a3_eligibility_input_required');
 const intent=h.buildHermesMaintainerGithubCreatePullRequestIntent({provider:'GITHUB',operation:'create_pull_request',repository:REPOSITORY,base:'main',head:input.head,draft:true,title:input.title,body:input.body});
 const fp=h.fingerprintHermesMaintainerGithubCreatePullRequestIntent(intent),ar=h.buildHermesMaintainerGithubCreatePullRequestApprovalRequest(intent,fp);
 const binding=h.bindHermesMaintainerGithubCreatePullRequestApproval(ar,{decision:input.approval_decision,intent_digest:fp.intent_digest,approval_reference:input.approval_reference});
 const auth=h.buildHermesMaintainerGithubCreatePullRequestAuthorizationRequest(binding);
 const grant=h.grantHermesMaintainerGithubCreatePullRequestAuthorization(auth,{decision:input.authorization_decision,intent_digest:fp.intent_digest,authorization_reference:input.authorization_reference});
 if(grant.authorization_valid!==true)throw new TypeError('canary_authorization_invalid');
 return createHermesMaintainerGithubCreatePullRequestOperationalAcceptanceGate({pool,environment,fetchImpl,createTimeoutSignal,timeoutMs:15000}).execute(input.a3_eligibility_input,grant,{repository:REPOSITORY,operation:'create_pull_request',base:'main',head:input.head,draft:true},input);
}
module.exports={runHermesMaintainerGithubCreatePullRequestStagingCanary};
