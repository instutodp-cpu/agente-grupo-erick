'use strict';

const {computeCanonicalContentDigest}=require('./canonical-content-digest');
const CONTRACT_VERSION='hermes_maintainer_github_write_execution_outcome_receipt_v1';
const ADMISSION_VERSION='hermes_maintainer_github_durable_write_admission_v1';
const EXECUTION_VERSION='hermes_maintainer_github_durable_write_execution_boundary_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
function buildHermesMaintainerGithubWriteExecutionOutcomeReceipt(admission,execution){
 const blockers=[];
 if(!admission||admission.contract_version!==ADMISSION_VERSION||admission.status!=='GITHUB_DURABLE_WRITE_REQUEST_ADMITTED'||admission.admission_valid!==true||admission.execution_authorized!==true)blockers.push('ADMISSION_INVALID');
 if(admission?.provider!=='GITHUB'||admission?.operation!=='create_branch'||admission?.repository!==REPOSITORY)blockers.push('ADMISSION_SCOPE_INVALID');
 if(typeof admission?.intent_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(admission.intent_digest))blockers.push('INTENT_DIGEST_INVALID');
 for(const key of ['attempt_reference','capability_reference','admission_reference','persistence_key','ownership_key'])if(typeof admission?.[key]!=='string'||admission[key].trim()==='')blockers.push('ADMISSION_IDENTITY_INVALID');
 if(typeof admission?.request?.body?.ref!=='string'||!/^refs\/heads\/hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(admission.request.body.ref)||admission.request.body.ref.includes('..'))blockers.push('BRANCH_REF_INVALID');
 if(typeof admission?.request?.body?.sha!=='string'||!/^[a-f0-9]{40}$/.test(admission.request.body.sha))blockers.push('BASE_SHA_INVALID');
 if(!execution||execution.contract_version!==EXECUTION_VERSION||execution.status!=='GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED'||execution.execution_performed!==true||execution.network_call_performed!==true||execution.write_performed!==true||execution.production_used!==false||execution.provider_status!==201||!Array.isArray(execution.blockers)||execution.blockers.length!==0)blockers.push('EXECUTION_NOT_CONFIRMED');
 const valid=blockers.length===0;
 const material=valid?{intent_digest:admission.intent_digest,attempt_reference:admission.attempt_reference,capability_reference:admission.capability_reference,admission_reference:admission.admission_reference,persistence_key:admission.persistence_key,ownership_key:admission.ownership_key,repository:admission.repository,operation:admission.operation,ref:admission.request.body.ref,sha:admission.request.body.sha,provider_status:execution.provider_status}:null;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'GITHUB_WRITE_EXECUTION_OUTCOME_RECEIPT_PREPARED':'GITHUB_WRITE_EXECUTION_OUTCOME_RECEIPT_BLOCKED',receipt_valid:valid,outcome_digest:valid?computeCanonicalContentDigest(material):null,...(material||{}),execution_performed:valid,network_call_performed:valid,write_performed:valid,production_used:false,durable:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
module.exports={CONTRACT_VERSION,buildHermesMaintainerGithubWriteExecutionOutcomeReceipt};
