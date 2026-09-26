'use strict';
const CONTRACT_VERSION='hermes_maintainer_github_auth_source_binding_v1';
const REFERENCE='github_read_only_staging';
function createHermesMaintainerGithubAuthSourceBinding({readSecret}={}){
 if(typeof readSecret!=='function')throw new TypeError('readSecret required');
 return Object.freeze({contract_version:CONTRACT_VERSION,reference:REFERENCE,async resolveSecret(reference){
  if(reference!==REFERENCE)throw new Error('REFERENCE_NOT_ALLOWED');
  const value=await readSecret(REFERENCE);
  if(typeof value!=='string'||value.length<1)throw new Error('SECRET_UNAVAILABLE');
  return value;
 }});
}
module.exports={CONTRACT_VERSION,REFERENCE,createHermesMaintainerGithubAuthSourceBinding};
