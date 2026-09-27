'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_create_branch_request_v1';
const API_ORIGIN='https://api.github.com';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';

function prepareHermesMaintainerGithubCreateBranchRequest(capability){
 const blockers=[];
 if(!capability||capability.contract_version!=='hermes_maintainer_scm_write_capability_v1'||capability.status!=='SCM_WRITE_CAPABILITY_GRANTED'||capability.capability_valid!==true||capability.capability!=='github_create_branch_staging'||capability.credential_scope_bound!==true)blockers.push('WRITE_CAPABILITY_INVALID');
 if(capability?.operation!=='create_branch'||capability?.repository!==REPOSITORY||capability?.base_ref!=='main')blockers.push('TARGET_SCOPE_INVALID');
 if(typeof capability?.base_sha!=='string'||!/^[a-f0-9]{40}$/.test(capability.base_sha))blockers.push('BASE_SHA_INVALID');
 if(typeof capability?.branch_name!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(capability.branch_name)||capability.branch_name.includes('..'))blockers.push('BRANCH_NAME_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'GITHUB_CREATE_BRANCH_REQUEST_PREPARED':'GITHUB_CREATE_BRANCH_REQUEST_BLOCKED',
  request_valid:valid,
  provider:'GITHUB',
  method:valid?'POST':null,
  url:valid?`${API_ORIGIN}/repos/${REPOSITORY}/git/refs`:null,
  body:valid?Object.freeze({ref:`refs/heads/${capability.branch_name}`,sha:capability.base_sha}):null,
  intent_digest:valid?capability.intent_digest:null,
  attempt_reference:valid?capability.attempt_reference:null,
  capability_reference:valid?capability.capability_reference:null,
  authorization_header_present:false,
  credential_material_present:false,
  execution_authorized:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerGithubCreateBranchRequest};
