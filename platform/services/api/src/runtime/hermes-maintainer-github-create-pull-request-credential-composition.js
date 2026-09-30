'use strict';

const {defineHermesMaintainerGithubCreatePullRequestCredentialScope}=require('../core/hermes-maintainer-github-create-pull-request-credential-scope');
const {createHermesMaintainerGithubCreatePullRequestCredentialResolver}=require('../core/hermes-maintainer-github-create-pull-request-credential-resolution');
const {createHermesMaintainerGithubCreatePullRequestSourceBinding}=require('../core/hermes-maintainer-github-create-pull-request-source-binding');
const {ALLOWED_ENVIRONMENT_KEY,createHermesMaintainerGithubCreatePullRequestRuntimeEnvironmentReader}=require('./hermes-maintainer-github-create-pull-request-runtime-environment-reader');

const COMPOSITION_VERSION='hermes_maintainer_github_create_pull_request_credential_composition_v1';
const REFERENCE='github_create_pull_request_hermes_branch_staging';

function createHermesMaintainerGithubCreatePullRequestCredentialComposition({environment}={}){
 const readEnvironment=createHermesMaintainerGithubCreatePullRequestRuntimeEnvironmentReader({environment});
 const binding=createHermesMaintainerGithubCreatePullRequestSourceBinding({readSecret:async reference=>{
  if(reference!==REFERENCE)throw new Error('REFERENCE_NOT_ALLOWED');
  return readEnvironment(ALLOWED_ENVIRONMENT_KEY);
 }});
 const resolver=createHermesMaintainerGithubCreatePullRequestCredentialResolver({resolveSecret:binding.resolveSecret});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,environment:'staging',credential_reference:REFERENCE,
  credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,
  defineScope:defineHermesMaintainerGithubCreatePullRequestCredentialScope,resolve:resolver.resolve
 });
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubCreatePullRequestCredentialComposition};
