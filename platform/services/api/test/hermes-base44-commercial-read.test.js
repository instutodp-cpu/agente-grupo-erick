'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,generateKeyPairSync,verify}=require('node:crypto');
const {createServer}=require('../src/index');
const {createMachineIdentityRegistry}=require('../src/core/machine-identity-registry');
const {createHermesGithubLiveReadPilot}=require('../src/runtime/hermes-github-live-read-pilot');
const {
 readBase44CommercialSummary,endpointAllowed,EXACT_PATH
}=require('../src/runtime/hermes-base44-commercial-read');
const ORIGIN='https://compras-evolucao-copy-5ccf8577.base44.app';
const URL=ORIGIN+EXACT_PATH;
const MACHINE='machineReaderFixtureCredentials';
function commercial(){
 return {ok:true,readonly:true,source:'Compras homologacao',
  company:'Grupo Erick',source_state:'homologacao',erp_linx_conciliated:false,
  as_of:'2026-10-21',purchase_period_start:'2026-09-21',
  active_stores:6,purchases_last_30_days:{count:25,net_brl:385410.97},
  open_titles:{count:942,balance_brl:2657483.43},
  overdue_titles:{count:471,balance_brl:1198243.1},
  next_30_days_titles:{count:88,balance_brl:189280.82},
  ignored_pii:{supplier:'SHOULD_NEVER_APPEAR',cnpj:'123'},
 };
}
function protectedKey(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-base44-signing-'));
 const file=path.join(dir,'ed25519-private.pem');
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 fs.writeFileSync(file,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 return {file,publicKey,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
function env(file,enabled='true'){
 return {HERMES_BASE44_COMMERCIAL_READ_ENABLED:enabled,
  HERMES_BASE44_COMMERCIAL_SIGNING_KEY_FILE:file,
  HERMES_BASE44_COMMERCIAL_FUNCTION_URL:URL,
  HERMES_GITHUB_READ_PILOT_ENABLED:'true',
  HERMES_DEPLOYMENT_STAGE:'staging',HERMES_EXECUTION_ENABLED:'false',
  HERMES_EXECUTION_KILL_SWITCH:'true',
  HERMES_MISSION_INGRESS_ENABLED:'false'};
}
const resp=body=>new Response(JSON.stringify(body),{status:200});
test('origin lock rejects platform, external domains, redirects and URL injection',()=>{
 for(const url of [
  'https://app.base44.com'+EXACT_PATH,
  'https://evil.com'+EXACT_PATH,'http://x.base44.app'+EXACT_PATH,
  'https://x.base44.app.evil.com'+EXACT_PATH,
  'https://x.base44.app'+EXACT_PATH+'?q=1',
  'https://x.base44.app'+EXACT_PATH,
  'https://x.base44.app'+EXACT_PATH+'/',
  'https://x.base44.app'+EXACT_PATH+'%2Fmalicious',
  'https://x.base44.app:8443'+EXACT_PATH,
  'https://admin@x.base44.app'+EXACT_PATH,
  'https://x.base44.app/api/apps/not-our-app/functions/getHermesCommercialSummary'
 ])assert.equal(endpointAllowed(url),false,url);
 assert.equal(endpointAllowed(URL),true);
});
test('fixed authenticated POST returns only sanitized aggregates',async()=>{
 const tok=protectedKey(),calls=[];
 try{
 const result=await readBase44CommercialSummary({
  environment:env(tok.file),
  fetchImpl:async(url,opt)=>{
   calls.push({url,method:opt.method,body:opt.body,redirect:opt.redirect,
    headers:opt.headers});
   return resp(commercial());
  }
 });
 assert.equal(result.active_stores,6);
 assert.equal(result.open_titles.balance_brl,2657483.43);
 assert.equal(result.erp_linx_conciliated,false);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,URL);
 assert.equal(calls[0].method,'POST');
 assert.equal(calls[0].body,'{}');
 assert.equal(calls[0].redirect,'error');
 assert.equal(calls[0].headers.Authorization,undefined);
 const headers=calls[0].headers;
 assert.match(headers['X-Hermes-Read-Nonce'],/^[a-f0-9]{32}$/);
 assert.match(headers['X-Hermes-Read-Timestamp'],/^\d{10}$/);
 assert.match(headers['X-Hermes-Read-Signature'],/^[A-Za-z0-9_-]{86}$/);
 const signed=['hermes-compras-aggregate-v1','POST',EXACT_PATH,
   '69c495eb174a34cc5ccf8577',
   headers['X-Hermes-Read-Timestamp'],
   headers['X-Hermes-Read-Nonce'],'{}'].join('\n');
 assert.equal(verify(null,Buffer.from(signed),tok.publicKey,
   Buffer.from(headers['X-Hermes-Read-Signature'],'base64url')),true);
 assert.doesNotMatch(JSON.stringify(result),/123|SHOULD_NEVER_APPEAR|cnpj|ignored_pii/);
 }finally{tok.close();}
});
test('disabled, malformed credentials, upstream 401 and foreign scope fail closed',async()=>{
 const tok=protectedKey();
 try{
 let called=0;
 const fetchImpl=async()=>{called++;return resp(commercial());};
 await assert.rejects(readBase44CommercialSummary({
  environment:env(tok.file,'false'),fetchImpl}),/disabled/);
 assert.equal(called,0);
 fs.chmodSync(tok.file,0o644);
 await assert.rejects(readBase44CommercialSummary({
  environment:env(tok.file),fetchImpl}),/signing_key_file_invalid/);
 assert.equal(called,0);
 fs.chmodSync(tok.file,0o600);
 await assert.rejects(readBase44CommercialSummary({
  environment:env(tok.file),fetchImpl:async()=>new Response('{}',{status:401})
 }),/upstream/);
 const foreign=commercial();
 foreign.company='Empresa QA';
 await assert.rejects(readBase44CommercialSummary({
  environment:env(tok.file),fetchImpl:async()=>resp(foreign)
 }),/contract_invalid/);
 const wrap=commercial();
 wrap.erp_linx_conciliated=true;
 await assert.rejects(readBase44CommercialSummary({
  environment:env(tok.file),fetchImpl:async()=>resp(wrap)
 }),/contract_invalid/);
 }finally{tok.close();}
});
test('one scoped authenticated HTTPS ingress shares quota and durable safe audit',async()=>{
 const tok=protectedKey(),audit=[],provider=[];
 const environment=env(tok.file);
 const pilot=createHermesGithubLiveReadPilot({
  environment,maxRequests:1,
  appendAudit:async row=>audit.push(row),
  readUsage:async()=>audit.filter(r=>r.event==='attempt').length,
  fetchImpl:async(url,opt)=>{provider.push({url,body:opt.body});return resp(commercial());}
 });
 const registry=createMachineIdentityRegistry({entries:[{
  key_id:'pilot-machine',principal_id:'pilot-reader',tenant_id:'grupo_erick',
  key_digest:createHash('sha256').update(MACHINE).digest('hex'),active:true
 }]});
 const server=createServer({githubReadPilot:pilot,machineIdentityRegistry:registry});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const url=base+'/internal/commercial-read-pilot/summary';
 try{
 assert.equal((await fetch(url)).status,401);
 assert.equal((await fetch(url+'?company=qa',{headers:{Authorization:'Bearer '+MACHINE}})).status,405);
 assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+MACHINE}})).status,405);
 assert.equal(provider.length,0);
 const ok=await fetch(url,{headers:{Authorization:'Bearer '+MACHINE}});
 assert.equal(ok.status,200);
 const data=await ok.json();
 assert.equal(data.status,'succeeded');
 assert.equal(data.executed,true);assert.equal(data.simulated,false);
 assert.equal(data.source,'Compras homologacao');
 assert.equal(data.write_performed,false);
 assert.equal(data.production_used,false);
 assert.equal(data.erp_linx_conciliated,false);
 assert.equal(provider.length,1);
 assert.deepEqual(audit.map(a=>a.event),['attempt','result']);
 assert.equal(audit[1].provider,'BASE44_COMPRAS');
 assert.equal(audit[1].adapter_outcome,'SUCCEEDED');
 const dumped=JSON.stringify(audit);
 assert.doesNotMatch(dumped,/385410|2657483|SHOULD_NEVER_APPEAR|ignored_pii|cnpj|Authorization|bearer/i);
 assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+MACHINE}})).status,429);
 assert.equal(provider.length,1);
 }finally{await new Promise(resolve=>server.close(resolve));tok.close();}
});
test('commercial gate is off by default and shares staging kill switch',async()=>{
 const tok=protectedKey();
 try{
 let provider=0;
 for(const change of [
  {HERMES_BASE44_COMMERCIAL_READ_ENABLED:'false'},
  {HERMES_DEPLOYMENT_STAGE:'production'},
  {HERMES_EXECUTION_KILL_SWITCH:'false'}
 ]){
  const environment={...env(tok.file),...change};
  const reader=createHermesGithubLiveReadPilot({environment,
   appendAudit:async()=>{},readUsage:async()=>0,
   fetchImpl:async()=>{provider++;return resp(commercial());}});
  const answer=await reader.execute({resource:'commercial',identity:{
   tenant_id:'grupo_erick',key_id:'pilot-machine',
   principal:{type:'machine',id:'pilot-reader'}}});
  assert.equal(answer.executed,false);
 }
 assert.equal(provider,0);
 }finally{tok.close();}
});


