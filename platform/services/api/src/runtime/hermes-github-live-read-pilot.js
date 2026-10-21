'use strict';
// Explicit, machine-authenticated read domain. Reuses the official reader
// adapter; does not grant any generic execution, SCM, or A3 authority.
const fs=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const {TextDecoder}=require('node:util');
const {buildHermesMaintainerGithubRepositoryReaderRequest}=
 require('../core/hermes-maintainer-github-repository-reader-contract');
const {invokeHermesMaintainerGithubRepositoryReader}=
 require('../core/hermes-maintainer-github-repository-reader-adapter');
const {readBcbEconomicIndicator,INDICATORS}=
 require('./hermes-bcb-economic-read');
const {readBase44CommercialSummary}=
 require('./hermes-base44-commercial-read');
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const REF='main',WINDOW_MS=86400000;
const RESOURCES=Object.freeze({
 readme:'README.md',
 readiness:'platform/docs/audits/HERMES_READINESS_MAP.json'
});
function readinessSummary(content){
 const j=JSON.parse(content);
 if(!j||!Array.isArray(j.capabilities)||j.capabilities.length>128)
  throw Error('readiness_schema_invalid');
 return Object.freeze({
  capabilities_total:j.capabilities.length,
  tested_count:j.capabilities.filter(x=>x?.tested===true).length,
  proven_e2e_count:j.capabilities.filter(x=>x?.proven_e2e===true).length,
  operational_count:j.capabilities.filter(x=>x?.operational===true).length
 });
}
function createHermesGithubLiveReadPilot({
 environment=process.env,fetchImpl=globalThis.fetch,
 appendAudit,readUsage,clock=()=>Date.now(),maxRequests=1
}={}){
 if(typeof appendAudit!=='function'||typeof readUsage!=='function')
  throw new TypeError('durable_audit_and_usage_required');
 if(typeof fetchImpl!=='function'||!Number.isInteger(maxRequests)||
    maxRequests<1||maxRequests>20)
  throw new TypeError('bounded_fetch_required');
 let inFlight=false;
 const active=()=>environment.HERMES_GITHUB_READ_PILOT_ENABLED==='true'&&
  environment.HERMES_DEPLOYMENT_STAGE==='staging'&&
  environment.HERMES_EXECUTION_ENABLED==='false'&&
  environment.HERMES_EXECUTION_KILL_SWITCH==='true'&&
  environment.HERMES_MISSION_INGRESS_ENABLED==='false';
 const denied=status=>Object.freeze({status,executed:false,
  network_call_performed:false,write_performed:false,production_used:false});
 async function run({identity,resource='readme'}={}){
  if(!active())return denied('disabled');
  if(identity?.principal?.type!=='machine'||identity.tenant_id!=='grupo_erick'||
     !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.principal.id||'')||
     !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.key_id||''))
   return denied('identity_invalid');
  if(!Object.hasOwn(RESOURCES,resource)&&
     !Object.hasOwn(INDICATORS,resource)&&resource!=='commercial')
   return denied('resource_not_allowed');
  if(resource==='commercial'&&
     environment.HERMES_BASE44_COMMERCIAL_READ_ENABLED!=='true')
   return denied('commercial_disabled');
  const time=clock();
  if(!Number.isSafeInteger(time))return denied('clock_unavailable');
  let attempts;
  try{
   attempts=await readUsage({tenant_id:identity.tenant_id,
    since:new Date(time-WINDOW_MS).toISOString(),now:new Date(time).toISOString()});
  }catch{return denied('quota_store_unavailable');}
  if(!Number.isSafeInteger(attempts)||attempts<0)
   return denied('quota_store_unavailable');
  if(attempts>=maxRequests)return denied('request_budget_exhausted');
  const isEconomy=Object.hasOwn(INDICATORS,resource);
  const isCommercial=resource==='commercial';
  const path=isEconomy||isCommercial?null:RESOURCES[resource],trace_id=randomUUID();
  const bound={trace_id,tenant_id:identity.tenant_id,
   principal_id:identity.principal.id,key_id:identity.key_id,
   operation:isCommercial?'POST': 'GET',
   provider:isCommercial?'BASE44_COMPRAS':isEconomy?'BCB_SGS':'GITHUB',
   repository:isEconomy||isCommercial?null:REPOSITORY,
   path,ref:isEconomy||isCommercial?null:REF,resource,
   real_provider_called:false,write_performed:false,production_used:false};
  // Durable attempt reservation before the external GET; failed requests
  // consume budget. A restart cannot reset it because usage is replayed.
  try{await appendAudit(Object.freeze({...bound,event:'attempt',at:new Date(time).toISOString()}));}
  catch{return denied('audit_unavailable');}
  if(isCommercial){
   let summary=null,providerCalled=false;
   try{
    summary=await readBase44CommercialSummary({
     environment,fetchImpl:async(url,options)=>{
      providerCalled=true;
      return fetchImpl(url,options);
     }
    });
   }catch{/* No provider detail, URL, credential or financial payload in audit. */}
   const success=Boolean(summary);
   const audit=Object.freeze({...bound,event:'result',
    at:new Date(clock()).toISOString(),adapter_outcome:success?'SUCCEEDED':'FAILED',
    real_provider_called:providerCalled,source:'Compras homologacao',
    schema_valid:success});
   try{await appendAudit(audit);}
   catch{return denied('audit_unavailable_after_provider');}
   if(!success)return Object.freeze({...denied('provider_failed'),trace_id});
   return Object.freeze({status:'succeeded',trace_id,executed:true,
    network_call_performed:true,simulated:false,
    write_performed:false,production_used:false,...summary});
  }
  if(isEconomy){
   let indicator=null,providerCalled=false,error=null;
   try{
    indicator=await readBcbEconomicIndicator({
     kind:resource,clock,fetchImpl:async(url,options)=>{
      providerCalled=true;
      return fetchImpl(url,options);
     }
    });
   }catch(e){error='bcb_provider_or_data_invalid';}
   const audit=Object.freeze({...bound,event:'result',
    at:new Date(clock()).toISOString(),adapter_outcome:indicator?'SUCCEEDED':'FAILED',
    real_provider_called:providerCalled,
    series_code:INDICATORS[resource].series,
    observation_date:indicator?.observation_date||null,
    error_code:error});
   try{await appendAudit(audit);}
   catch{return denied('audit_unavailable_after_provider');}
   if(!indicator)return Object.freeze({...denied('provider_failed'),trace_id});
   return Object.freeze({status:'succeeded',trace_id,executed:true,
    network_call_performed:true,...indicator});
  }
  const request=buildHermesMaintainerGithubRepositoryReaderRequest({
   provider:'GITHUB',repository:REPOSITORY,ref:REF,path,method:'GET',read_only:true
  });
  const runtime={readGithubRepositoryPath:async input=>{
   if(input.repository!==REPOSITORY||input.ref!==REF||input.path!==path||
      input.method!=='GET'||input.read_only!==true)throw Error('scope_violation');
   const url='https://api.github.com/repos/'+REPOSITORY+
    '/contents/'+path+'?ref='+REF;
   const res=await fetchImpl(url,{method:'GET',redirect:'error',
    headers:{Accept:'application/vnd.github+json',
     'User-Agent':'Hermes-Authenticated-Github-Read-Pilot'},
    signal:AbortSignal.timeout(8000)});
   if(!res||res.status!==200||!res.ok)throw Error('github_http_failure');
   if(Number(res.headers?.get?.('content-length')||0)>131072)
    throw Error('github_response_too_large');
   let size=0,raw='',decoder=new TextDecoder('utf-8',{fatal:true});
   if(!res.body||typeof res.body.getReader!=='function')throw Error('github_body_missing');
   const reader=res.body.getReader();
   for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if(size>131072){await reader.cancel();throw Error('github_response_too_large');}
    raw+=decoder.decode(value,{stream:true});
   }
   raw+=decoder.decode();
   const obj=JSON.parse(raw);
   if(obj.type!=='file'||obj.path!==path||obj.encoding!=='base64'||
     typeof obj.content!=='string'||!/^[a-f0-9]{40}$/.test(obj.sha||''))
    throw Error('github_response_invalid');
   const content=Buffer.from(obj.content.replace(/\s/g,''),'base64').toString('utf8');
   if(Buffer.byteLength(content)>65536)throw Error('github_file_too_large');
   return {ok:true,content,sha:obj.sha};
  }};
  const result=await invokeHermesMaintainerGithubRepositoryReader(request,runtime);
  let summary=null;
  let success=result.outcome==='SUCCEEDED'&&
   result.network_call_performed===true&&result.write_performed===false&&
   result.production_used===false&&/^[a-f0-9]{40}$/.test(result.data?.sha||'');
  if(success&&resource==='readiness'){
   try{summary=readinessSummary(result.data.content);}
   catch{success=false;}
  }
  const audit=Object.freeze({...bound,event:'result',at:new Date(clock()).toISOString(),
   adapter_outcome:success?'SUCCEEDED':'FAILED',
   real_provider_called:result.network_call_performed,
   github_blob_sha:success?result.data.sha:null,
   file_sha256:success?'sha256:'+createHash('sha256').update(result.data.content).digest('hex'):null,
   content_bytes:success?Buffer.byteLength(result.data.content):null});
  try{await appendAudit(audit);}
  catch{return denied('audit_unavailable_after_provider');}
  if(!success)return Object.freeze({...denied('provider_failed'),trace_id});
  return Object.freeze({status:'succeeded',trace_id,executed:true,
   provider:'GITHUB',repository:REPOSITORY,ref:REF,resource,path,
   github_blob_sha:audit.github_blob_sha,file_sha256:audit.file_sha256,
   content_bytes:audit.content_bytes,
   ...(summary?{readiness:summary}:{}),
   network_call_performed:true,write_performed:false,
   production_used:false,simulated:false});
 }
 async function execute(input){
  if(inFlight)return denied('request_budget_exhausted');
  inFlight=true;
  try{return await run(input);}
  finally{inFlight=false;}
 }
 return Object.freeze({execute,enabled:active});
}
function createDurableJsonLineAudit({filePath}={}){
 if(typeof filePath!=='string'||!filePath.startsWith('/')||
  filePath.includes('..'))throw new TypeError('absolute_audit_path_required');
 const open=(flag)=>fs.openSync(filePath,flag|fs.constants.O_NOFOLLOW,0o600);
 const stat=fd=>{
  const st=fs.fstatSync(fd);
  if(!st.isFile()||(st.mode&0o777)!==0o600||st.size>1024*1024)
   throw Error('audit_file_not_protected');
  return st;
 };
 const append=async row=>{
  const payload=Buffer.from(JSON.stringify(row)+'\n');
  const fd=open(fs.constants.O_APPEND|fs.constants.O_WRONLY|fs.constants.O_CREAT);
  try{
   stat(fd);
   let written=0;
   while(written<payload.length){
    const n=fs.writeSync(fd,payload,written,payload.length-written);
    if(n<=0)throw Error('audit_short_write');
    written+=n;
   }
   fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
 };
 const countAttempts=async({tenant_id,since,now})=>{
  const fd=open(fs.constants.O_RDONLY);
  try{
   const st=stat(fd);
   const data=Buffer.alloc(st.size),bytes=fs.readSync(fd,data,0,st.size,0);
   if(bytes!==st.size)throw Error('audit_read_incomplete');
   const content=data.toString('utf8');
   if(content&&!content.endsWith('\n'))throw Error('audit_truncated');
   const low=Date.parse(since),high=Date.parse(now);
   if(!Number.isFinite(low)||!Number.isFinite(high)||low>high)
    throw Error('invalid_window');
   let count=0;
   for(const line of content.split('\n')){
    if(!line)continue;
    const x=JSON.parse(line),timestamp=Date.parse(x.at);
    if(typeof x.trace_id!=='string'||!Number.isFinite(timestamp))
     throw Error('audit_invalid_record');
    if(x.event==='attempt'&&x.tenant_id===tenant_id&&
       timestamp>=low&&timestamp<=high)count++;
   }
   return count;
  }finally{fs.closeSync(fd);}
 };
 return Object.assign(append,{countAttempts});
}
module.exports={RESOURCES,createHermesGithubLiveReadPilot,createDurableJsonLineAudit};
