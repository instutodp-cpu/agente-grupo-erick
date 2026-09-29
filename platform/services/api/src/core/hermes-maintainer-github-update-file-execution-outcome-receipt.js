'use strict';
const {computeCanonicalContentDigest}=require('./canonical-content-digest');
const CONTRACT_VERSION='hermes_maintainer_github_update_file_execution_outcome_receipt_v1';
const ADMISSION_VERSION='hermes_maintainer_github_update_file_durable_admission_v1';
const EXECUTION_VERSION='hermes_maintainer_github_update_file_durable_execution_boundary_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
function buildHermesMaintainerGithubUpdateFileExecutionOutcomeReceipt(admission,execution){
 const blockers=[];
 if(!admission||admission.contract_version!==ADMISSION_VERSION||admission.status!=='GITHUB_UPDATE_FILE_DURABLE_REQUEST_ADMITTED'||admission.admission_valid!==true||admission.execution_authorized!==true)blockers.push('ADMISSION_INVALID');
 if(admission?.provider!=='GITHUB'||admission?.operation!=='update_file'||admission?.repository!==REPOSITORY||admission?.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT')blockers.push('ADMISSION_SCOPE_INVALID');
 for(const key of ['intent_digest','attempt_reference','capability_reference','admission_reference','persistence_key','ownership_key'])if(typeof admission?.[key]!=='string'||!admission[key].trim())blockers.push('ADMISSION_IDENTITY_INVALID');
 if(!/^sha256:[a-f0-9]{64}$/.test(admission?.intent_digest||''))blockers.push('INTENT_DIGEST_INVALID');
 const body=admission?.request?.body;let path=null;
 const rawUrl=typeof admission?.request?.url==='string'?admission.request.url:'';const unsafeRaw=rawUrl.toLowerCase();
 if(unsafeRaw.includes('/../')||unsafeRaw.includes('%2e')||unsafeRaw.includes('%2f')||unsafeRaw.includes('%5c'))blockers.push('PATH_INVALID');
 try{const u=new URL(rawUrl);const prefix='/repos/'+REPOSITORY+'/contents/';if(u.protocol==='https:'&&u.hostname==='api.github.com'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname.startsWith(prefix))path=decodeURIComponent(u.pathname.slice(prefix.length));}catch{}
 if(!path||path.length>240||path.startsWith('/')||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'||p.includes('..')))blockers.push('PATH_INVALID');
 if(typeof body?.branch!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(body.branch)||body.branch.includes('..'))blockers.push('BRANCH_INVALID');
 if(typeof body?.sha!=='string'||!/^[a-f0-9]{40}$/.test(body.sha))blockers.push('PREVIOUS_BLOB_SHA_INVALID');
 if(!execution||execution.contract_version!==EXECUTION_VERSION||execution.status!=='GITHUB_UPDATE_FILE_DURABLE_EXECUTION_SUCCEEDED'||execution.execution_performed!==true||execution.network_call_performed!==true||execution.write_performed!==true||execution.production_used!==false||execution.provider_status!==200||!Array.isArray(execution.blockers)||execution.blockers.length)blockers.push('EXECUTION_NOT_CONFIRMED');
 const valid=blockers.length===0;
 const material=valid?{intent_digest:admission.intent_digest,attempt_reference:admission.attempt_reference,capability_reference:admission.capability_reference,admission_reference:admission.admission_reference,persistence_key:admission.persistence_key,ownership_key:admission.ownership_key,repository:REPOSITORY,operation:'update_file',branch:body.branch,path,previous_blob_sha:body.sha,provider_status:200}:null;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'GITHUB_UPDATE_FILE_EXECUTION_OUTCOME_RECEIPT_PREPARED':'GITHUB_UPDATE_FILE_EXECUTION_OUTCOME_RECEIPT_BLOCKED',receipt_valid:valid,outcome_digest:valid?computeCanonicalContentDigest(material):null,...(material||{}),execution_performed:valid,network_call_performed:valid,write_performed:valid,production_used:false,durable:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
module.exports={CONTRACT_VERSION,buildHermesMaintainerGithubUpdateFileExecutionOutcomeReceipt};