test('official work progress is scoped, never a payment or ERP settlement',async()=>{
 const s=commercial();
 s.reconciliation_work={source:'ReconciliationWorkEvent',as_of:s.as_of,
  erp_linx_conciliated:false,payment_recorded:false,
  tracked_titles:8,waiting_documents:2,in_review:3,
  discrepancy_found:1,review_submitted:2};
 const tok=protectedKey();
 try{
  const result=await readBase44CommercialSummary({
   environment:env(tok.file),fetchImpl:async()=>resp(s)
  });
  assert.deepEqual(result.reconciliation_work,s.reconciliation_work);
  assert.equal(result.reconciliation_work.payment_recorded,false);
  for(const bad of [
   {...s.reconciliation_work,payment_recorded:true},
   {...s.reconciliation_work,erp_linx_conciliated:true},
   {...s.reconciliation_work,tracked_titles:2},
   {...s.reconciliation_work,as_of:'2024-01-01'},
   {...s.reconciliation_work,source:'Outro Cliente'},
   {...s.reconciliation_work,waiting_documents:-1}
  ]){
   await assert.rejects(readBase44CommercialSummary({
    environment:env(tok.file),fetchImpl:async()=>resp({
     ...s,reconciliation_work:bad})
   }),/commercial_work_contract_invalid/);
  }
 }finally{tok.close();}
});
test('missing work schema remains unavailable, never fabricated zero progress',async()=>{
 const tok=protectedKey();
 try{
  const s=commercial();
  const data=await readBase44CommercialSummary({
   environment:env(tok.file),fetchImpl:async()=>resp(s)
  });
  assert.equal(Object.hasOwn(data,'reconciliation_work'),false);
 }finally{tok.close();}
});
