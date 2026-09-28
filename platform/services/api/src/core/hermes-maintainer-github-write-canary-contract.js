'use strict';

const CANARY_CONTRACT_VERSION='hermes_maintainer_github_write_canary_contract_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const OPERATION='create_branch';
const REF_RE=/^refs\/heads\/hermes\/canary\/[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const SHA_RE=/^[a-f0-9]{40}$/;

function prepareHermesMaintainerGithubWriteCanary({repository,operation,ref,sha}={}){
 if(repository!==REPOSITORY)return blocked('REPOSITORY_NOT_ALLOWED');
 if(operation!==OPERATION)return blocked('OPERATION_NOT_ALLOWED');
 if(typeof ref!=='string'||!REF_RE.test(ref)||ref.includes('..'))return blocked('REF_NOT_ALLOWED');
 if(typeof sha!=='string'||!SHA_RE.test(sha))return blocked('SHA_NOT_ALLOWED');
 return Object.freeze({
  contract_version:CANARY_CONTRACT_VERSION,
  status:'CANARY_PREPARED',
  canary_valid:true,
  provider:'GITHUB',
  environment:'staging',
  repository:REPOSITORY,
  operation:OPERATION,
  ref,
  sha,
  credential_material_present:false,
  execution_authorized:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false
 });
}

function blocked(reason){
 return Object.freeze({
  contract_version:CANARY_CONTRACT_VERSION,
  status:'BLOCKED',
  canary_valid:false,
  reason,
  credential_material_present:false,
  execution_authorized:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false
 });
}

module.exports={CANARY_CONTRACT_VERSION,prepareHermesMaintainerGithubWriteCanary};
