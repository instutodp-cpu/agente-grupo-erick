'use strict';
const CONTRACT_VERSION='hermes_maintainer_github_create_pull_request_durable_execution_boundary_v1';
const ADMISSION_VERSION='hermes_maintainer_github_create_pull_request_durable_admission_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick',BASE='main';
const URL='https://api.github.com/repos/'+REPOSITORY+'/pulls';
function createHermesMaintainerGithubCreatePullRequestDurableExecutionBoundary({executeCreatePullRequest}={}){
 if(typeof executeCreatePullRequest!=='function')throw new TypeError('executeCreatePullRequest_required');
 return Object.freeze({execute:async(a)=>{
  const blockers=[];
  if(!a||a.contract_version!==ADMISSION_VERSION||a.status!=='GITHUB_CREATE_PULL_REQUEST_DURABLE_REQUEST_ADMITTED'||a.admission_valid!==true||a.execution_authorized!==true||a.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT')blockers.push('DURABLE_WRITE_ADMISSION_INVALID');
  if(a?.provider!=='GITHUB'||a?.operation!=='create_pull_request'||a?.repository!==REPOSITORY||a?.base!==BASE||typeof a?.head!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(a.head)||a.head.includes('..')||a?.draft!==true)blockers.push('WRITE_SCOPE_INVALID');
  if(typeof a?.ownership_key!=='string'||a.ownership_key!==a?.persistence_key+'::attempt-ownership')blockers.push('DURABLE_OWNERSHIP_INVALID');
  const r=a?.request;const providerRequestValid=!!r&&r.method==='POST'&&r.url===URL&&r.body?.base===BASE&&r.body?.head===a?.head&&r.body?.draft===true;
  if(!providerRequestValid)blockers.push('PROVIDER_REQUEST_INVALID');
  if(a?.credential_material_present!==false||a?.network_call_performed!==false||a?.write_performed!==false||a?.production_used!==false)blockers.push('PREEXECUTION_STATE_INVALID');
  if(blockers.length)return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_CREATE_PULL_REQUEST_DURABLE_EXECUTION_BLOCKED',execution_performed:false,network_call_performed:false,write_performed:false,production_used:false,provider_status:null,pull_request_number:null,pull_request_url:null,blockers:Object.freeze([...new Set(blockers)].sort())});
  try{
   const result=await executeCreatePullRequest(Object.freeze({...r,ownership_source:a.ownership_source,ownership_key:a.ownership_key,persistence_key:a.persistence_key,intent_digest:a.intent_digest,attempt_reference:a.attempt_reference,capability_reference:a.capability_reference,admission_reference:a.admission_reference}));
   const identityValid=Number.isInteger(result?.pull_request_number)&&result.pull_request_number>0&&typeof result?.pull_request_url==='string'&&new RegExp('^https://github\\.com/instutodp-cpu/agente-grupo-erick/pull/'+result.pull_request_number+'$').test(result.pull_request_url);
   const ok=result?.status==='CREATED'&&result?.created===true&&result?.provider_status===201&&result?.network_call_performed===true&&identityValid;
   return Object.freeze({contract_version:CONTRACT_VERSION,status:ok?'GITHUB_CREATE_PULL_REQUEST_DURABLE_EXECUTION_SUCCEEDED':'GITHUB_CREATE_PULL_REQUEST_DURABLE_EXECUTION_FAILED',execution_performed:true,network_call_performed:result?.network_call_performed===true,write_performed:ok,production_used:false,provider_status:Number.isInteger(result?.provider_status)?result.provider_status:null,pull_request_number:ok?result.pull_request_number:null,pull_request_url:ok?result.pull_request_url:null,blockers:Object.freeze(ok?[]:[identityValid?'CREATE_PULL_REQUEST_NOT_CONFIRMED':'CREATE_PULL_REQUEST_RESULT_IDENTITY_INVALID'])});
  }catch{return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_CREATE_PULL_REQUEST_DURABLE_EXECUTION_FAILED',execution_performed:true,network_call_performed:false,write_performed:false,production_used:false,provider_status:null,pull_request_number:null,pull_request_url:null,blockers:Object.freeze(['EXECUTOR_FAILED'])});}
 }});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerGithubCreatePullRequestDurableExecutionBoundary};
