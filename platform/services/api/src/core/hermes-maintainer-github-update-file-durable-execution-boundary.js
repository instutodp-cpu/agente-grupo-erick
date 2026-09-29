'use strict';
const CONTRACT_VERSION='hermes_maintainer_github_update_file_durable_execution_boundary_v1';
const ADMISSION_VERSION='hermes_maintainer_github_update_file_durable_admission_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
function createHermesMaintainerGithubUpdateFileDurableExecutionBoundary({executeUpdateFile}={}){
 if(typeof executeUpdateFile!=='function')throw new TypeError('executeUpdateFile_required');
 return Object.freeze({execute:async(a)=>{
  const blockers=[];
  if(!a||a.contract_version!==ADMISSION_VERSION||a.status!=='GITHUB_UPDATE_FILE_DURABLE_REQUEST_ADMITTED'||a.admission_valid!==true||a.execution_authorized!==true||a.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT')blockers.push('DURABLE_WRITE_ADMISSION_INVALID');
  if(a?.provider!=='GITHUB'||a?.operation!=='update_file'||a?.repository!==REPOSITORY)blockers.push('WRITE_SCOPE_INVALID');
  if(typeof a?.ownership_key!=='string'||a.ownership_key!==a?.persistence_key+'::attempt-ownership')blockers.push('DURABLE_OWNERSHIP_INVALID');
  let providerRequestValid=!!a?.request&&a.request.method==='PUT'&&typeof a.request.url==='string';
  if(providerRequestValid){
   const raw=a.request.url.toLowerCase();if(raw.includes('/../')||raw.includes('%2e')||raw.includes('%2f')||raw.includes('%5c'))providerRequestValid=false;
   let parsed=null;try{parsed=new URL(a.request.url);}catch{providerRequestValid=false;}
   const prefix='/repos/'+REPOSITORY+'/contents/';
   if(providerRequestValid&&(parsed.protocol!=='https:'||parsed.hostname!=='api.github.com'||parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||!parsed.pathname.startsWith(prefix)||parsed.pathname===prefix))providerRequestValid=false;
  }
  if(!providerRequestValid)blockers.push('PROVIDER_REQUEST_INVALID');
  if(a?.credential_material_present!==false||a?.network_call_performed!==false||a?.write_performed!==false||a?.production_used!==false)blockers.push('PREEXECUTION_STATE_INVALID');
  if(blockers.length)return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_UPDATE_FILE_DURABLE_EXECUTION_BLOCKED',execution_performed:false,network_call_performed:false,write_performed:false,production_used:false,provider_status:null,blockers:Object.freeze([...new Set(blockers)].sort())});
  try{const result=await executeUpdateFile(Object.freeze({...a.request,ownership_source:a.ownership_source,ownership_key:a.ownership_key,persistence_key:a.persistence_key,intent_digest:a.intent_digest,attempt_reference:a.attempt_reference,capability_reference:a.capability_reference,admission_reference:a.admission_reference}));const ok=result?.status==='UPDATED'&&result?.updated===true&&result?.provider_status===200;return Object.freeze({contract_version:CONTRACT_VERSION,status:ok?'GITHUB_UPDATE_FILE_DURABLE_EXECUTION_SUCCEEDED':'GITHUB_UPDATE_FILE_DURABLE_EXECUTION_FAILED',execution_performed:true,network_call_performed:result?.network_call_performed===true,write_performed:ok,production_used:false,provider_status:Number.isInteger(result?.provider_status)?result.provider_status:null,blockers:Object.freeze(ok?[]:['UPDATE_FILE_NOT_CONFIRMED'])});}catch{return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_UPDATE_FILE_DURABLE_EXECUTION_FAILED',execution_performed:true,network_call_performed:false,write_performed:false,production_used:false,provider_status:null,blockers:Object.freeze(['EXECUTOR_FAILED'])});}
 }});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerGithubUpdateFileDurableExecutionBoundary};
