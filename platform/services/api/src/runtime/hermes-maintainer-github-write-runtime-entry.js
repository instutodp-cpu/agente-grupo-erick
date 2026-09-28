'use strict';

const {createHermesMaintainerGithubDurableWriteRuntimeComposition}=require('./hermes-maintainer-github-durable-write-runtime-composition');

const RUNTIME_ENTRY_VERSION='hermes_maintainer_github_write_runtime_entry_v1';

function createHermesMaintainerGithubWriteRuntimeEntry({environment,fetchImpl,createTimeoutSignal,timeoutMs}={}){
 if(!environment||typeof environment!=='object')throw new TypeError('environment_required');
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');
 if(typeof createTimeoutSignal!=='function')throw new TypeError('createTimeoutSignal_required');
 const composition=createHermesMaintainerGithubDurableWriteRuntimeComposition({
  environment,fetchImpl,createTimeoutSignal,timeoutMs
 });
 return Object.freeze({
  runtime_entry_version:RUNTIME_ENTRY_VERSION,
  environment:'staging',
  credential_reference:composition.credential_reference,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  execute:composition.execute
 });
}

module.exports={RUNTIME_ENTRY_VERSION,createHermesMaintainerGithubWriteRuntimeEntry};
