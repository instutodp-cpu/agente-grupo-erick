'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createServer}=require('../src/index');
const {createMachineIdentityRegistry}=require('../src/core/machine-identity-registry');
const {createHermesGithubLiveReadPilot}=
 require('../src/runtime/hermes-github-live-read-pilot');
const {readBcbEconomicIndicator}=
 require('../src/runtime/hermes-bcb-economic-read');
const NOW=Date.parse('2026-10-21T03:20:00.000Z');
const TOKEN='fixture-token';
const env={HERMES_GITHUB_READ_PILOT_ENABLED:'true',HERMES_DEPLOYMENT_STAGE:'staging',
 HERMES_EXECUTION_ENABLED:'false',HERMES_EXECUTION_KILL_SWITCH:'true',
 HERMES_MISSION_INGRESS_ENABLED:'false'};
const response=items=>new Response(JSON.stringify(items),{status:200});
const selic=[
 {data:'19/10/2026',valor:'13.75'},
 {data:'20/10/2026',valor:'13.75'},
 {data:'22/10/2026',valor:'15.00'},
 {data:'04/11/2026',valor:'16.00'}
];
test('Selic ignores future records, preserving only observed dates',async()=>{
 const urls=[];
 const r=await readBcbEconomicIndicator({kind:'selic',clock:()=>NOW,
  fetchImpl:async(url,options)=>{
   urls.push({url,method:options.method,redirect:options.redirect});
   return response(selic);
  }});
 assert.equal(r.value,13.75);
 assert.equal(r.observation_date,'2026-10-20');
 assert.equal(r.as_of_date,'2026-10-21');
 assert.equal(r.future_records_ignored,2);
 assert.equal(r.series_code,432);
 assert.equal(r.unit,'percent_per_year');
 assert.equal(urls[0].method,'GET');
 assert.equal(urls[0].redirect,'error');
 assert.equal(urls[0].url,
  'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/20?formato=json');
});
test('IPCA monthly observations use a different fixed series',async()=>{
 const r=await readBcbEconomicIndicator({kind:'ipca',clock:()=>NOW,
  fetchImpl:async()=>response([
   {data:'01/08/2026',valor:'-0.32'},
   {data:'01/09/2026',valor:'0.82'}
  ])});
 assert.equal(r.value,0.82);
 assert.equal(r.series_code,433);
 assert.equal(r.unit,'percent_per_month');
 assert.equal(r.observation_date,'2026-09-01');
});
test('unavailable, stale and malformed provider data is rejected',async()=>{
 const failures=[
  [{data:'22/10/2026',valor:'18.00'}],
  [{data:'01/01/2025',valor:'17.00'}],
  [{data:'20/10/2026',valor:'NaN'}],
  [{data:'31/02/2026',valor:'13.75'}],
  [{data:'20/10/2026',valor:'2000.00'}],
  [{data:'20/10/2026',valor:'not-a-number'}],
  [],{},[{'data':'20/10/2026'}]
 ];
 for(const data of failures)await assert.rejects(
  readBcbEconomicIndicator({kind:'selic',clock:()=>NOW,
   fetchImpl:async()=>response(data)}),/bcb_/);
 await assert.rejects(readBcbEconomicIndicator({kind:'invalid',
  clock:()=>NOW,fetchImpl:async()=>{throw Error('unexpected call');}}),/not_allowed/);
 await assert.rejects(readBcbEconomicIndicator({kind:'selic',
  clock:()=>NOW,fetchImpl:async()=>new Response('x'.repeat(8200),{status:200})}),
 /too_large/);
});
test('economy and development share machine access, journal and quota',async()=>{
 const audit=[],calls=[];
 const reader=createHermesGithubLiveReadPilot({
  environment:env,maxRequests:2,clock:()=>NOW,
  appendAudit:async r=>audit.push(r),
  readUsage:async()=>audit.filter(r=>r.event==='attempt').length,
  fetchImpl:async(url,opt)=>{
   calls.push({url,method:opt.method});
   return response(selic);
  }
 });
 const registry=createMachineIdentityRegistry({entries:[{
  key_id:'fixture',principal_id:'pilot-reader',tenant_id:'grupo_erick',
  key_digest:createHash('sha256').update(TOKEN).digest('hex'),active:true
 }]});
 const server=createServer({githubReadPilot:reader,machineIdentityRegistry:registry});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const url=base+'/internal/economy-read-pilot/selic';
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{method:'POST',
   headers:{Authorization:'Bearer '+TOKEN}})).status,405);
  assert.equal((await fetch(url+'?extra=1',{
   headers:{Authorization:'Bearer '+TOKEN}})).status,405);
  const resp=await fetch(url,{headers:{Authorization:'Bearer '+TOKEN}});
  assert.equal(resp.status,200);
  const body=await resp.json();
  assert.equal(body.indicator,'selic');
  assert.equal(body.value,13.75);
  assert.equal(body.network_call_performed,true);
  assert.equal(body.write_performed,false);
  assert.equal(body.simulated,false);
  assert.equal(body.observation_date,'2026-10-20');
  assert.equal(calls.length,1);
  assert.equal(audit[1].provider,'BCB_SGS');
  assert.equal(audit[1].series_code,432);
  const other=await fetch(base+'/internal/economy-read-pilot/ipca',{
   headers:{Authorization:'Bearer '+TOKEN}});
  assert.equal(other.status,200);
  const blocked=await fetch(base+'/internal/github-read-pilot',{
   headers:{Authorization:'Bearer '+TOKEN}});
  assert.equal(blocked.status,429);
  assert.equal(calls.length,2);
 }finally{await new Promise(r=>server.close(r));}
});
test('disabled environment or rejected provider remains without authority',async()=>{
 const denial=createHermesGithubLiveReadPilot({
  environment:{...env,HERMES_EXECUTION_KILL_SWITCH:'false'},
  appendAudit:async()=>{},readUsage:async()=>0,fetchImpl:async()=>response(selic)
 });
 assert.equal((await denial.execute({resource:'selic'})).status,'disabled');
 const audit=[];
 const broken=createHermesGithubLiveReadPilot({environment:env,maxRequests:2,
  clock:()=>NOW,appendAudit:async r=>audit.push(r),
  readUsage:async()=>audit.filter(r=>r.event==='attempt').length,
  fetchImpl:async()=>new Response('offline',{status:503})});
 const outcome=await broken.execute({resource:'selic',identity:{
  principal:{type:'machine',id:'pilot-reader'},
  tenant_id:'grupo_erick',key_id:'fixture'
 }});
 assert.equal(outcome.status,'provider_failed');
 assert.equal(outcome.write_performed,false);
 assert.deepEqual(audit.map(x=>x.event),['attempt','result']);
 assert.equal(audit[1].adapter_outcome,'FAILED');
});
