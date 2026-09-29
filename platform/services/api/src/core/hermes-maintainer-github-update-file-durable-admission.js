'use strict';
const CONTRACT_VERSION='hermes_maintainer_github_update_file_durable_admission_v1';
const ADMISSION_VERSION='hermes_maintainer_github_update_file_admission_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
function admitHermesMaintainerGithubUpdateFileDurableRequest(admission,ownership){
 const blockers=[];
 if(!admission||admission.contract_version!==ADMISSION_VERSION||admission.status!=='GITHUB_UPDATE_FILE_REQUEST_ADMITTED'||admission.admission_valid!==true||admission.execution_authorized!==true)blockers.push('UPDATE_FILE_ADMISSION_INVALID');
 if(admission?.provider!=='GITHUB'||admission?.operation!=='update_file'||admission?.repository!==REPOSITORY)blockers.push('WRITE_SCOPE_INVALID');
 if(!ownership||ownership.decision!=='OWNED'||typeof ownership.persistence_key!=='string'||!ownership.persistence_key.trim()||ownership.intent_digest!==admission?.intent_digest||ownership.attempt_reference!==admission?.attempt_reference)blockers.push('DURABLE_OWNERSHIP_INVALID');
 const ownership_key=ownership?.persistence_key?ownership.persistence_key+'::attempt-ownership':null;
 if(ownership?.ownership_key!==ownership_key)blockers.push('DURABLE_OWNERSHIP_KEY_INVALID');
 if(admission?.credential_material_present!==false||admission?.network_call_performed!==false||admission?.write_performed!==false||admission?.production_used!==false)blockers.push('PREEXECUTION_STATE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'GITHUB_UPDATE_FILE_DURABLE_REQUEST_ADMITTED':'GITHUB_UPDATE_FILE_DURABLE_REQUEST_BLOCKED',admission_valid:valid,provider:'GITHUB',operation:'update_file',repository:REPOSITORY,ownership_source:valid?'DURABLE_PERSISTENCE_RECEIPT':null,ownership_key:valid?ownership_key:null,persistence_key:valid?ownership.persistence_key:null,intent_digest:valid?admission.intent_digest:null,attempt_reference:valid?admission.attempt_reference:null,capability_reference:valid?admission.capability_reference:null,admission_reference:valid?admission.admission_reference:null,request:valid?admission.request:null,credential_material_present:false,execution_authorized:valid,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
module.exports={CONTRACT_VERSION,admitHermesMaintainerGithubUpdateFileDurableRequest};
