'use strict';

const {createHermesMaintainerGithubDurableWriteExecutionBoundary}=require('../core/hermes-maintainer-github-durable-write-execution-boundary');
const {createHermesMaintainerGithubCreateBranchTransport}=require('../core/hermes-maintainer-github-create-branch-transport');
const {createHermesMaintainerGithubWriteCredentialComposition}=require('./hermes-maintainer-github-write-credential-composition');

const COMPOSITION_VERSION='hermes_maintainer_github_durable_write_runtime_composition_v1';

function createHermesMaintainerGithubDurableWriteRuntimeComposition({environment,fetchImpl,createTimeoutSignal,timeoutMs}={}){
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');
 if(typeof createTimeoutSignal!=='function')throw new TypeError('createTimeoutSignal_required');
 const credential=createHermesMaintainerGithubWriteCredentialComposition({environment});
 const scope=credential.defineScope({
  capability:'github_create_branch_staging',
  provider:'GITHUB',
  operation:'create_branch',
  environment:'staging',
  repository:'instutodp-cpu/agente-grupo-erick'
 });
 const transport=createHermesMaintainerGithubCreateBranchTransport({
  fetchImpl,
  createTimeoutSignal,
  timeoutMs,
  resolveAuthorization:reference=>{
   if(reference!==credential.credential_reference)return Promise.resolve(null);
   return credential.resolve(scope).then(result=>({
    ok:result?.resolution_valid===true&&result?.status==='GITHUB_WRITE_CREDENTIAL_RESOLVED',
    authorization:result?.authorization
   }));
  }
 });
 const boundary=createHermesMaintainerGithubDurableWriteExecutionBoundary({
  executeCreateBranch:transport.createBranch
 });
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

module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubDurableWriteRuntimeComposition};
