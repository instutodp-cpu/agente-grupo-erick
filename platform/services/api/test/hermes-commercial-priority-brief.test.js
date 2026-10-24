'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,generateKeyPairSync}=require('node:crypto');
const {createServer}=require('../src/index');
const {createMachineIdentityRegistry}=require('../src/core/machine-identity-registry');
const {createHermesGithubLiveReadPilot}=require('../src/runtime/hermes-github-live-read-pilot');
const {createHermesCommercialPriorityBrief}=require('../src/runtime/hermes-commercial-priority-brief');
const NOW=Date.parse('2026-10-21T12:00:00Z');
const MACHINE='machine-reader-commercial-priorities';
const fixture=()=>({
 ok:true,readonly:true,source:'Compras homologacao',
 company:'Grupo Erick',source_state:'homologacao',erp_linx_conciliated:false,
 as_of:'2026-10-21',purchase_period_start:'2026-09-21',active_stores:6,
 purchases_last_30_days:{count:25,net_brl:385410.97},
 open_titles:{count:942,balance_brl:2657483.43},
 overdue_titles:{count:471,balance_brl:1198243.1},
 next_30_days_titles:{count:88,balance_brl:189280.82}
});
test('prioritizes overdue, upcoming and ERP reconciliation without acting',()=>{
 const result=createHermesCommercialPriorityBrief(fixture(),{clock:()=>NOW});
 assert.equal(result.active_stores,6);
 assert.equal(result.purchases_last_30_days.net_brl,385410.97);
 assert.equal(result.overdue_titles.count,471);
 assert.equal(result.overdue_titles.share_of_open_balance_percent,
  Math.round(1198243.1/2657483.43*10000)/100);
 assert.deepEqual(result.alerts.map(x=>x.code),
  ['verify_overdue','review_next_30_days','reconcile_linx']);
 assert.deepEqual(result.alerts.map(x=>x.priority),[1,2,3]);
 assert.equal(result.alerts_dispatched,false);
 assert.equal(result.payment_authorized,false);
 assert.equal(result.financial_decision_automated,false);
 assert.equal(result.external_write_performed,false);
 assert.equal(result.erp_linx_conciliated,false);
});
test('zero financial exposure returns only reconciliation advisory',()=>{
 const data=fixture();
 data.open_titles={count:0,balance_brl:0};
 data.overdue_titles={count:0,balance_brl:0};
 data.next_30_days_titles={count:0,balance_brl:0};
 const result=createHermesCommercialPriorityBrief(data,{clock:()=>NOW});
 assert.deepEqual(result.alerts.map(x=>x.code),['reconcile_linx']);
 assert.equal(result.overdue_titles.share_of_open_balance_percent,0);
});
test('invalid, stale, future, QA and contradictory source data fails closed',()=>{
 const changes=[
  d=>{d.company='Loja QA';},
  d=>{d.source='Gestor de Compras e Duplicatas';},
  d=>{d.erp_linx_conciliated=true;},
  d=>{d.as_of='2026-10-19';},
  d=>{d.as_of='2026-10-23';},
  d=>{d.as_of='2026-02-30';},
  d=>{d.active_stores=22;},
  d=>{d.overdue_titles.count=943;},
  d=>{d.overdue_titles.balance_brl=3000000;},
  d=>{d.overdue_titles.balance_brl=NaN;},
  d=>{d.next_30_days_titles.balance_brl=1900000;},
  d=>{d.open_titles.count=-1;},
  d=>{d.purchases_last_30_days.net_brl=1.001;}
 ];
 for(const change of changes){
  const d=fixture();change(d);
  assert.throws(()=>createHermesCommercialPriorityBrief(d,{clock:()=>NOW}));
 }
});
test('new route has same identity, persisted budget and non-sensitive audit',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-commercial-brief-'));
 const key=path.join(dir,'signing.pem');
 const {privateKey}=generateKeyPairSync('ed25519');
 fs.writeFileSync(key,privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
 const env={
  HERMES_GITHUB_READ_PILOT_ENABLED:'true',HERMES_DEPLOYMENT_STAGE:'staging',
  HERMES_EXECUTION_ENABLED:'false',HERMES_EXECUTION_KILL_SWITCH:'true',
  HERMES_MISSION_INGRESS_ENABLED:'false',
  HERMES_BASE44_COMMERCIAL_READ_ENABLED:'true',
  HERMES_BASE44_COMMERCIAL_SIGNING_KEY_FILE:key,
  HERMES_BASE44_COMMERCIAL_FUNCTION_URL:
   'https://compras-evolucao-copy-5ccf8577.base44.app/functions/getHermesCommercialSummary'
 };
 const journal=[],network=[];
 const pilot=createHermesGithubLiveReadPilot({environment:env,clock:()=>NOW,
  maxRequests:1,appendAudit:async event=>journal.push(event),
  readUsage:async()=>journal.filter(e=>e.event==='attempt').length,
  fetchImpl:async(url,options)=>{
   network.push({url,method:options.method});
   return new Response(JSON.stringify(fixture()),{status:200});
  }
 });
 const registry=createMachineIdentityRegistry({entries:[{
  key_id:'pilot-machine',principal_id:'reader',tenant_id:'grupo_erick',
  key_digest:createHash('sha256').update(MACHINE).digest('hex'),active:true
 }]});
 const server=createServer({githubReadPilot:pilot,machineIdentityRegistry:registry});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port+'/internal/commercial-read-pilot/brief';
 try{
  assert.equal((await fetch(endpoint)).status,401);
  assert.equal((await fetch(endpoint+'?store_id=qa',{
   headers:{Authorization:'Bearer '+MACHINE}})).status,405);
  assert.equal((await fetch(endpoint,{method:'POST',
   headers:{Authorization:'Bearer '+MACHINE}})).status,405);
  assert.equal(network.length,0);
  const res=await fetch(endpoint,{headers:{Authorization:'Bearer '+MACHINE}});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.status,'succeeded');
  assert.equal(data.executed,true);
  assert.equal(data.brief.active_stores,6);
  assert.equal(data.brief.alerts.length,3);
  assert.equal(data.brief.alerts_dispatched,false);
  assert.equal(data.write_performed,false);
  assert.equal(data.production_used,false);
  assert.equal(data.simulated,false);
  assert.equal(network.length,1);
  assert.equal(network[0].method,'POST');
  assert.deepEqual(journal.map(x=>x.event),['attempt','result']);
  assert.equal(journal[0].provider,'BASE44_COMPRAS');
  assert.equal(journal[0].resource,'commercial_brief');
  assert.equal(journal[1].adapter_outcome,'SUCCEEDED');
  assert.doesNotMatch(JSON.stringify(journal),
   /385410|2657483|supplier|cnpj|Authorization|X-Hermes-Read/i);
  assert.equal((await fetch(endpoint,{
   headers:{Authorization:'Bearer '+MACHINE}})).status,429);
  assert.equal(network.length,1);
 }finally{await new Promise(resolve=>server.close(resolve));
  fs.rmSync(dir,{recursive:true,force:true});}
});


