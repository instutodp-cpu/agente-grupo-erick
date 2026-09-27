'use strict';

const {defineHermesMaintainerGithubWriteCredentialScope}=require('../core/hermes-maintainer-github-write-credential-scope');
const {createHermesMaintainerGithubWriteCredentialResolver}=require('../core/hermes-maintainer-github-write-credential-resolution');
const {createHermesMaintainerGithubWriteSourceBinding}=require('../core/hermes-maintainer-github-write-source-binding');
const {ALLOWED_ENVIRONMENT_KEY,createHermesMaintainerWriteRuntimeEnvironmentReader}=require('./hermes-maintainer-write-runtime-environment-reader');

const COMPOSITION_VERSION='hermes_maintainer_github_write_credential_composition_v1';
const REFERENCE='github_create_branch_staging';

function createHermesMaintainerGithubWriteCredentialComposition({environment}={}){
 const readEnvironment=createHermesMaintainerWriteRuntimeEnvironmentReader({environment});
 const binding=createHermesMaintainerGithubWriteSourceBinding({
  readSecret:async reference=>{
   if(reference!==REFERENCE)throw new Error('REFERENCE_NOT_ALLOWED');
   return readEnvironment(ALLOWED_ENVIRONMENT_KEY);
  }
 });
 const resolver=createHermesMaintainerGithubWriteCredentialResolver({resolveSecret:binding.resolveSecret});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  environment:'staging',
  credential_reference:REFERENCE,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  defineScope:defineHermesMaintainerGithubWriteCredentialScope,
  resolve:resolver.resolve
 });
}

module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubWriteCredentialComposition};
