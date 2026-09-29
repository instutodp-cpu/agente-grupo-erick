'use strict';

const {defineHermesMaintainerGithubUpdateFileCredentialScope}=require('../core/hermes-maintainer-github-update-file-credential-scope');
const {createHermesMaintainerGithubUpdateFileCredentialResolver}=require('../core/hermes-maintainer-github-update-file-credential-resolution');
const {createHermesMaintainerGithubUpdateFileSourceBinding}=require('../core/hermes-maintainer-github-update-file-source-binding');
const {ALLOWED_ENVIRONMENT_KEY,createHermesMaintainerGithubUpdateFileRuntimeEnvironmentReader}=require('./hermes-maintainer-github-update-file-runtime-environment-reader');

const COMPOSITION_VERSION='hermes_maintainer_github_update_file_credential_composition_v1';
const REFERENCE='github_update_file_hermes_branch_staging';

function createHermesMaintainerGithubUpdateFileCredentialComposition({environment}={}){
 const readEnvironment=createHermesMaintainerGithubUpdateFileRuntimeEnvironmentReader({environment});
 const binding=createHermesMaintainerGithubUpdateFileSourceBinding({readSecret:async reference=>{
  if(reference!==REFERENCE)throw new Error('REFERENCE_NOT_ALLOWED');
  return readEnvironment(ALLOWED_ENVIRONMENT_KEY);
 }});
 const resolver=createHermesMaintainerGithubUpdateFileCredentialResolver({resolveSecret:binding.resolveSecret});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,environment:'staging',credential_reference:REFERENCE,
  credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,
  defineScope:defineHermesMaintainerGithubUpdateFileCredentialScope,resolve:resolver.resolve
 });
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubUpdateFileCredentialComposition};
