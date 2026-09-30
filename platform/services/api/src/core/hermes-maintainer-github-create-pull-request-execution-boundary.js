'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_create_pull_request_execution_boundary_v1';
const ADMISSION_VERSION='hermes_maintainer_github_create_pull_request_durable_admission_v1';

function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_CREATE_PULL_REQUEST_EXECUTION_BLOCKED',execution_valid:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([reason])});}

function createHermesMaintainerGithubCreatePullRequestExecutionBoundary({transport}={}){
 if(typeof transport!=='function')throw new TypeError('transport required');
 return Object.freeze({contract_version:CONTRACT_VERSION,async execute(admitted,credential){
  if(!admitted||admitted.contract_version!==ADMISSION_VERSION||admitted.status!=='GITHUB_CREATE_PULL_REQUEST_DURABLE_REQUEST_ADMITTED'||admitted.admission_valid!==true||admitted.execution_authorized!==true)return blocked('DURABLE_ADMISSION_INVALID');
  if(!credential||credential.status!=='GITHUB_CREATE_PULL_REQUEST_CREDENTIAL_RESOLVED'||credential.resolution_valid!==true||credential.authorization_header_present!==true)return blocked('CREDENTIAL_NOT_RESOLVED');
  if(credential.network_call_performed!==false||credential.write_performed!==false||credential.production_used!==false)return blocked('CREDENTIAL_STATE_INVALID');
  if(admitted.repository!=='instutodp-cpu/agente-grupo-erick'||admitted.base!=='main'||admitted.draft!==true||typeof admitted.head!=='string')return blocked('WRITE_SCOPE_INVALID');
  const request=Object.freeze({method:'POST',url:'/repos/instutodp-cpu/agente-grupo-erick/pulls',body:Object.freeze({head:admitted.head,base:'main',draft:true})});
  const result=await transport(request,credential.authorization);
  return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_CREATE_PULL_REQUEST_EXECUTED',execution_valid:true,request,response:result,network_call_performed:true,write_performed:true,production_used:false,credential_reference:credential.credential_reference});
 }});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerGithubCreatePullRequestExecutionBoundary};
