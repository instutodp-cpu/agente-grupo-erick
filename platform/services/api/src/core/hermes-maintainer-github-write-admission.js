'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_write_admission_v1';
const REQUEST_VERSION='hermes_maintainer_github_create_branch_request_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const URL='https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/git/refs';

function admitHermesMaintainerGithubWriteRequest(request,admission){
 const blockers=[];
 if(!request||request.contract_version!==REQUEST_VERSION||request.status!=='GITHUB_CREATE_BRANCH_REQUEST_PREPARED'||request.request_valid!==true)blockers.push('CREATE_BRANCH_REQUEST_INVALID');
 if(request?.provider!=='GITHUB'||request?.method!=='POST'||request?.url!==URL)blockers.push('PROVIDER_REQUEST_SCOPE_INVALID');
 if(!request?.body||typeof request.body.ref!=='string'||!/^refs\/heads\/hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(request.body.ref)||request.body.ref.includes('..'))blockers.push('BRANCH_REF_INVALID');
 if(typeof request?.body?.sha!=='string'||!/^[a-f0-9]{40}$/.test(request.body.sha))blockers.push('BASE_SHA_INVALID');
 if(request?.authorization_header_present!==false||request?.credential_material_present!==false||request?.network_call_performed!==false||request?.write_performed!==false)blockers.push('REQUEST_SIDE_EFFECT_STATE_INVALID');
 if(!admission||admission.decision!=='ADMITTED')blockers.push('ADMISSION_NOT_GRANTED');
 if(admission?.intent_digest!==request?.intent_digest||admission?.attempt_reference!==request?.attempt_reference||admission?.capability_reference!==request?.capability_reference)blockers.push('ADMISSION_BINDING_MISMATCH');
 if(typeof admission?.admission_reference!=='string'||!admission.admission_reference.trim())blockers.push('ADMISSION_REFERENCE_REQUIRED');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'GITHUB_WRITE_REQUEST_ADMITTED':'GITHUB_WRITE_REQUEST_BLOCKED',
  admission_valid:valid,
  provider:'GITHUB',
  operation:'create_branch',
  repository:REPOSITORY,
  intent_digest:valid?request.intent_digest:null,
  attempt_reference:valid?request.attempt_reference:null,
  capability_reference:valid?request.capability_reference:null,
  admission_reference:valid?admission.admission_reference:null,
  request:valid?Object.freeze({method:request.method,url:request.url,body:request.body}):null,
  credential_material_present:false,
  execution_authorized:valid,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,admitHermesMaintainerGithubWriteRequest};
