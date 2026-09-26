'use strict';
const {createHermesMaintainerStagingSecretSource}=require('./hermes-maintainer-staging-secret-source');
const {createHermesMaintainerGithubAuthSourceBinding}=require('./hermes-maintainer-github-auth-source-binding');
const {createHermesMaintainerGithubAuthorizationResolver}=require('./hermes-maintainer-github-auth-resolution');

const COMPOSITION_VERSION='hermes_maintainer_staging_runtime_composition_v1';

function createHermesMaintainerStagingRuntimeComposition({readEnvironment}={}){
 if(typeof readEnvironment!=='function')throw new TypeError('readEnvironment required');
 const source=createHermesMaintainerStagingSecretSource({readEnvironment});
 const binding=createHermesMaintainerGithubAuthSourceBinding({readSecret:source.readSecret});
 const authorizationResolver=createHermesMaintainerGithubAuthorizationResolver({resolveSecret:binding.resolveSecret});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  environment:'staging',
  credential_reference:'github_read_only_staging',
  credential_material_present:false,
  source:Object.freeze({contract_version:source.contract_version,reference:source.reference,environment_key:source.environment_key}),
  resolveAuthorization:authorizationResolver.resolve
 });
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerStagingRuntimeComposition};
