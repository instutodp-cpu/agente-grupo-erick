'use strict';

const {createHermesMaintainerGithubUpdateFileDurableExecutionBoundary}=require('../core/hermes-maintainer-github-update-file-durable-execution-boundary');
const {createHermesMaintainerGithubUpdateFileTransport}=require('../core/hermes-maintainer-github-update-file-transport');
const {createHermesMaintainerGithubUpdateFileCredentialComposition}=require('./hermes-maintainer-github-update-file-credential-composition');

const COMPOSITION_VERSION='hermes_maintainer_github_update_file_runtime_composition_v1';

function createHermesMaintainerGithubUpdateFileRuntimeComposition({environment,fetchImpl,createTimeoutSignal,timeoutMs}={}){
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');
 if(typeof createTimeoutSignal!=='function')throw new TypeError('createTimeoutSignal_required');
 const credential=createHermesMaintainerGithubUpdateFileCredentialComposition({environment});
 const scope=credential.defineScope({
  capability:'github_update_file_hermes_branch_staging',
  provider:'GITHUB',
  operation:'update_file',
  environment:'staging',
  repository:'instutodp-cpu/agente-grupo-erick'
 });
 const transport=createHermesMaintainerGithubUpdateFileTransport({
  fetchImpl,createTimeoutSignal,timeoutMs,
  resolveAuthorization:reference=>{
   if(reference!==credential.credential_reference)return Promise.resolve(null);
   return credential.resolve(scope).then(result=>({
    ok:result?.resolution_valid===true&&result?.status==='GITHUB_UPDATE_FILE_CREDENTIAL_RESOLVED',
    authorization:result?.authorization
   }));
  }
 });
 const boundary=createHermesMaintainerGithubUpdateFileDurableExecutionBoundary({executeUpdateFile:request=>{
  const {method,url,body,intent_digest,attempt_reference,capability_reference,admission_reference}=request||{};
  return transport.updateFile({method,url,body,intent_digest,attempt_reference,capability_reference,admission_reference});
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
module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubUpdateFileRuntimeComposition};
