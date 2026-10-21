'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,generateKeyPairSync,verify}=require('node:crypto');
const {createServer}=require('../src/index');
const {createMachineIdentityRegistry}=require('../src/core/machine-identity-registry');
const {createHermesGithubLiveReadPilot}=require('../src/runtime/hermes-github-live-read-pilot');
const {ENDPOINT,validEndpoint,shapeLotoiaHealth,readHermesLotoiaHealth}=
 require('../src/runtime/hermes-lotoia-operational-read');
const MACHINE='lotoia-staging-fixture-machine';
const ORIGIN='https://lotoia-testing-fixture.base44.app';
const URL=ORIGIN+ENDPOINT;
const NOW=Date.parse('2026-10-21T12:30:00Z');
const fixture=()=>({
 ok:true,readonly:true,source:'LotoIA',company:'Grupo Erick',
 pilot_scope:'erick_lotericas_2_stores',source_state:'operational_app',
 qa_included:false,as_of:'2026-10-21',store_count:2,
 open_pending_count:0,open_pending_known_balance_brl:0,
 amount_unknown_count:0,unresolved_alert_count:0,cash_closures_last_7_days:0,
 data_coverage:{window_days:7,status:'no_recent_records',
  stores_with_recent_records:0,real_world_completeness_verified:false,
  recent_source_counts:{operator_cash:0,physical_counts:0,
   caixa_reports:0,financial_movements:0,closures:0}},
 stores:[
 {name:'Erick Lotérica Barreiros',open_pending_count:0,
  open_pending_known_balance_brl:0,amount_unknown_count:0,
  unresolved_alert_count:0,cash_closures_last_7_days:0,
  recent_source_counts:{operator_cash:0,physical_counts:0,
   caixa_reports:0,financial_movements:0,closures:0}},
 {name:'Erick Lotérica Sirinhaém',open_pending_count:0,
  open_pending_known_balance_brl:0,amount_unknown_count:0,
  unresolved_alert_count:0,cash_closures_last_7_days:0,
  recent_source_counts:{operator_cash:0,physical_counts:0,
   caixa_reports:0,financial_movements:0,closures:0}}
 ],
 write_performed:false,notifications_dispatched:false,
 financial_authority:false,real_world_operations_verified:false
});
function keyFile(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lotoia-signer-'));
 const file=path.join(dir,'signer.pem');
 const pair=generateKeyPairSync('ed25519');
 fs.writeFileSync(file,pair.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
 return {file,publicKey:pair.publicKey,close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const env=file=>({
 HERMES_GITHUB_READ_PILOT_ENABLED:'true',HERMES_DEPLOYMENT_STAGE:'staging',
 HERMES_EXECUTION_ENABLED:'false',HERMES_EXECUTION_KILL_SWITCH:'true',
 HERMES_MISSION_INGRESS_ENABLED:'false',
 HERMES_LOTOIA_READ_ENABLED:'true',
 HERMES_LOTOIA_FUNCTION_URL:URL,
 HERMES_LOTOIA_ALLOWED_ORIGIN:ORIGIN,
 HERMES_LOTOIA_SIGNING_KEY_FILE:file
});
test('fixed host/path rejects an arbitrary app URL, raw query and origin mismatch',()=>{
 assert.equal(validEndpoint(URL,ORIGIN),true);
 for(const x of [
  ['https://evil.com'+ENDPOINT,ORIGIN],
  ['http://lotoia-testing-fixture.base44.app'+ENDPOINT,ORIGIN],
  [URL+'?tenant_id=qa',ORIGIN],[URL+'/',ORIGIN],
  ['https://other-app.base44.app'+ENDPOINT,ORIGIN],
  ['https://person@lotoia-testing-fixture.base44.app'+ENDPOINT,ORIGIN],
  [URL,'https://other-app.base44.app'],
  [URL,'https://lotoia-testing-fixture.base44.app/other']
 ])assert.equal(validEndpoint(x[0],x[1]),false,JSON.stringify(x));
});
test('only scoped, fresh two-store LotoIA counts are returned',async()=>{
 const f=fixture();
 assert.equal(shapeLotoiaHealth(f,{clock:()=>NOW}).open_pending_count,0);
 assert.equal(shapeLotoiaHealth(f,{clock:()=>NOW}).data_coverage.status,'no_recent_records');
 const bad=[
  s=>{s.qa_included=true;},
  s=>{s.company='Tenant QA';},
  s=>{s.source='Legacy LotoIA';},
  s=>{s.stores[0].name='QA Data';},
  s=>{s.stores[1].open_pending_count=1;},
  s=>{s.open_pending_known_balance_brl=5.01;},
  s=>{s.unresolved_alert_count=-1;},
  s=>{s.as_of='2026-10-19';},
  s=>{s.as_of='2026-10-22';},
  s=>{s.real_world_operations_verified=true;},
  s=>{s.financial_authority=true;},
  s=>{s.stores[1].open_pending_known_balance_brl=1.001;},
  s=>{s.data_coverage.status='sources_present_unverified';},
  s=>{s.data_coverage.stores_with_recent_records=1;},
  s=>{s.data_coverage.recent_source_counts.operator_cash=1;},
  s=>{s.stores[0].recent_source_counts.closures=1;},
  s=>{s.stores[1].recent_source_counts.physical_counts=-1;},
  s=>{s.data_coverage.real_world_completeness_verified=true;},
  s=>{s.stores[1].recent_source_counts.qa_field=1;}
 ];
 for(const mutation of bad){
  const data=fixture();mutation(data);
  assert.throws(()=>shapeLotoiaHealth(data,{clock:()=>NOW}));
 }
 const contaminated=fixture();
 contaminated.private_customer_cpf='SENSITIVE';
 assert.doesNotMatch(JSON.stringify(shapeLotoiaHealth(contaminated,{clock:()=>NOW})),/SENSITIVE/);
});
test('signed fixed empty POST reads sanitized LotoIA backend, no admin bearer',async()=>{
 const f=keyFile(),calls=[];
 try{
  const output=await readHermesLotoiaHealth({environment:env(f.file),
   clock:()=>NOW,fetchImpl:async(url,opt)=>{
    calls.push({url,opt});
    return new Response(JSON.stringify(fixture()),{status:200});
   }});
  assert.equal(output.store_count,2);
  assert.equal(output.qa_included,false);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,URL);
  assert.equal(calls[0].opt.method,'POST');
  assert.equal(calls[0].opt.body,'{}');
  assert.equal(calls[0].opt.redirect,'error');
  assert.equal(calls[0].opt.headers.Authorization,undefined);
  const h=calls[0].opt.headers;
  const message=['hermes-lotoia-health-v1','POST',ENDPOINT,
   '68d304fd3c2a6353d2cb0b4d',
   h['X-Hermes-Read-Timestamp'],h['X-Hermes-Read-Nonce'],'{}'].join('\n');
  assert.equal(verify(null,Buffer.from(message),f.publicKey,
   Buffer.from(h['X-Hermes-Read-Signature'],'base64url')),true);
 }finally{f.close();}
});
test('disabled or unsafe key / bad response blocks before leaking records',async()=>{
 const f=keyFile();let called=0;
 try{
  await assert.rejects(readHermesLotoiaHealth({
   environment:{...env(f.file),HERMES_LOTOIA_READ_ENABLED:'false'},
   fetchImpl:async()=>{called++;throw Error('not allowed');}
  }),/disabled/);
  assert.equal(called,0);
  fs.chmodSync(f.file,0o644);
  await assert.rejects(readHermesLotoiaHealth({
   environment:env(f.file),fetchImpl:async()=>{called++;throw Error('not allowed');}
  }),/unsafe/);
  assert.equal(called,0);
  fs.chmodSync(f.file,0o600);
  await assert.rejects(readHermesLotoiaHealth({
   environment:env(f.file),clock:()=>NOW,
   fetchImpl:async()=>new Response('unauthorized',{status:401})
  }),/provider_denied/);
 }finally{f.close();}
});
test('Hermes ingress shares identity quota and audit with other domains',async()=>{
 const f=keyFile(),audit=[],network=[];
 const pilot=createHermesGithubLiveReadPilot({
  environment:env(f.file),clock:()=>NOW,maxRequests:1,
  appendAudit:async value=>audit.push(value),
  readUsage:async()=>audit.filter(x=>x.event==='attempt').length,
  fetchImpl:async(url,opt)=>{
   network.push({url,method:opt.method});
   return new Response(JSON.stringify(fixture()),{status:200});
  }
 });
 const machineIdentityRegistry=createMachineIdentityRegistry({entries:[{
  key_id:'lotoia-reader',principal_id:'lotoia-reader',
  tenant_id:'grupo_erick',active:true,
  key_digest:createHash('sha256').update(MACHINE).digest('hex')
 }]});
 const server=createServer({githubReadPilot:pilot,machineIdentityRegistry});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port+'/internal/lotoia-read-pilot/health';
 try{
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url+'?tenant_id=qa',{
   headers:{Authorization:'Bearer '+MACHINE}})).status,405);
  assert.equal((await fetch(url,{method:'POST',
   headers:{Authorization:'Bearer '+MACHINE}})).status,405);
  assert.equal(network.length,0);
  const authorized=await fetch(url,{headers:{Authorization:'Bearer '+MACHINE}});
  assert.equal(authorized.status,200);
  const result=await authorized.json();
  assert.equal(result.source,'LotoIA');
  assert.equal(result.store_count,2);
  assert.equal(result.status,'succeeded');
  assert.equal(result.simulated,false);
  assert.equal(result.write_performed,false);
  assert.equal(result.production_used,false);
  assert.equal(network.length,1);
  assert.deepEqual(audit.map(x=>x.event),['attempt','result']);
  assert.equal(audit[0].provider,'BASE44_LOTOIA');
  assert.equal(audit[1].adapter_outcome,'SUCCEEDED');
  assert.doesNotMatch(JSON.stringify(audit),/customer|cpf|email|signature|token|lottery_sales/i);
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+MACHINE}})).status,429);
  assert.equal(network.length,1);
 }finally{await new Promise(r=>server.close(r));f.close();}
});

test('consistent partial coverage never authorizes financial action',()=>{
 const d=fixture();
 d.stores[0].recent_source_counts.operator_cash=2;
 d.data_coverage.recent_source_counts.operator_cash=2;
 d.data_coverage.stores_with_recent_records=1;
 d.data_coverage.status='partial_records';
 const safe=shapeLotoiaHealth(d,{clock:()=>NOW});
 assert.equal(safe.data_coverage.status,'partial_records');
 assert.equal(safe.data_coverage.stores_with_recent_records,1);
 assert.equal(safe.data_coverage.real_world_completeness_verified,false);
 assert.equal(safe.financial_authority,false);
 assert.equal(safe.write_performed,false);
});
