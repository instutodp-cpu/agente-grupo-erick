'use strict';
// Narrow authenticated live-read pilot. No general-purpose execution, SCM
// mutation, MissionRun dispatch, or production authority.
const fs=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const {buildHermesMaintainerGithubRepositoryReaderRequest}=
 require('../core/hermes-maintainer-github-repository-reader-contract');
const {invokeHermesMaintainerGithubRepositoryReader}=
 require('../core/hermes-maintainer-github-repository-reader-adapter');
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const PATH='README.md',REF='main';
function createHermesGithubLiveReadPilot({
 environment=process.env,fetchImpl=globalThis.fetch,
 appendAudit,clock=()=>Date.now(),maxRequests=1
}={}){
 if(typeof appendAudit!=='function')throw new TypeError('durable_audit_required');
 if(typeof fetchImpl!=='function'||!Number.isInteger(maxRequests)||maxRequests<1||
   maxRequests>3)throw new TypeError('bounded_fetch_required');
 let requests=0;
 const active=()=>environment.HERMES_GITHUB_READ_PILOT_ENABLED==='true'&&
  environment.HERMES_DEPLOYMENT_STAGE==='staging'&&
  environment.HERMES_EXECUTION_ENABLED==='false'&&
  environment.HERMES_EXECUTION_KILL_SWITCH==='true'&&
  environment.HERMES_MISSION_INGRESS_ENABLED==='false';
 const denied=(status)=>Object.freeze({status,executed:false,
  write_performed:false,production_used:false});
 async function execute({identity}={}){
  if(!active())return denied('disabled');
  if(identity?.principal?.type!=='machine'||identity.tenant_id!=='grupo_erick'||
     !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.principal.id||'')||
     !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.key_id||''))
   return denied('identity_invalid');
  if(requests>=maxRequests)return denied('request_budget_exhausted');
  requests+=1; // synchronous, before any await: single-use on this process
  const trace_id=randomUUID(),timestamp=new Date(clock()).toISOString();
  const bound={trace_id,tenant_id:identity.tenant_id,principal_id:identity.principal.id,
   key_id:identity.key_id,operation:'GET',repository:REPOSITORY,
   path:PATH,ref:REF,real_provider_called:false,write_performed:false,
   production_used:false};
  // Fail closed before a network request if the audit ledger is unavailable.
  try{await appendAudit(Object.freeze({...bound,event:'attempt',at:timestamp}));}
  catch{return denied('audit_unavailable');}
  const request=buildHermesMaintainerGithubRepositoryReaderRequest({
   provider:'GITHUB',repository:REPOSITORY,ref:REF,path:PATH,
   method:'GET',read_only:true
  });
  const runtime={readGithubRepositoryPath:async input=>{
   if(input.repository!==REPOSITORY||input.ref!==REF||input.path!==PATH||
      input.method!=='GET'||input.read_only!==true)throw Error('scope_violation');
   const url='https://api.github.com/repos/'+REPOSITORY+'/contents/'+PATH+'?ref='+REF;
   const res=await fetchImpl(url,{method:'GET',redirect:'error',
    headers:{'Accept':'application/vnd.github+json',
     'User-Agent':'Hermes-Authenticated-Github-Read-Pilot'},
    signal:AbortSignal.timeout(8000)});
   if(!res||res.status!==200||!res.ok)throw Error('github_http_failure');
   if(Number(res.headers?.get?.('content-length')||0)>131072)
    throw Error('github_response_too_large');
   // Abort reader as soon as received data exceeds cap, even if no header.
   let size=0,raw='';
   if(!res.body||typeof res.body.getReader!=='function')throw Error('github_body_missing');
   const reader=res.body.getReader();
   for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if(size>131072){await reader.cancel();throw Error('github_response_too_large');}
    raw+=Buffer.from(value).toString('utf8');
   }
   const obj=JSON.parse(raw);
   if(obj.type!=='file'||obj.path!==PATH||obj.encoding!=='base64'||
      typeof obj.content!=='string'||! /^[a-f0-9]{40}$/.test(obj.sha||''))
    throw Error('github_response_invalid');
   const content=Buffer.from(obj.content.replace(/\s/g,''),'base64').toString('utf8');
   if(Buffer.byteLength(content)>65536)throw Error('github_file_too_large');
   return {ok:true,content,sha:obj.sha};
  }};
  const result=await invokeHermesMaintainerGithubRepositoryReader(request,runtime);
  const success=result.outcome==='SUCCEEDED'&&
   result.network_call_performed===true&&result.write_performed===false&&
   result.production_used===false&&result.data?.sha;
  const audit=Object.freeze({...bound,event:'result',at:new Date(clock()).toISOString(),
   adapter_outcome:result.outcome,real_provider_called:result.network_call_performed,
   github_blob_sha:success?result.data.sha:null,
   file_sha256:success?'sha256:'+createHash('sha256').update(result.data.content).digest('hex'):null,
   content_bytes:success?Buffer.byteLength(result.data.content):null});
  try{await appendAudit(audit);}
  catch{return denied('audit_unavailable_after_provider');}
  if(!success)return Object.freeze({...denied('provider_failed'),trace_id});
  return Object.freeze({status:'succeeded',trace_id,executed:true,
   provider:'GITHUB',repository:REPOSITORY,ref:REF,path:PATH,
   github_blob_sha:audit.github_blob_sha,file_sha256:audit.file_sha256,
   content_bytes:audit.content_bytes,network_call_performed:true,
   write_performed:false,production_used:false,simulated:false});
 }
 return Object.freeze({execute,enabled:active});
}
function createDurableJsonLineAudit({filePath}={}){
 if(typeof filePath!=='string'||!filePath.startsWith('/')||
  filePath.includes('..'))throw new TypeError('absolute_audit_path_required');
 return async row=>{
  const payload=Buffer.from(JSON.stringify(row)+'\n');
  const fd=fs.openSync(filePath,fs.constants.O_APPEND|fs.constants.O_WRONLY|
   fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
  try{
   const st=fs.fstatSync(fd);
   if(!st.isFile()||(st.mode&0o777)!==0o600||
      st.size>1024*1024)throw Error('audit_file_not_protected');
   let written=0;
   while(written<payload.length){
    const n=fs.writeSync(fd,payload,written,payload.length-written);
    if(n<=0)throw Error('audit_short_write');
    written+=n;
   }
   fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
 };
}
module.exports={createHermesGithubLiveReadPilot,createDurableJsonLineAudit};
