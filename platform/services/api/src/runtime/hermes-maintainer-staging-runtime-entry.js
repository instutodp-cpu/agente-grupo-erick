'use strict';

const {createHermesMaintainerRuntimeEnvironmentReader}=require('./hermes-maintainer-runtime-environment-reader');
const {createHermesMaintainerStagingRuntimeComposition}=require('../core/hermes-maintainer-staging-runtime-composition');

const RUNTIME_ENTRY_VERSION='hermes_maintainer_staging_runtime_entry_v1';

function createHermesMaintainerStagingRuntimeEntry({environment}={}){
 const readEnvironment=createHermesMaintainerRuntimeEnvironmentReader({environment});
 const composition=createHermesMaintainerStagingRuntimeComposition({readEnvironment});
 return Object.freeze({
  runtime_entry_version:RUNTIME_ENTRY_VERSION,
  environment:'staging',
  credential_reference:composition.credential_reference,
  credential_material_present:false,
  resolveAuthorization:composition.resolveAuthorization
 });
}

module.exports={RUNTIME_ENTRY_VERSION,createHermesMaintainerStagingRuntimeEntry};
