'use strict';
const CONTRACT_VERSION='hermes_maintainer_github_update_file_admission_v1';
const REQUEST_VERSION='hermes_maintainer_github_update_file_request_v1';
const CAPABILITY_VERSION='hermes_maintainer_github_update_file_capability_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
function admitHermesMaintainerGithubUpdateFileRequest(capability,request,admission={}){
 const blockers=[];
 if(!capability||capability.contract_version!==CAPABILITY_VERSION||capability.status!=='GITHUB_UPDATE_FILE_CAPABILITY_GRANTED'||capability.capability_valid!==true||capability.operation!=='update_file'||capability.repository!==REPOSITORY||capability.credential_scope_bound!==true)blockers.push('CAPABILITY_INVALID');
 if(!request||request.contract_version!==REQUEST_VERSION||request.status!=='GITHUB_UPDATE_FILE_REQUEST_PREPARED'||request.request_valid!==true||request.provider!=='GITHUB'||request.operation!=='update_file'||request.repository!==REPOSITORY||request.method!=='PUT')blockers.push('REQUEST_INVALID');
 if(request?.branch!==capability?.branch||!request?.body||request.body.branch!==capability?.branch)blockers.push('BRANCH_BINDING_MISMATCH');
 if(request?.authorization_header_present!==false||request?.credential_material_present!==false||request?.execution_authorized!==false||request?.network_call_performed!==false||request?.write_performed!==false||request?.production_used!==false)blockers.push('REQUEST_SIDE_EFFECT_STATE_INVALID');
 if(admission.decision!=='ADMITTED'||admission.intent_digest!==capability?.intent_digest||admission.attempt_reference!==capability?.attempt_reference||admission.capability_reference!==capability?.capability_reference)blockers.push('ADMISSION_BINDING_MISMATCH');
 if(typeof admission.admission_reference!=='string'||!admission.admission_reference.trim())blockers.push('ADMISSION_REFERENCE_REQUIRED');
 const valid=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'GITHUB_UPDATE_FILE_REQUEST_ADMITTED':'GITHUB_UPDATE_FILE_REQUEST_BLOCKED',admission_valid:valid,provider:'GITHUB',operation:'update_file',repository:valid?REPOSITORY:null,branch:valid?capability.branch:null,intent_digest:valid?capability.intent_digest:null,attempt_reference:valid?capability.attempt_reference:null,capability_reference:valid?capability.capability_reference:null,admission_reference:valid?admission.admission_reference:null,request:valid?Object.freeze({method:request.method,url:request.url,body:request.body}):null,credential_material_present:false,execution_authorized:valid,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
module.exports={CONTRACT_VERSION,admitHermesMaintainerGithubUpdateFileRequest};
