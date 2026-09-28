'use strict';

const {createHermesMaintainerGithubWriteProcessRuntimeBinding}=require('./hermes-maintainer-github-write-process-runtime-binding');
const {createHermesMaintainerGithubWriteCanaryExecutionGuard}=require('../core/hermes-maintainer-github-write-canary-execution-guard');

const RUNNER_VERSION='hermes_maintainer_github_write_canary_runtime_runner_v1';

function createHermesMaintainerGithubWriteCanaryRuntimeRunner({environment,fetchImpl,createTimeoutSignal,timeoutMs}={}){
 if(!environment||typeof environment!=='object')throw new TypeError('environment_required');
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');
 if(typeof createTimeoutSignal!=='function')throw new TypeError('createTimeoutSignal_required');
 const runtime=createHermesMaintainerGithubWriteProcessRuntimeBinding({environment,fetchImpl,createTimeoutSignal,timeoutMs});
 const guard=createHermesMaintainerGithubWriteCanaryExecutionGuard({execute:runtime.execute});
 return Object.freeze({
  runner_version:RUNNER_VERSION,
  environment:'staging',
  credential_reference:runtime.credential_reference,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  execute:guard.execute
 });
}

module.exports={RUNNER_VERSION,createHermesMaintainerGithubWriteCanaryRuntimeRunner};
