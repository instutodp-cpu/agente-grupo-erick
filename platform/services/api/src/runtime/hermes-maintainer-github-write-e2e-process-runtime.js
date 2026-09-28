'use strict';

const {createHermesMaintainerGithubWriteE2ePostgresRuntime}=require('./hermes-maintainer-github-write-e2e-postgres-runtime');

const PROCESS_RUNTIME_VERSION='hermes_maintainer_github_write_e2e_process_runtime_v1';

function createHermesMaintainerGithubWriteE2eProcessRuntime({environment=process.env,PoolClass,fetchImpl=globalThis.fetch,createTimeoutSignal}={}){
 if(typeof fetchImpl!=='function')throw new TypeError('global_fetch_unavailable');
 const timeoutSignal=createTimeoutSignal??(milliseconds=>{
  if(typeof AbortSignal==='undefined'||typeof AbortSignal.timeout!=='function')throw new TypeError('abort_signal_timeout_unavailable');
  return AbortSignal.timeout(milliseconds);
 });
 const runtime=createHermesMaintainerGithubWriteE2ePostgresRuntime({environment,PoolClass,fetchImpl,createTimeoutSignal:timeoutSignal});
 return Object.freeze({
  process_runtime_version:PROCESS_RUNTIME_VERSION,
  environment:'staging',
  credential_reference:runtime.credential_reference,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  execute:runtime.execute,
  close:runtime.close
 });
}

module.exports={PROCESS_RUNTIME_VERSION,createHermesMaintainerGithubWriteE2eProcessRuntime};
