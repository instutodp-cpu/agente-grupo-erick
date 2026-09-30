'use strict';

const {createHermesMaintainerGithubCreatePullRequestDurableExecutionBoundary}=require('../core/hermes-maintainer-github-create-pull-request-durable-execution-boundary');
const {createHermesMaintainerGithubCreatePullRequestTransport}=require('../core/hermes-maintainer-github-create-pull-request-transport');
const {createHermesMaintainerGithubCreatePullRequestCredentialComposition}=require('./hermes-maintainer-github-create-pull-request-credential-composition');

const COMPOSITION_VERSION='hermes_maintainer_github_create_pull_request_runtime_composition_v1';

function createHermesMaintainerGithubCreatePullRequestRuntimeComposition({environment,fetchImpl,createTimeoutSignal,timeoutMs}={}){
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');
 if(typeof createTimeoutSignal!=='function')throw new TypeError('createTimeoutSignal_required');
 const credential=createHermesMaintainerGithubCreatePullRequestCredentialComposition({environment});
 const scope=credential.defineScope({
  capability:'github_create_pull_request_hermes_branch_staging',
  provider:'GITHUB',
  operation:'create_pull_request',
  environment:'staging',
  repository:'instutodp-cpu/agente-grupo-erick'
 });
 const transport=createHermesMaintainerGithubCreatePullRequestTransport({
  fetchImpl,createTimeoutSignal,timeoutMs,
  resolveAuthorization:reference=>{
   if(reference!==credential.credential_reference)return Promise.resolve(null);
   return credential.resolve(scope).then(result=>({
    ok:result?.resolution_valid===true&&result?.status==='GITHUB_CREATE_PULL_REQUEST_CREDENTIAL_RESOLVED',
    authorization:result?.authorization
   }));
  }
 });
 const boundary=createHermesMaintainerGithubCreatePullRequestDurableExecutionBoundary({executeCreatePullRequest:request=>{
  const {method,url,body,intent_digest,attempt_reference,capability_reference,admission_reference}=request||{};
  return transport.createPullRequest({method,url,body,intent_digest,attempt_reference,capability_reference,admission_reference});
 }});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  environment:'staging',
  credential_reference:credential.credential_reference,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  execute:boundary.execute
 });
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubCreatePullRequestRuntimeComposition};
