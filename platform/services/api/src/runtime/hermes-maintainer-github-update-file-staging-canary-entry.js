'use strict';
const h=require('../core/hermes-maintainer-github-update-file-human-authorization');
const {createHermesMaintainerGithubUpdateFileOperationalAcceptanceGate}=require('./hermes-maintainer-github-update-file-operational-acceptance-gate');
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
async function runHermesMaintainerGithubUpdateFileStagingCanary({pool,environment,fetchImpl,createTimeoutSignal,input}={}){
 if(!input||input.confirmation!=='EXECUTE_UPDATE_FILE_STAGING_CANARY')throw new TypeError('explicit_canary_confirmation_required');
 if(input.approval_decision!=='APPROVED'||input.authorization_decision!=='AUTHORIZED')throw new TypeError('explicit_external_decisions_required');
 if(!input.a3_eligibility_input||typeof input.a3_eligibility_input!=='object')throw new TypeError('a3_eligibility_input_required');
 const intent=h.buildHermesMaintainerGithubUpdateFileIntent({provider:'GITHUB',operation:'update_file',repository:REPOSITORY,branch_name:input.branch,path:input.path,current_blob_sha:input.current_blob_sha,content:input.content,message:input.message});
 const fp=h.fingerprintHermesMaintainerGithubUpdateFileIntent(intent),ar=h.buildHermesMaintainerGithubUpdateFileApprovalRequest(intent,fp);
 const binding=h.bindHermesMaintainerGithubUpdateFileApproval(ar,{decision:input.approval_decision,intent_digest:fp.intent_digest,approval_reference:input.approval_reference});
 const auth=h.buildHermesMaintainerGithubUpdateFileAuthorizationRequest(binding);
 const grant=h.grantHermesMaintainerGithubUpdateFileAuthorization(auth,{decision:input.authorization_decision,intent_digest:fp.intent_digest,authorization_reference:input.authorization_reference});
 if(grant.authorization_valid!==true)throw new TypeError('canary_authorization_invalid');
 return createHermesMaintainerGithubUpdateFileOperationalAcceptanceGate({pool,environment,fetchImpl,createTimeoutSignal,timeoutMs:15000}).execute(input.a3_eligibility_input,grant,{repository:REPOSITORY,operation:'update_file',branch:input.branch},input);
}
module.exports={runHermesMaintainerGithubUpdateFileStagingCanary};
