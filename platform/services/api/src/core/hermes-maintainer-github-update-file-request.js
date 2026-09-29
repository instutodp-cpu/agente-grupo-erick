'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_update_file_request_v1';
const API_ORIGIN='https://api.github.com';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';

function safePath(path){
 return typeof path==='string'&&path.length>0&&path.length<=240&&!path.startsWith('/')&&!path.includes('..')&&!path.includes('\\')&&!path.split('/').some(part=>part===''||part==='.'||part==='..');
}
function prepareHermesMaintainerGithubUpdateFileRequest(input={}){
 const blockers=[];
 if(input.repository!==REPOSITORY)blockers.push('REPOSITORY_INVALID');
 if(typeof input.branch!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(input.branch)||input.branch.includes('..'))blockers.push('BRANCH_INVALID');
 if(!safePath(input.path))blockers.push('PATH_INVALID');
 if(typeof input.current_blob_sha!=='string'||!/^[a-f0-9]{40}$/.test(input.current_blob_sha))blockers.push('CURRENT_BLOB_SHA_INVALID');
 if(typeof input.content!=='string'||input.content.length===0)blockers.push('CONTENT_INVALID');
 if(typeof input.message!=='string'||input.message.trim()===''||input.message.length>160)blockers.push('MESSAGE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'GITHUB_UPDATE_FILE_REQUEST_PREPARED':'GITHUB_UPDATE_FILE_REQUEST_BLOCKED',
  request_valid:valid,
  provider:'GITHUB',
  operation:'update_file',
  repository:valid?REPOSITORY:null,
  branch:valid?input.branch:null,
  path:valid?input.path:null,
  method:valid?'PUT':null,
  url:valid?`${API_ORIGIN}/repos/${REPOSITORY}/contents/${input.path.split('/').map(encodeURIComponent).join('/')}`:null,
  body:valid?Object.freeze({message:input.message,content:Buffer.from(input.content,'utf8').toString('base64'),sha:input.current_blob_sha,branch:input.branch}):null,
  authorization_header_present:false,credential_material_present:false,execution_authorized:false,
  network_call_performed:false,write_performed:false,production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerGithubUpdateFileRequest};
