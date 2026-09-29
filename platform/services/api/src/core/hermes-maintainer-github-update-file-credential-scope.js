'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_update_file_credential_scope_v1';
const CAPABILITY='github_update_file_hermes_branch_staging';
const PROVIDER='GITHUB';
const OPERATION='update_file';
const ENVIRONMENT='staging';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';

function defineHermesMaintainerGithubUpdateFileCredentialScope(input={}){
 const blockers=[];
 if(input.capability!==CAPABILITY)blockers.push('CAPABILITY_NOT_ALLOWED');
 if(input.provider!==PROVIDER)blockers.push('PROVIDER_NOT_ALLOWED');
 if(input.operation!==OPERATION)blockers.push('OPERATION_NOT_ALLOWED');
 if(input.environment!==ENVIRONMENT)blockers.push('ENVIRONMENT_NOT_ALLOWED');
 if(input.repository!==REPOSITORY)blockers.push('REPOSITORY_NOT_ALLOWED');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'GITHUB_UPDATE_FILE_CREDENTIAL_SCOPE_DEFINED':'GITHUB_UPDATE_FILE_CREDENTIAL_SCOPE_BLOCKED',
  scope_valid:valid,
  capability:valid?CAPABILITY:null,
  provider:valid?PROVIDER:null,
  operation:valid?OPERATION:null,
  environment:valid?ENVIRONMENT:null,
  repository:valid?REPOSITORY:null,
  credential_reference:valid?CAPABILITY:null,
  credential_material_present:false,
  credential_resolution_performed:false,
  authorization_header_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,CAPABILITY,defineHermesMaintainerGithubUpdateFileCredentialScope};
