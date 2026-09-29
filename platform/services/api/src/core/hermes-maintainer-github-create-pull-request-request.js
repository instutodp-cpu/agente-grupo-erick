'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_create_pull_request_request_v1';
const API_ORIGIN='https://api.github.com';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const BASE='main';

function validHead(head){
 return typeof head==='string'&&/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(head)&&!head.includes('..');
}
function prepareHermesMaintainerGithubCreatePullRequestRequest(input={}){
 const blockers=[];
 if(input.repository!==REPOSITORY)blockers.push('REPOSITORY_INVALID');
 if(input.base!==BASE)blockers.push('BASE_INVALID');
 if(!validHead(input.head))blockers.push('HEAD_INVALID');
 if(input.draft!==true)blockers.push('DRAFT_REQUIRED');
 if(typeof input.title!=='string'||input.title.trim()===''||input.title.length>160)blockers.push('TITLE_INVALID');
 if(input.body!==undefined&&(typeof input.body!=='string'||input.body.length>10000))blockers.push('BODY_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'GITHUB_CREATE_PULL_REQUEST_REQUEST_PREPARED':'GITHUB_CREATE_PULL_REQUEST_REQUEST_BLOCKED',
  request_valid:valid,
  provider:'GITHUB',
  operation:'create_pull_request',
  repository:valid?REPOSITORY:null,
  base:valid?BASE:null,
  head:valid?input.head:null,
  draft:valid?true:null,
  method:valid?'POST':null,
  url:valid?`${API_ORIGIN}/repos/${REPOSITORY}/pulls`:null,
  body:valid?Object.freeze({title:input.title,body:input.body||'',head:input.head,base:BASE,draft:true}):null,
  authorization_header_present:false,credential_material_present:false,execution_authorized:false,
  network_call_performed:false,write_performed:false,production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerGithubCreatePullRequestRequest};
