'use strict';

const {createHermesMaintainerGithubWriteRuntimeEntry}=require('./hermes-maintainer-github-write-runtime-entry');

const PROCESS_RUNTIME_BINDING_VERSION='hermes_maintainer_github_write_process_runtime_binding_v1';

function createHermesMaintainerGithubWriteProcessRuntimeBinding({environment,fetchImpl,createTimeoutSignal}={}){
 if(!environment||typeof environment!=='object')throw new TypeError('environment_required');
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');
 if(typeof createTimeoutSignal!=='function')throw new TypeError('createTimeoutSignal_required');
 const entry=createHermesMaintainerGithubWriteRuntimeEntry({environment,fetchImpl,createTimeoutSignal});
 return Object.freeze({
  process_runtime_binding_version:PROCESS_RUNTIME_BINDING_VERSION,
  environment:'staging',
  credential_reference:entry.credential_reference,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  execute:entry.execute
 });
}

function createHermesMaintainerGithubWriteProcessRuntime(){
 if(typeof globalThis.fetch!=='function')throw new TypeError('global_fetch_unavailable');
 if(typeof AbortSignal==='undefined'||typeof AbortSignal.timeout!=='function')throw new TypeError('abort_signal_timeout_unavailable');
 return createHermesMaintainerGithubWriteProcessRuntimeBinding({
  environment:process.env,
  fetchImpl:globalThis.fetch.bind(globalThis),
  createTimeoutSignal:milliseconds=>AbortSignal.timeout(milliseconds)
 });
}

module.exports={PROCESS_RUNTIME_BINDING_VERSION,createHermesMaintainerGithubWriteProcessRuntimeBinding,createHermesMaintainerGithubWriteProcessRuntime};
