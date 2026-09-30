'use strict';
const CONTRACT_VERSION='hermes_maintainer_github_create_pull_request_transport_v1';
const PROVIDER='GITHUB',METHOD='POST',REPOSITORY='instutodp-cpu/agente-grupo-erick',BASE='main';
const URL=`https://api.github.com/repos/${REPOSITORY}/pulls`;
const AUTHORIZATION_REFERENCE='github_create_pull_request_hermes_branch_staging';
const DEFAULT_TIMEOUT_MS=5000,MAX_TIMEOUT_MS=30000;
function validRequest(r){
 if(!r||Object.keys(r).sort().join(',')!==['admission_reference','attempt_reference','body','capability_reference','intent_digest','method','url'].sort().join(','))return false;
 if(r.method!==METHOD||r.url!==URL||!r.body||Object.keys(r.body).sort().join(',')!==['base','body','draft','head','title'].sort().join(','))return false;
 if(r.body.base!==BASE||r.body.draft!==true||typeof r.body.head!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(r.body.head)||r.body.head.includes('..'))return false;
 if(typeof r.body.title!=='string'||!r.body.title.trim()||r.body.title.length>160||typeof r.body.body!=='string'||r.body.body.length>10000)return false;
 if(!/^sha256:[a-f0-9]{64}$/.test(r.intent_digest))return false;
 return ['attempt_reference','capability_reference','admission_reference'].every(k=>typeof r[k]==='string'&&r[k].trim());
}
function safe(fields={}){return Object.freeze({contract_version:CONTRACT_VERSION,provider:PROVIDER,method:METHOD,url:URL,created:false,status:'BLOCKED',reason:null,provider_status:null,pull_request_number:null,pull_request_url:null,authorization_header_present:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,response_body_present:false,...fields});}
function createHermesMaintainerGithubCreatePullRequestTransport({fetchImpl,resolveAuthorization,createTimeoutSignal,timeoutMs=DEFAULT_TIMEOUT_MS}={}){
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');if(typeof resolveAuthorization!=='function')throw new TypeError('resolveAuthorization_required');if(typeof createTimeoutSignal!=='function')throw new TypeError('createTimeoutSignal_required');if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>MAX_TIMEOUT_MS)throw new TypeError('timeoutMs_invalid');
 return Object.freeze({contract_version:CONTRACT_VERSION,provider:PROVIDER,method:METHOD,url:URL,authorization_reference:AUTHORIZATION_REFERENCE,async createPullRequest(request){
  if(!validRequest(request))return safe({reason:'REQUEST_INVALID'});
  let resolution;try{resolution=await resolveAuthorization(AUTHORIZATION_REFERENCE);}catch{return safe({reason:'AUTHORIZATION_UNAVAILABLE'});}
  const authorization=resolution?.ok===true&&typeof resolution.authorization==='string'&&resolution.authorization.trim()?resolution.authorization:null;if(!authorization)return safe({reason:'AUTHORIZATION_UNAVAILABLE'});
  let signal;try{signal=createTimeoutSignal(timeoutMs);}catch{return safe({reason:'TIMEOUT_SIGNAL_UNAVAILABLE'});}if(!signal||typeof signal.aborted!=='boolean')return safe({reason:'TIMEOUT_SIGNAL_UNAVAILABLE'});
  let response;try{response=await fetchImpl(URL,{method:METHOD,redirect:'error',headers:{Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28',Authorization:authorization},body:JSON.stringify(request.body),signal});}catch{return safe({status:'FAILED',reason:'PROVIDER_REQUEST_FAILED',network_call_performed:true,authorization_header_present:true});}
  const provider_status=Number.isInteger(response?.status)?response.status:null;if(provider_status!==201)return safe({status:'FAILED',reason:'CREATE_PULL_REQUEST_NOT_CONFIRMED',provider_status,authorization_header_present:true,network_call_performed:true});
  let payload;try{payload=await response.json();}catch{return safe({status:'FAILED',reason:'PROVIDER_RESPONSE_INVALID',provider_status,authorization_header_present:true,network_call_performed:true});}
  const number=Number.isInteger(payload?.number)&&payload.number>0?payload.number:null;const html_url=typeof payload?.html_url==='string'&&/^https:\/\/github\.com\/instutodp-cpu\/agente-grupo-erick\/pull\/[1-9][0-9]*$/.test(payload.html_url)?payload.html_url:null;
  if(!number||!html_url||payload?.draft!==true)return safe({status:'FAILED',reason:'PROVIDER_RESULT_IDENTITY_INVALID',provider_status,authorization_header_present:true,network_call_performed:true,response_body_present:true});
  return safe({status:'CREATED',created:true,provider_status,pull_request_number:number,pull_request_url:html_url,authorization_header_present:true,network_call_performed:true,response_body_present:true});
 }});
}
module.exports={AUTHORIZATION_REFERENCE,CONTRACT_VERSION,DEFAULT_TIMEOUT_MS,MAX_TIMEOUT_MS,METHOD,PROVIDER,REPOSITORY,URL,createHermesMaintainerGithubCreatePullRequestTransport};
