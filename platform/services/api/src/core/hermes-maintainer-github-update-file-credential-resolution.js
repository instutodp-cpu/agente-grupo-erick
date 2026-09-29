'use strict';

const SCOPE_VERSION='hermes_maintainer_github_update_file_credential_scope_v1';
const CONTRACT_VERSION='hermes_maintainer_github_update_file_credential_resolution_v1';
const REFERENCE='github_update_file_hermes_branch_staging';

function blocked(reason,performed=false){
 return Object.freeze({
  contract_version:CONTRACT_VERSION,status:'GITHUB_UPDATE_FILE_CREDENTIAL_RESOLUTION_BLOCKED',resolution_valid:false,
  credential_reference:REFERENCE,authorization:null,credential_material_present:false,
  credential_resolution_performed:performed,authorization_header_present:false,
  network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([reason])
 });
}
function createHermesMaintainerGithubUpdateFileCredentialResolver({resolveSecret}={}){
 if(typeof resolveSecret!=='function')throw new TypeError('resolveSecret required');
 return Object.freeze({contract_version:CONTRACT_VERSION,async resolve(scope){
  if(!scope||scope.contract_version!==SCOPE_VERSION||scope.status!=='GITHUB_UPDATE_FILE_CREDENTIAL_SCOPE_DEFINED'||scope.scope_valid!==true||scope.credential_reference!==REFERENCE)return blocked('SCOPE_NOT_ALLOWED');
  if(scope.provider!=='GITHUB'||scope.operation!=='update_file'||scope.environment!=='staging'||scope.repository!=='instutodp-cpu/agente-grupo-erick')return blocked('SCOPE_NOT_ALLOWED');
  if(scope.credential_material_present!==false||scope.credential_resolution_performed!==false||scope.authorization_header_present!==false||scope.network_call_performed!==false||scope.write_performed!==false||scope.production_used!==false)return blocked('PRERESOLUTION_STATE_INVALID');
  let material;try{material=await resolveSecret(REFERENCE);}catch{return blocked('RESOLUTION_FAILED',true);}
  if(typeof material!=='string'||material.length<1)return blocked('RESOLUTION_FAILED',true);
  return Object.freeze({
   contract_version:CONTRACT_VERSION,status:'GITHUB_UPDATE_FILE_CREDENTIAL_RESOLVED',resolution_valid:true,
   credential_reference:REFERENCE,authorization:'Bearer '+material,credential_material_present:false,
   credential_resolution_performed:true,authorization_header_present:true,network_call_performed:false,
   write_performed:false,production_used:false,blockers:Object.freeze([])
  });
 }});
}
module.exports={CONTRACT_VERSION,REFERENCE,createHermesMaintainerGithubUpdateFileCredentialResolver};
