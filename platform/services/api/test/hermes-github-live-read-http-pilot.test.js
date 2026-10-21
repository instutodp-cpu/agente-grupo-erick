'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {once}=require('node:events');
const {createServer}=require('../src/index');
const {createMachineIdentityRegistry}=require('../src/core/machine-identity-registry');
const {createHermesGithubLiveReadPilot}=require('../src/runtime/hermes-github-live-read-pilot');
const SAFE='Bearer fixture-live-reader-credential';
const env=()=>({
 HERMES_GITHUB_READ_PILOT_ENABLED:'true',HERMES_DEPLOYMENT_STAGE:'staging',
 HERMES_EXECUTION_ENABLED:'false',HERMES_EXECUTION_KILL_SWITCH:'true',
 HERMES_MISSION_INGRESS_ENABLED:'false'
});
const identity=()=>createMachineIdentityRegistry({entries:[{
 key_id:'github-reader-staging',key_digest:createHash('sha256').update(
  SAFE.slice('Bearer '.length)).digest('hex'),
 principal_id:'pilot-reader',tenant_id:'grupo_erick',active:true
}]});
function makeResponse(){
 return new Response(JSON.stringify({
  type:'file',path:'README.md',sha:'a'.repeat(40),encoding:'base64',
  content:Buffer.from('# Live test\n','utf8').toString('base64')
 }),{status:200,headers:{'Content-Type':'application/json'}});
}
async function fixture({environment=env(),auditFailure=false,invalidNetwork=false,
 maxRequests=1,principalRegistry=identity()}={}){
 const audits=[],network=[];
 const pilot=createHermesGithubLiveReadPilot({environment,maxRequests,
  fetchImpl:async(url,opt)=>{
   network.push({url,method:opt.method,redirect:opt.redirect,headers:opt.headers});
   return invalidNetwork?new Response('no',{status:503}):makeResponse();
  },
  appendAudit:async record=>{if(auditFailure)throw Error('audit offline');audits.push(record);},
  readUsage:async({tenant_id,since,now})=>audits.filter(x=>x.event==='attempt'&&
    x.tenant_id===tenant_id&&x.at>=since&&x.at<=now).length
 });
 const server=createServer({githubReadPilot:pilot,machineIdentityRegistry:principalRegistry});
 await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',e=>e?reject(e):resolve()));
 const addr=server.address(),url='http://127.0.0.1:'+addr.port+'/internal/github-read-pilot';
 return {audits,network,url,server,
  close:()=>new Promise(r=>server.close(r))};
}
test('authenticated Hermes HTTP executes exactly one provider GET and seals sanitized audit',async()=>{
 const f=await fixture();
 try{
  const res=await fetch(f.url,{headers:{Authorization:SAFE}});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('cache-control'),'no-store');
  const body=await res.json();
  assert.equal(body.status,'succeeded');assert.equal(body.executed,true);
  assert.equal(body.write_performed,false);
  assert.equal(body.production_used,false);
  assert.equal(body.simulated,false);
  assert.match(body.file_sha256,/^sha256:[a-f0-9]{64}$/);
  assert.equal(body.github_blob_sha,'a'.repeat(40));
  assert.equal(f.network.length,1);
  assert.equal(f.network[0].method,'GET');
  assert.equal(f.network[0].redirect,'error');
  assert.equal(f.network[0].url,'https://api.github.com/repos/instutodp-cpu/agente-grupo-erick/contents/README.md?ref=main');
  assert.deepEqual(f.audits.map(x=>x.event),['attempt','result']);
  assert.equal(f.audits[1].adapter_outcome,'SUCCEEDED');
  const summary=JSON.stringify([body,...f.audits]);
  assert.doesNotMatch(summary,/fixture-live-reader-credential|# Live test/);
  const repeat=await fetch(f.url,{headers:{Authorization:SAFE}});
  assert.equal(repeat.status,429);assert.equal(f.network.length,1);
 }finally{await f.close();}
});
test('unauthenticated and other method/query requests never reach provider',async()=>{
 const f=await fixture();
 try{
  assert.equal((await fetch(f.url)).status,401);
  assert.equal((await fetch(f.url,{headers:{Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await fetch(f.url,{method:'POST',headers:{Authorization:SAFE}})).status,405);
  assert.equal((await fetch(f.url+'?path=private.txt',{headers:{Authorization:SAFE}})).status,405);
  assert.equal(f.network.length,0);assert.equal(f.audits.length,0);
 }finally{await f.close();}
});
test('flag-off or loosened kill switch always blocks before provider',async()=>{
 for(const change of [
  {HERMES_GITHUB_READ_PILOT_ENABLED:'false'},
  {HERMES_EXECUTION_KILL_SWITCH:'false'},
  {HERMES_EXECUTION_ENABLED:'true'},
  {HERMES_MISSION_INGRESS_ENABLED:'true'},
  {HERMES_DEPLOYMENT_STAGE:'production'}
 ]){
  const f=await fixture({environment:{...env(),...change}});
  try{
   assert.equal((await fetch(f.url,{headers:{Authorization:SAFE}})).status,503);
   assert.equal(f.network.length,0);
  }finally{await f.close();}
 }
});
test('missing independent audit denies network, provider failure is durable failure',async()=>{
 const a=await fixture({auditFailure:true});
 try{
  assert.equal((await fetch(a.url,{headers:{Authorization:SAFE}})).status,503);
  assert.equal(a.network.length,0);
 }finally{await a.close();}
 const b=await fixture({invalidNetwork:true});
 try{
  const response=await fetch(b.url,{headers:{Authorization:SAFE}});
  assert.equal(response.status,503);
  assert.equal(b.network.length,1);
  assert.deepEqual(b.audits.map(x=>x.event),['attempt','result']);
  assert.equal(b.audits[1].adapter_outcome,'FAILED');
 }finally{await b.close();}
});
test('concurrent calls share a strict single use budget',async()=>{
 const f=await fixture();
 try{
  const [a,b]=await Promise.all([
   fetch(f.url,{headers:{Authorization:SAFE}}),
   fetch(f.url,{headers:{Authorization:SAFE}})
  ]);
  assert.deepEqual([a.status,b.status].sort(),[200,429]);
  assert.equal(f.network.length,1);
 }finally{await f.close();}
});
test('different tenant has no provider authority',async()=>{
 const other=createMachineIdentityRegistry({entries:[{
  key_id:'test-other',key_digest:createHash('sha256').update(SAFE.slice(7)).digest('hex'),
  principal_id:'client-service',tenant_id:'other_client',active:true
 }]});
 const f=await fixture({principalRegistry:other});
 try{
  const r=await fetch(f.url,{headers:{Authorization:SAFE}});
  assert.equal(r.status,503);
  assert.equal(f.network.length,0);
 }finally{await f.close();}
});

test('bootstrap rejects unsafe identity files or absent staging flags',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {createHermesGithubLiveReadBootstrap}=
  require('../src/pilots/hermes-github-live-read-bootstrap');
 const dirname=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-reader-test-'));
 const identityPath=path.join(dirname,'registry.json');
 try{
  fs.writeFileSync(identityPath,JSON.stringify({entries:[{
   key_id:'a',key_digest:createHash('sha256').update('test').digest('hex'),
   principal_id:'pilot-reader',tenant_id:'grupo_erick',active:true
  }]}),{mode:0o644});
  const cfg={...env(),HERMES_GITHUB_READ_PILOT_IDENTITY_FILE:identityPath,
   HERMES_GITHUB_READ_PILOT_AUDIT_FILE:path.join(dirname,'audit.jsonl')};
  assert.throws(()=>createHermesGithubLiveReadBootstrap({environment:cfg}),
   /identity_file_not_protected/);
  fs.chmodSync(identityPath,0o600);
  const ok=createHermesGithubLiveReadBootstrap({environment:cfg,
   fetchImpl:async()=>makeResponse()});
  assert.equal(ok.machineIdentityRegistry.size,1);
  assert.equal(ok.githubReadPilot.enabled(),true);
  assert.equal(createHermesGithubLiveReadBootstrap({
   environment:{...cfg,HERMES_GITHUB_READ_PILOT_ENABLED:'false'}
  }).githubReadPilot,null);
 }finally{fs.rmSync(dirname,{force:true,recursive:true});}
});
test('durable append audit uses protected file and refuses relaxed permissions',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {createDurableJsonLineAudit}=
  require('../src/runtime/hermes-github-live-read-pilot');
 const dirname=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-reader-audit-'));
 const file=path.join(dirname,'events.jsonl');
 try{
  const append=createDurableJsonLineAudit({filePath:file});
  await append({event:'attempt',trace_id:'safe'});
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8').trim()).event,'attempt');
  fs.chmodSync(file,0o644);
  await assert.rejects(append({event:'result'}),/audit_file_not_protected/);
 }finally{fs.rmSync(dirname,{force:true,recursive:true});}
});

test('fixed readiness endpoint uses the official GitHub reader and returns only safe operational counts',async()=>{
 const raw=JSON.stringify({capabilities:[{
  id:'development',tested:true,proven_e2e:true,operational:false
 },{id:'other',tested:true,proven_e2e:false,operational:false},
 {id:'done',tested:true,proven_e2e:true,operational:true}]});
 const audits=[],network=[];
 const envs=env();
 const pilot=createHermesGithubLiveReadPilot({
  environment:envs,maxRequests:5,
  appendAudit:async r=>audits.push(r),
  readUsage:async()=>audits.filter(r=>r.event==='attempt').length,
  fetchImpl:async(url,options)=>{
   network.push({url,method:options.method});
   return new Response(JSON.stringify({
    type:'file',path:'platform/docs/audits/HERMES_READINESS_MAP.json',
    sha:'b'.repeat(40),encoding:'base64',content:Buffer.from(raw).toString('base64')
   }),{status:200});
  }
 });
 const server=createServer({githubReadPilot:pilot,machineIdentityRegistry:identity()});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const endpoint='http://127.0.0.1:'+server.address().port+'/internal/github-read-pilot/readiness';
  assert.equal((await fetch(endpoint)).status,401);
  const result=await fetch(endpoint,{headers:{Authorization:SAFE}});
  assert.equal(result.status,200);
  const body=await result.json();
  assert.deepEqual(body.readiness,{
   capabilities_total:3,tested_count:3,proven_e2e_count:2,operational_count:1
  });
  assert.equal(body.resource,'readiness');
  assert.equal(body.path,'platform/docs/audits/HERMES_READINESS_MAP.json');
  assert.equal(network.length,1);
  assert.equal(network[0].method,'GET');
  assert.ok(network[0].url.endsWith('/contents/platform/docs/audits/HERMES_READINESS_MAP.json?ref=main'));
  assert.equal(audits.length,2);
  assert.equal(audits[1].path,body.path);
  assert.doesNotMatch(JSON.stringify(body),/development|other|done/);
  assert.equal((await fetch(endpoint+'?resource=anything',{headers:{Authorization:SAFE}})).status,405);
  assert.equal((await fetch(endpoint+'/other',{headers:{Authorization:SAFE}})).status,404);
  assert.equal(network.length,1);
 }finally{await new Promise(r=>server.close(r));}
});
test('persistent journal enforces rolling 24h quota after process recreation',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {createDurableJsonLineAudit}=
  require('../src/runtime/hermes-github-live-read-pilot');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-durable-usage-'));
 const journal=path.join(dir,'events.jsonl');
 fs.writeFileSync(journal,'',{mode:0o600});
 const time=Date.parse('2026-10-21T03:00:00.000Z');
 let providerCalls=0;
 const options={
  environment:env(),maxRequests:2,clock:()=>time,
  fetchImpl:async()=>{
   providerCalls++;
   return makeResponse();
  }
 };
 try{
  for(let i=0;i<2;i++){
   const audit=createDurableJsonLineAudit({filePath:journal});
   const pilot=createHermesGithubLiveReadPilot({...options,
    appendAudit:audit,readUsage:audit.countAttempts});
   assert.equal((await pilot.execute({
    identity:{principal:{type:'machine',id:'pilot-reader'},
     tenant_id:'grupo_erick',key_id:'id'},
    resource:'readme'
   })).status,'succeeded');
  }
  const audit=createDurableJsonLineAudit({filePath:journal});
  const denied=createHermesGithubLiveReadPilot({...options,
   appendAudit:audit,readUsage:audit.countAttempts});
  const result=await denied.execute({
   identity:{principal:{type:'machine',id:'pilot-reader'},
    tenant_id:'grupo_erick',key_id:'id'},resource:'readme'
  });
  assert.equal(result.status,'request_budget_exhausted');
  assert.equal(providerCalls,2);
  assert.equal((await audit.countAttempts({
   tenant_id:'grupo_erick',
   since:new Date(time-86400000).toISOString(),now:new Date(time).toISOString()
  })),2);
  fs.chmodSync(journal,0o644);
  assert.equal((await denied.execute({
   identity:{principal:{type:'machine',id:'pilot-reader'},
    tenant_id:'grupo_erick',key_id:'id'},resource:'readme'
  })).status,'quota_store_unavailable');
  assert.equal(providerCalls,2);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('invalid journal JSON denies requests rather than resetting limits',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {createDurableJsonLineAudit}=
  require('../src/runtime/hermes-github-live-read-pilot');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-durable-invalid-'));
 const journal=path.join(dir,'audit.jsonl');
 fs.writeFileSync(journal,'{not json}\n',{mode:0o600});
 try{
  const audit=createDurableJsonLineAudit({filePath:journal});
  const pilot=createHermesGithubLiveReadPilot({environment:env(),
   appendAudit:audit,readUsage:audit.countAttempts,
   fetchImpl:async()=>{throw Error('network_must_not_run');}});
  const result=await pilot.execute({
   identity:{principal:{type:'machine',id:'pilot-reader'},
    tenant_id:'grupo_erick',key_id:'id'}
  });
  assert.equal(result.status,'quota_store_unavailable');
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
