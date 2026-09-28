'use strict';

const GUARD_VERSION='hermes_maintainer_github_write_canary_execution_guard_v1';
const CANARY_VERSION='hermes_maintainer_github_write_canary_contract_v1';
const ADMISSION_VERSION='hermes_maintainer_github_durable_write_admission_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const URL='https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/git/refs';

function createHermesMaintainerGithubWriteCanaryExecutionGuard({execute}={}){
 if(typeof execute!=='function')throw new TypeError('execute_required');
 return Object.freeze({execute:async(canary,admission)=>{
  const blockers=[];
  if(!canary||canary.contract_version!==CANARY_VERSION||canary.status!=='CANARY_PREPARED'||canary.canary_valid!==true)blockers.push('CANARY_INVALID');
  if(canary?.repository!==REPOSITORY||canary?.operation!=='create_branch'||typeof canary?.ref!=='string'||!/^refs\/heads\/hermes\/canary\/[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(canary.ref)||canary.ref.includes('..')||typeof canary?.sha!=='string'||!/^[a-f0-9]{40}$/.test(canary.sha))blockers.push('CANARY_SCOPE_INVALID');
  if(canary?.execution_authorized!==false||canary?.credential_material_present!==false||canary?.network_call_performed!==false||canary?.write_performed!==false||canary?.production_used!==false)blockers.push('CANARY_STATE_INVALID');
  if(!admission||admission.contract_version!==ADMISSION_VERSION||admission.status!=='GITHUB_DURABLE_WRITE_REQUEST_ADMITTED'||admission.admission_valid!==true||admission.execution_authorized!==true||admission.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT')blockers.push('DURABLE_ADMISSION_INVALID');
  if(admission?.provider!=='GITHUB'||admission?.operation!=='create_branch'||admission?.repository!==REPOSITORY||admission?.request?.method!=='POST'||admission?.request?.url!==URL)blockers.push('ADMISSION_SCOPE_INVALID');
  if(admission?.request?.body?.ref!==canary?.ref||admission?.request?.body?.sha!==canary?.sha)blockers.push('CANARY_ADMISSION_BINDING_MISMATCH');
  if(blockers.length)return blocked(blockers);
  return execute(admission);
 }});
}

function blocked(blockers){
 return Object.freeze({
  guard_version:GUARD_VERSION,
  status:'CANARY_EXECUTION_BLOCKED',
  execution_performed:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}

module.exports={GUARD_VERSION,createHermesMaintainerGithubWriteCanaryExecutionGuard};
