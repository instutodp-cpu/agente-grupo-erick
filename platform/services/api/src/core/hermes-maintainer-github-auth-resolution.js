'use strict';
const CONTRACT_VERSION='hermes_maintainer_github_auth_resolution_v1';
const ALLOWED_REFERENCE='github_read_only_staging';
function createHermesMaintainerGithubAuthorizationResolver({resolveSecret}={}){
 if(typeof resolveSecret!=='function')throw new TypeError('resolveSecret required');
 return Object.freeze({contract_version:CONTRACT_VERSION,async resolve(reference){
  if(reference!==ALLOWED_REFERENCE)return Object.freeze({ok:false,reason:'REFERENCE_NOT_ALLOWED',authorization:null,credential_material_present:false});
  let material;
  try{material=await resolveSecret(reference);}catch{return Object.freeze({ok:false,reason:'RESOLUTION_FAILED',authorization:null,credential_material_present:false});}
  if(typeof material!=='string'||material.length<1)return Object.freeze({ok:false,reason:'RESOLUTION_FAILED',authorization:null,credential_material_present:false});
  return Object.freeze({ok:true,authorization:'Bearer '+material,credential_material_present:false});
 }});
}
function authorizationFromResolution(resolution){
 if(!resolution||resolution.ok!==true||typeof resolution.authorization!=='string'||resolution.authorization.length<8)throw new Error('AUTHORIZATION_UNAVAILABLE');
 return resolution.authorization;
}
module.exports={CONTRACT_VERSION,ALLOWED_REFERENCE,createHermesMaintainerGithubAuthorizationResolver,authorizationFromResolution};
