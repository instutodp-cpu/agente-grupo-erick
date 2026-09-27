'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_durable_write_execution_boundary_v1';
const ADMISSION_VERSION='hermes_maintainer_github_durable_write_admission_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const URL='https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/git/refs';

function createHermesMaintainerGithubDurableWriteExecutionBoundary({executeCreateBranch}={}){
 if(typeof executeCreateBranch!=='function')throw new TypeError('executeCreateBranch_required');
 return Object.freeze({execute:async(admission)=>{
  const blockers=[];
  if(!admission||admission.contract_version!==ADMISSION_VERSION||admission.status!=='GITHUB_DURABLE_WRITE_REQUEST_ADMITTED'||admission.admission_valid!==true||admission.execution_authorized!==true||admission.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT')blockers.push('DURABLE_WRITE_ADMISSION_INVALID');
  if(typeof admission?.ownership_key!=='string'||admission.ownership_key!==admission?.persistence_key+'::attempt-ownership')blockers.push('DURABLE_OWNERSHIP_INVALID');
  if(admission?.provider!=='GITHUB'||admission?.operation!=='create_branch'||admission?.repository!==REPOSITORY)blockers.push('WRITE_SCOPE_INVALID');
  if(!admission?.request||admission.request.method!=='POST'||admission.request.url!==URL)blockers.push('PROVIDER_REQUEST_INVALID');
  if(typeof admission?.request?.body?.ref!=='string'||!/^refs\/heads\/hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(admission.request.body.ref)||admission.request.body.ref.includes('..'))blockers.push('BRANCH_REF_INVALID');
  if(typeof admission?.request?.body?.sha!=='string'||!/^[a-f0-9]{40}$/.test(admission.request.body.sha))blockers.push('BASE_SHA_INVALID');
  if(admission?.credential_material_present!==false||admission?.network_call_performed!==false||admission?.write_performed!==false||admission?.production_used!==false)blockers.push('PREEXECUTION_STATE_INVALID');
  if(blockers.length)return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_DURABLE_WRITE_EXECUTION_BLOCKED',execution_performed:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
  try{
   const result=await executeCreateBranch(Object.freeze({method:'POST',url:URL,body:Object.freeze({ref:admission.request.body.ref,sha:admission.request.body.sha}),ownership_source:admission.ownership_source,ownership_key:admission.ownership_key,persistence_key:admission.persistence_key,intent_digest:admission.intent_digest,attempt_reference:admission.attempt_reference,capability_reference:admission.capability_reference,admission_reference:admission.admission_reference}));
   const succeeded=result?.status==='CREATED'&&result?.created===true;
   return Object.freeze({contract_version:CONTRACT_VERSION,status:succeeded?'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED':'GITHUB_DURABLE_WRITE_EXECUTION_FAILED',execution_performed:true,network_call_performed:result?.network_call_performed===true,write_performed:succeeded,production_used:false,provider_status:Number.isInteger(result?.provider_status)?result.provider_status:null,blockers:Object.freeze(succeeded?[]:['CREATE_BRANCH_NOT_CONFIRMED'])});
  }catch{return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_DURABLE_WRITE_EXECUTION_FAILED',execution_performed:true,network_call_performed:false,write_performed:false,production_used:false,provider_status:null,blockers:Object.freeze(['EXECUTOR_FAILED'])});}
 }});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerGithubDurableWriteExecutionBoundary};
