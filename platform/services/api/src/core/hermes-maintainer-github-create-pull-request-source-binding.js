'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_create_pull_request_source_binding_v1';
const REFERENCE='github_create_pull_request_hermes_branch_staging';

function createHermesMaintainerGithubCreatePullRequestSourceBinding({readSecret}={}){
 if(typeof readSecret!=='function')throw new TypeError('readSecret required');
 return Object.freeze({
  contract_version:CONTRACT_VERSION,reference:REFERENCE,credential_material_present:false,
  network_call_performed:false,write_performed:false,production_used:false,
  async resolveSecret(reference){
   if(reference!==REFERENCE)throw new Error('REFERENCE_NOT_ALLOWED');
   const value=await readSecret(REFERENCE);
   if(typeof value!=='string'||value.length<1)throw new Error('SECRET_UNAVAILABLE');
   return value;
  }
 });
}
module.exports={CONTRACT_VERSION,REFERENCE,createHermesMaintainerGithubCreatePullRequestSourceBinding};