test('work progress propagates as context only, preserving payment and ERP restrictions',()=>{
 const s=fixture();
 s.reconciliation_work={source:'ReconciliationWorkEvent',as_of:s.as_of,
  erp_linx_conciliated:false,payment_recorded:false,
  tracked_titles:2,waiting_documents:1,in_review:0,
  discrepancy_found:0,review_submitted:1};
 const result=createHermesCommercialPriorityBrief(s,{clock:()=>NOW});
 assert.equal(result.reconciliation_work.tracked_titles,2);
 assert.equal(result.reconciliation_work.review_submitted,1);
 assert.equal(result.payment_authorized,false);
 const forged=fixture();
 forged.reconciliation_work={...s.reconciliation_work,payment_recorded:true};
 assert.throws(()=>createHermesCommercialPriorityBrief(forged,{clock:()=>NOW}),/commercial_work_context_invalid/);
});


test('aged payable priorities preserve verified totals and no financial action',()=>{
 const s=fixture();
 s.reconciliation_priority={
  source:'Duplicate',as_of:s.as_of,method:'days_overdue_and_value_v1',
  erp_linx_conciliated:false,includes_only_open_balance:true,
  overdue_without_work:471,
  overdue_30plus:{count:300,balance_brl:700000},
  overdue_1to29:{count:171,balance_brl:498243.1},
  due_next7:{count:20,balance_brl:30000}
 };
 const b=createHermesCommercialPriorityBrief(s,{clock:()=>NOW});
 assert.deepEqual(b.reconciliation_priority,s.reconciliation_priority);
 assert.equal(b.payment_authorized,false);
 assert.equal(b.external_write_performed,false);
 assert.equal(b.erp_linx_conciliated,false);
 const forged=fixture();
 forged.reconciliation_priority={...s.reconciliation_priority,overdue_without_work:472};
 assert.throws(()=>createHermesCommercialPriorityBrief(forged,{clock:()=>NOW}),/priority_proof_inconsistent/);
});
