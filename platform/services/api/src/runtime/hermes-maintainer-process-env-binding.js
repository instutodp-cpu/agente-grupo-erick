'use strict';

const {createHermesMaintainerStagingRuntimeEntry}=require('./hermes-maintainer-staging-runtime-entry');

const PROCESS_ENV_BINDING_VERSION='hermes_maintainer_process_env_binding_v1';

function createHermesMaintainerProcessEnvBinding({environment}={}){
 if(!environment||typeof environment!=='object')throw new TypeError('environment required');
 const runtimeEntry=createHermesMaintainerStagingRuntimeEntry({environment});
 return Object.freeze({
  process_env_binding_version:PROCESS_ENV_BINDING_VERSION,
  environment:'staging',
  credential_reference:runtimeEntry.credential_reference,
  credential_material_present:false,
  resolveAuthorization:runtimeEntry.resolveAuthorization
 });
}

function createHermesMaintainerProcessRuntime(){
 return createHermesMaintainerProcessEnvBinding({environment:process.env});
}

module.exports={PROCESS_ENV_BINDING_VERSION,createHermesMaintainerProcessEnvBinding,createHermesMaintainerProcessRuntime};
