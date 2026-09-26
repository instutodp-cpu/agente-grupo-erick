'use strict';

const {buildHermesMaintainerGithubRepositoryReaderRequest}=require('../core/hermes-maintainer-github-repository-reader-contract');
const {invokeHermesMaintainerGithubRepositoryReader}=require('../core/hermes-maintainer-github-repository-reader-adapter');
const {createHermesMaintainerGithubReadRuntime}=require('../core/hermes-maintainer-github-read-runtime');

const COMPOSITION_VERSION='hermes_maintainer_github_e2e_read_composition_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const REF='main';
const PATH='README.md';

async function runHermesMaintainerGithubE2eRead({fetchImpl,resolveAuthorization}={}){
 if(typeof fetchImpl!=='function'||typeof resolveAuthorization!=='function')return evidence('BLOCKED',false,false,0,false,'RUNTIME_UNAVAILABLE');
 const request=buildHermesMaintainerGithubRepositoryReaderRequest({provider:'GITHUB',repository:REPOSITORY,ref:REF,path:PATH,method:'GET',read_only:true});
 const runtime=createHermesMaintainerGithubReadRuntime({
  fetchImpl,
  resolveAuthorization:async()=>{
   const resolution=await resolveAuthorization('github_read_only_staging');
   return resolution?.ok===true?resolution.authorization:null;
  }
 });
 const result=await invokeHermesMaintainerGithubRepositoryReader(request,runtime);
 const content=result?.data?.content;
 const bytes=typeof content==='string'?Buffer.byteLength(content,'utf8'):0;
 return evidence(result?.outcome||'FAILED',result?.network_call_performed===true,result?.execution_performed===true,bytes,bytes>0,result?.blockers?.[0]||null);
}

function evidence(outcome,network,execution,bytes,received,blocker){
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  environment:'staging',provider:'GITHUB',repository:REPOSITORY,ref:REF,path:PATH,
  outcome,read_only:true,network_call_performed:network,execution_performed:execution,
  content_received:received,content_bytes:bytes,credential_material_present:false,
  response_body_present:false,write_performed:false,production_used:false,
  blockers:Object.freeze(blocker?[blocker]:[])
 });
}

module.exports={COMPOSITION_VERSION,runHermesMaintainerGithubE2eRead};
