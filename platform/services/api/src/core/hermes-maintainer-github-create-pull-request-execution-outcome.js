'use strict';
const crypto=require('node:crypto');
const CONTRACT_VERSION='hermes_maintainer_github_create_pull_request_execution_outcome_v1';
const EXECUTION_VERSION='hermes_maintainer_github_create_pull_request_durable_execution_boundary_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick',BASE='main';
const ne=v=>typeof v==='string'&&!!v.trim();
function captureHermesMaintainerGithubCreatePullRequestExecutionOutcome(execution,context={}){
 const blockers=[];
 if(!execution||execution.contract_version!==EXECUTION_VERSION||execution.status!=='GITHUB_CREATE_PULL_REQUEST_DURABLE_EXECUTION_SUCCEEDED'||execution.execution_performed!==true||execution.network_call_performed!==true||execution.write_performed!==true||execution.production_used!==false||execution.provider_status!==201)blockers.push('EXECUTION_NOT_CONFIRMED');
 if(!Number.isInteger(execution?.pull_request_number)||execution.pull_request_number<1||typeof execution?.pull_request_url!=='string'||execution.pull_request_url!==`https://github.com/${REPOSITORY}/pull/${execution?.pull_request_number}`)blockers.push('PULL_REQUEST_IDENTITY_INVALID');
 if(context.repository!==REPOSITORY||context.base!==BASE||typeof context.head!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(context.head)||context.head.includes('..')||context.draft!==true)blockers.push('WRITE_SCOPE_INVALID');
 if(!/^sha256:[a-f0-9]{64}$/.test(context.intent_digest||'')||!ne(context.attempt_reference)||!ne(context.admission_reference))blockers.push('PROVENANCE_INVALID');
 if(blockers.length)return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_CREATE_PULL_REQUEST_EXECUTION_OUTCOME_BLOCKED',outcome_valid:false,outcome_digest:null,repository:REPOSITORY,operation:'create_pull_request',base:null,head:null,draft:null,pull_request_number:null,pull_request_url:null,provider_status:null,blockers:Object.freeze([...new Set(blockers)].sort())});
 const canonical=JSON.stringify({intent_digest:context.intent_digest,attempt_reference:context.attempt_reference,admission_reference:context.admission_reference,repository:REPOSITORY,operation:'create_pull_request',base:BASE,head:context.head,draft:true,pull_request_number:execution.pull_request_number,pull_request_url:execution.pull_request_url,provider_status:201});
 const outcome_digest='sha256:'+crypto.createHash('sha256').update(canonical).digest('hex');
 return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_CREATE_PULL_REQUEST_EXECUTION_OUTCOME_CAPTURED',outcome_valid:true,outcome_digest,outcome_key:outcome_digest+'::execution-outcome',intent_digest:context.intent_digest,attempt_reference:context.attempt_reference,admission_reference:context.admission_reference,repository:REPOSITORY,operation:'create_pull_request',base:BASE,head:context.head,draft:true,pull_request_number:execution.pull_request_number,pull_request_url:execution.pull_request_url,provider_status:201,production_used:false,blockers:Object.freeze([])});
}
module.exports={CONTRACT_VERSION,captureHermesMaintainerGithubCreatePullRequestExecutionOutcome};
