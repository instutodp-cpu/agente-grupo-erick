'use strict';

const {createHermesMaintainerGithubWriteProcessRuntimeBinding}=require('./hermes-maintainer-github-write-process-runtime-binding');

const READINESS_VERSION='hermes_maintainer_github_write_runtime_readiness_v1';
const TOKEN_KEY='HERMES_GITHUB_CREATE_BRANCH_STAGING_TOKEN';

function checkHermesMaintainerGithubWriteRuntimeReadiness({environment,fetchImpl,createTimeoutSignal}={}){
 if(!environment||typeof environment!=='object')return blocked('ENVIRONMENT_UNAVAILABLE');
 if(typeof fetchImpl!=='function')return blocked('FETCH_UNAVAILABLE');
 if(typeof createTimeoutSignal!=='function')return blocked('TIMEOUT_SIGNAL_FACTORY_UNAVAILABLE');
 const token=environment[TOKEN_KEY];
 if(typeof token!=='string'||token.length===0)return blocked('WRITE_CREDENTIAL_UNAVAILABLE');
 let runtime;
 try{
  runtime=createHermesMaintainerGithubWriteProcessRuntimeBinding({environment,fetchImpl,createTimeoutSignal});
 }catch{
  return blocked('RUNTIME_BINDING_UNAVAILABLE');
 }
 return Object.freeze({
  readiness_version:READINESS_VERSION,
  status:'READY',
  ready:true,
  environment:'staging',
  credential_reference:runtime.credential_reference,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false
 });
}

function blocked(reason){
 return Object.freeze({
  readiness_version:READINESS_VERSION,
  status:'BLOCKED',
  ready:false,
  reason,
  environment:'staging',
  credential_reference:'github_create_branch_staging',
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false
 });
}

module.exports={READINESS_VERSION,checkHermesMaintainerGithubWriteRuntimeReadiness};
