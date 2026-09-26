'use strict';

const ALLOWED_ENVIRONMENT_KEY='HERMES_GITHUB_READ_ONLY_STAGING_TOKEN';

function createHermesMaintainerRuntimeEnvironmentReader({environment}={}){
 if(!environment||typeof environment!=='object')throw new TypeError('environment required');
 return async function readEnvironment(key){
  if(key!==ALLOWED_ENVIRONMENT_KEY)throw new Error('ENVIRONMENT_KEY_NOT_ALLOWED');
  const value=environment[ALLOWED_ENVIRONMENT_KEY];
  if(typeof value!=='string'||value.length<1)return undefined;
  return value;
 };
}

module.exports={ALLOWED_ENVIRONMENT_KEY,createHermesMaintainerRuntimeEnvironmentReader};
