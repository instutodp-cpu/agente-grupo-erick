'use strict';
const CONTRACT_VERSION='hermes_maintainer_staging_secret_source_v1';
const REFERENCE='github_read_only_staging';
const ENV_KEY='HERMES_GITHUB_READ_ONLY_STAGING_TOKEN';
function createHermesMaintainerStagingSecretSource({readEnvironment}={}){
 if(typeof readEnvironment!=='function')throw new TypeError('readEnvironment required');
 return Object.freeze({contract_version:CONTRACT_VERSION,reference:REFERENCE,environment_key:ENV_KEY,async readSecret(reference){
  if(reference!==REFERENCE)throw new Error('REFERENCE_NOT_ALLOWED');
  let value;
  try{value=await readEnvironment(ENV_KEY);}catch{throw new Error('SECRET_SOURCE_UNAVAILABLE');}
  if(typeof value!=='string'||value.length<1)throw new Error('SECRET_UNAVAILABLE');
  return value;
 }});
}
module.exports={CONTRACT_VERSION,REFERENCE,ENV_KEY,createHermesMaintainerStagingSecretSource};
