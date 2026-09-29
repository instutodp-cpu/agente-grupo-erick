'use strict';
const CONTRACT_VERSION='hermes_maintainer_github_create_pull_request_capability_v1';
const CAPABILITY='github_create_pull_request_hermes_branch_staging';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const BASE='main';
function grantHermesMaintainerGithubCreatePullRequestCapability(grant,target={}){
 const blockers=[];
 if(!grant||grant.decision!=='GRANTED'||grant.capability!==CAPABILITY)blockers.push('CAPABILITY_GRANT_INVALID');
 if(typeof grant?.capability_reference!=='string'||!grant.capability_reference.trim())blockers.push('CAPABILITY_REFERENCE_INVALID');
 if(typeof grant?.intent_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(grant.intent_digest))blockers.push('INTENT_DIGEST_INVALID');
 if(typeof grant?.attempt_reference!=='string'||!grant.attempt_reference.trim())blockers.push('ATTEMPT_REFERENCE_INVALID');
 if(target.repository!==REPOSITORY)blockers.push('REPOSITORY_INVALID');
 if(target.base!==BASE)blockers.push('BASE_INVALID');
 if(typeof target.head!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(target.head)||target.head.includes('..'))blockers.push('HEAD_INVALID');
 if(target.draft!==true)blockers.push('DRAFT_REQUIRED');
 const valid=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'GITHUB_CREATE_PULL_REQUEST_CAPABILITY_GRANTED':'GITHUB_CREATE_PULL_REQUEST_CAPABILITY_BLOCKED',capability_valid:valid,capability:valid?CAPABILITY:null,capability_reference:valid?grant.capability_reference:null,intent_digest:valid?grant.intent_digest:null,attempt_reference:valid?grant.attempt_reference:null,operation:valid?'create_pull_request':null,repository:valid?REPOSITORY:null,base:valid?BASE:null,head:valid?target.head:null,draft:valid?true:null,credential_material_present:false,credential_scope_bound:valid,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
module.exports={CONTRACT_VERSION,CAPABILITY,grantHermesMaintainerGithubCreatePullRequestCapability};
