'use strict';
const CONTRACT_VERSION='hermes_maintainer_github_update_file_transport_v1';
const PROVIDER='GITHUB',METHOD='PUT',REPOSITORY='instutodp-cpu/agente-grupo-erick';
const AUTHORIZATION_REFERENCE='github_update_file_hermes_branch_staging';
const DEFAULT_TIMEOUT_MS=5000,MAX_TIMEOUT_MS=30000;
function validRequest(r){
 if(!r||Object.keys(r).sort().join(',')!==['admission_reference','attempt_reference','body','capability_reference','intent_digest','method','url'].sort().join(','))return false;
 if(r.method!==METHOD||typeof r.url!=='string')return false;
 const rawUrl=r.url.toLowerCase();if(rawUrl.includes('/../')||rawUrl.includes('%2e')||rawUrl.includes('%2f')||rawUrl.includes('%5c'))return false;
 let parsed;try{parsed=new URL(r.url);}catch{return false;}
 const prefix=`/repos/${REPOSITORY}/contents/`;if(parsed.protocol!=='https:'||parsed.hostname!=='api.github.com'||parsed.port||parsed.username||parsed.password||parsed.search||parsed.hash||!parsed.pathname.startsWith(prefix))return false;
 const encodedPath=parsed.pathname.slice(prefix.length);if(!encodedPath)return false;
 let decodedPath;try{decodedPath=decodeURIComponent(encodedPath);}catch{return false;}
 if(decodedPath.length>240||decodedPath.startsWith('/')||decodedPath.includes('\\\\')||decodedPath.split('/').some(part=>part===''||part==='.'||part==='..'||part.includes('..')))return false;
 if(!r.body||Object.keys(r.body).sort().join(',')!==['branch','content','message','sha'].sort().join(','))return false;
 if(typeof r.body.branch!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(r.body.branch)||r.body.branch.includes('..'))return false;
 if(typeof r.body.content!=='string'||!r.body.content.length||typeof r.body.message!=='string'||!r.body.message.trim()||r.body.message.length>160||!/^[a-f0-9]{40}$/.test(r.body.sha))return false;
 if(!/^sha256:[a-f0-9]{64}$/.test(r.intent_digest))return false;
 return ['attempt_reference','capability_reference','admission_reference'].every(k=>typeof r[k]==='string'&&r[k].trim());
}
function safe(fields={}){return Object.freeze({contract_version:CONTRACT_VERSION,provider:PROVIDER,method:METHOD,updated:false,status:'BLOCKED',reason:null,provider_status:null,authorization_header_present:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,response_body_present:false,...fields});}
function createHermesMaintainerGithubUpdateFileTransport({fetchImpl,resolveAuthorization,createTimeoutSignal,timeoutMs=DEFAULT_TIMEOUT_MS}={}){
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');if(typeof resolveAuthorization!=='function')throw new TypeError('resolveAuthorization_required');if(typeof createTimeoutSignal!=='function')throw new TypeError('createTimeoutSignal_required');if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>MAX_TIMEOUT_MS)throw new TypeError('timeoutMs_invalid');
 return Object.freeze({contract_version:CONTRACT_VERSION,provider:PROVIDER,method:METHOD,authorization_reference:AUTHORIZATION_REFERENCE,async updateFile(request){
  if(!validRequest(request))return safe({reason:'REQUEST_INVALID'});
  let resolution;try{resolution=await resolveAuthorization(AUTHORIZATION_REFERENCE);}catch{return safe({reason:'AUTHORIZATION_UNAVAILABLE'});}
  const authorization=resolution?.ok===true&&typeof resolution.authorization==='string'&&resolution.authorization.trim()?resolution.authorization:null;if(!authorization)return safe({reason:'AUTHORIZATION_UNAVAILABLE'});
  let signal;try{signal=createTimeoutSignal(timeoutMs);}catch{return safe({reason:'TIMEOUT_SIGNAL_UNAVAILABLE'});}if(!signal||typeof signal.aborted!=='boolean')return safe({reason:'TIMEOUT_SIGNAL_UNAVAILABLE'});
  let response;try{response=await fetchImpl(request.url,{method:METHOD,redirect:'error',headers:{Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28',Authorization:authorization},body:JSON.stringify(request.body),signal});}catch{return safe({status:'FAILED',reason:'PROVIDER_REQUEST_FAILED',network_call_performed:true,authorization_header_present:true});}
  const provider_status=Number.isInteger(response?.status)?response.status:null;if(provider_status!==200)return safe({status:'FAILED',reason:'UPDATE_FILE_NOT_CONFIRMED',provider_status,authorization_header_present:true,network_call_performed:true});
  let payload;try{payload=await response.json();}catch{return safe({status:'FAILED',reason:'PROVIDER_RESPONSE_INVALID',provider_status,authorization_header_present:true,network_call_performed:true});}
  const new_blob_sha=typeof payload?.content?.sha==='string'&&/^[a-f0-9]{40}$/.test(payload.content.sha)?payload.content.sha:null;
  const commit_sha=typeof payload?.commit?.sha==='string'&&/^[a-f0-9]{40}$/.test(payload.commit.sha)?payload.commit.sha:null;
  if(!new_blob_sha||!commit_sha)return safe({status:'FAILED',reason:'PROVIDER_RESULT_IDENTITY_INVALID',provider_status,authorization_header_present:true,network_call_performed:true,response_body_present:true});
  return safe({status:'UPDATED',updated:true,reason:null,provider_status,new_blob_sha,commit_sha,authorization_header_present:true,network_call_performed:true,response_body_present:true});
 }});
}
module.exports={AUTHORIZATION_REFERENCE,CONTRACT_VERSION,DEFAULT_TIMEOUT_MS,MAX_TIMEOUT_MS,METHOD,PROVIDER,REPOSITORY,createHermesMaintainerGithubUpdateFileTransport};
