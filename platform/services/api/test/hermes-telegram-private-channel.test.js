'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const core=require('../src/runtime/hermes-telegram-private-channel');
const runner=require('../scripts/run-hermes-telegram-private');
const pairCode='aBCdef1234_-',now=Date.parse('2026-10-21T14:00:00Z');
const pairing=()=>({sha256:createHash('sha256').update(pairCode).digest('hex'),
 expires_at:now+600000,attempts:0});
const update=(id,userId,text,chatType='private')=>({
 update_id:id,message:{message_id:7,
  chat:{id:userId,type:chatType},from:{id:userId,is_bot:false},text}
});
const lotoia=()=>({status:'succeeded',executed:true,
 network_call_performed:true,simulated:false,
 write_performed:false,production_used:false,
 trace_id:'11111111-1111-4111-8111-111111111111',
 source:'LotoIA',company:'Grupo Erick',store_count:2,
 qa_included:false,real_world_operations_verified:false,
 financial_authority:false,as_of:'2026-10-21',
 open_pending_count:0,unresolved_alert_count:0,
 open_pending_known_balance_brl:0,
 stores:['Erick Lotérica Barreiros','Erick Lotérica Sirinhaém'].map(name=>({
  name,open_pending_count:0,unresolved_alert_count:0,
  open_pending_known_balance_brl:0,
  recent_source_counts:{operator_cash:0,physical_counts:0,caixa_reports:0,
   financial_movements:0,closures:0}
 })),
 data_coverage:{window_days:7,status:'no_recent_records',
  real_world_completeness_verified:false}
});
const compras=()=>({status:'succeeded',executed:true,
 network_call_performed:true,simulated:false,
 write_performed:false,production_used:false,
 trace_id:'22222222-2222-4222-8222-222222222222',
 brief:{source:'Compras homologacao',company:'Grupo Erick',
  source_state:'homologacao',erp_linx_conciliated:false,
  alerts_dispatched:false,payment_authorized:false,as_of:'2026-10-21',
  purchases_last_30_days:{count:15,net_brl:13250.12},
  open_titles:{count:942,balance_brl:2657483.43},
  overdue_titles:{count:471,balance_brl:1198243.10},
  next_30_days_titles:{count:88,balance_brl:189280.82}}
});
const dir=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hermes-telegram-'));
test('normalizes private identity and never accepts groups, forwards, bots or mismatched sender',()=>{
 assert.equal(core.privateMessage(update(1,123,'/compras')).userId,123);
 assert.equal(core.privateMessage(update(1,123,'/compras','group')),null);
 assert.equal(core.privateMessage({...update(1,123,'/compras'),
  message:{...update(1,123,'/compras').message,from:{id:4}}}),null);
 assert.equal(core.privateMessage({...update(1,123,'/compras'),
  message:{...update(1,123,'/compras').message,forward_origin:{type:'user'}}}),null);
 assert.equal(core.privateMessage({...update(1,123,'/compras'),
  message:{...update(1,123,'/compras').message,from:{id:123,is_bot:true}}}),null);
 assert.equal(core.privateMessage({...update(1,123,'/compras'),
  message:{...update(1,123,'/compras').message,text:'x'.repeat(601)}}),null);
});
test('natural language routes only two explicitly permitted domains',()=>{
 for(const text of ['/compras','resumo das compras','quais pendencias de compras',
  'total de duplicatas?'])assert.equal(core.intentFor(text),'compras',text);
 for(const text of ['/lotoia','situação do LotoIA','resumo das lotericas'])
  assert.equal(core.intentFor(text),'lotoia',text);
 assert.equal(core.intentFor('/status'),'status');
 for(const text of ['pague 10 mil','faça merge','mande um pix',
  '/exec rm -rf /','leia meu WhatsApp pessoal'])
   assert.equal(core.intentFor(text),'unknown',text);
});
test('live responses are fixed, audit-traceable and NEVER claim ERP or lottery reconciliation',()=>{
 const a=core.hermesReply('compras',compras());
 assert.match(a,/2\.657\.483,43/);
 assert.match(a,/1\.198\.243,10/);
 assert.match(a,/NÃO|não conciliados/);
 assert.match(a,/22222222/);
 const b=core.hermesReply('lotoia',lotoia());
 assert.match(b,/sem lançamentos recentes/);
 assert.match(b,/Erick Lotérica Barreiros/);
 assert.match(b,/Erick Lotérica Sirinhaém/);
 assert.match(b,/NÃO comprova ausência de pendências/);
 assert.match(b,/11111111/);
 assert.throws(()=>core.hermesReply('lotoia',{...lotoia(),qa_included:true}));
 assert.throws(()=>core.hermesReply('compras',{...compras(),simulated:true}));
 assert.throws(()=>core.hermesReply('compras',{
  ...compras(),brief:{...compras().brief,erp_linx_conciliated:true}}));
});
test('first pairing binds only a code holder in private chat; unauthorized identity never reads data',async()=>{
 const sent=[],stored=[];
 let reads=0;
 const common={
  clock:()=>now,pairing:pairing(),
  send:async(id,text)=>sent.push({id,text}),
  saveOwner:async id=>stored.push(id),
  savePairing:async()=>{},
  query:async()=>{reads++;return lotoia();}
 };
 assert.equal((await core.processUpdate({
  ...common,update:update(1,500,'/lotoia')})).kind,'unpaired');
 assert.equal((await core.processUpdate({
  ...common,update:update(2,500,'/vincular invalidcode1')})).kind,'pair_denied');
 assert.equal((await core.processUpdate({
  ...common,update:update(3,500,'/vincular '+pairCode,'group')})).kind,'ignored');
 assert.equal(stored.length,0);
 assert.equal(reads,0);
 assert.equal((await core.processUpdate({
  ...common,update:update(4,500,'/vincular '+pairCode)})).kind,'paired');
 assert.deepEqual(stored,[500]);
 assert.equal((await core.processUpdate({
  ...common,ownerId:500,update:update(5,111,'/compras')})).kind,'unauthorized');
 assert.equal(reads,0);
 assert.equal((await core.processUpdate({
  ...common,ownerId:500,update:update(6,500,'/lotoia')})).kind,'answered');
 assert.equal(reads,1);
 assert.match(sent.at(-1).text,/LotoIA/);
});
test('expired and exhausted pairing is fail-closed',()=>{
 assert.equal(core.pairValid(pairCode,pairing(),now),true);
 assert.equal(core.pairValid(pairCode,pairing(),now+900000),false);
 assert.equal(core.pairValid(pairCode,{...pairing(),attempts:5},now),false);
 assert.equal(core.pairValid('othercode123',pairing(),now),false);
});
test('failed provider or quota reply does not pretend a verified result',async()=>{
 const sent=[];
 const make=query=>core.processUpdate({
  ownerId:123,update:update(1,123,'/compras'),
  send:async(_,text)=>sent.push(text),query
 });
 await make(async()=>({denied_status:'request_budget_exhausted'}));
 assert.match(sent.pop(),/12 consultas/);
 await make(async()=>{throw Error('SECRET INTERNAL TOKEN');});
 const text=sent.pop();
 assert.match(text,/Não consegui validar/);
 assert.doesNotMatch(text,/SECRET/);
});
test('protected secret/state I/O and durable audit never store message bodies',()=>{
 const d=dir();
 try{
  fs.chmodSync(d,0o700);
  runner.checkStateDirectory(d);
  const s=path.join(d,'token');
  fs.writeFileSync(s,'123456:ABCdefABCdefABCdefABCdefABCdefABCdef',{mode:0o600});
  assert.match(runner.readSecret(s),/^123456:/);
  fs.chmodSync(s,0o644);
  assert.throws(()=>runner.readSecret(s),/protected_secret_invalid/);
  fs.chmodSync(s,0o600);
  runner.saveState(d,'offset.json',{offset:7});
  assert.deepEqual(runner.loadState(d,'offset.json'),{offset:7});
  assert.equal(fs.statSync(path.join(d,'offset.json')).mode&0o777,0o600);
  runner.audit(d,{at:'2026-10-21T12:00:00Z',event:'ingress',update_id:7});
  const contents=fs.readFileSync(path.join(d,'audit.jsonl'),'utf8');
  assert.doesNotMatch(contents,/compras|pague|bot_token|user_id/);
  assert.throws(()=>runner.audit(d,{event:'test',message_text:'SECRET'}));
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('polling persists update offset and ignores repeats across restarts',async()=>{
 const d=dir(),sent=[],apiCalls=[];
 try{
  fs.chmodSync(d,0o700);
  runner.saveState(d,'owner.json',{owner_id:800,bound_at:now});
  const api=async(method,data)=>{
   apiCalls.push(method);
   if(method==='getUpdates')
    return data.offset>10?[]:[update(10,800,'situação do LotoIA')];
   if(method==='sendMessage'){sent.push(data);return {message_id:17};}
   throw Error('unexpected API call');
  };
  const query=async()=>lotoia();
  let first=await runner.pollOnce({stateDir:d,api,query,clock:()=>now});
  assert.deepEqual(first,{handled:1,next_offset:11});
  first=await runner.pollOnce({stateDir:d,api,query,clock:()=>now});
  assert.equal(first.handled,0);
  assert.equal(sent.length,1);
  assert.equal(runner.loadState(d,'offset.json').offset,11);
  assert.equal(runner.loadState(d,'heartbeat.json').at,now);
  const log=fs.readFileSync(path.join(d,'audit.jsonl'),'utf8');
  assert.match(log,/"outcome":"answered"/);
  assert.doesNotMatch(log,/LotoIA —|situação do LotoIA/);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});
test('Telegram API is fixed-method POST with no arbitrary network target',async()=>{
 const calls=[];
 const token='123456:'+ 'A'.repeat(40);
 const api=runner.telegramClient(token,async(url,opts)=>{
  calls.push({url,opts});
  return new Response(JSON.stringify({ok:true,result:{is_bot:true,id:33}}),
   {status:200,headers:{'content-type':'application/json'}});
 });
 assert.deepEqual(await api('getMe',{}),{is_bot:true,id:33});
 assert.deepEqual(await api('getWebhookInfo',{}),{is_bot:true,id:33});
 assert.equal(calls[0].opts.method,'POST');
 assert.ok(calls[0].url.startsWith('https://api.telegram.org/bot'));
 await assert.rejects(api('deleteMessage',{}),/denied/);
 assert.equal(calls.length,2);
});
test('Hermes client only permits fixed GET paths and machine identity',async()=>{
 let called=0;
 const c=runner.hermesClient('A'.repeat(30),async(url,opts)=>{
  called++;
  assert.equal(url,'https://hermes-staging.grupoerick.tech/internal/lotoia-read-pilot/health');
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers.Authorization,'Bearer '+ 'A'.repeat(30));
  return new Response(JSON.stringify(lotoia()),{status:200});
 });
 assert.equal((await c('lotoia',core.ROUTES.lotoia)).source,'LotoIA');
 await assert.rejects(c('lotoia','/internal/admin/execute'),/denied/);
 assert.equal(called,1);
});

test('failed Telegram send does not automatically repeat a read or consume quota twice',async()=>{
 const d=dir();let upstream=0;
 try{
  fs.chmodSync(d,0o700);
  runner.saveState(d,'owner.json',{owner_id:800,bound_at:now});
  const api=async(method,data)=>{
   if(method==='getUpdates')
    return data.offset>20?[]:[update(20,800,'resumo das compras')];
   if(method==='sendMessage')throw Error('telegram_delivery_failed');
   throw Error('unexpected_method');
  };
  const query=async()=>{upstream++;return compras();};
  await assert.rejects(
   runner.pollOnce({stateDir:d,api,query,clock:()=>now}),/telegram_delivery_failed/);
  assert.equal(runner.loadState(d,'offset.json').offset,21);
  assert.equal((await runner.pollOnce({stateDir:d,api,query,clock:()=>now})).handled,0);
  assert.equal(upstream,1);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('authorized private owner reuses a verified commercial reply without extra read',async()=>{
 let saved=null,reads=0,messages=[];
 const props={ownerId:800,clock:()=>now,
  query:async()=>{reads++;return compras()},
  readCache:async()=>saved,writeCache:async(_,x)=>{saved=x},
  send:async(_,text)=>messages.push(text)};
 let a=await core.processUpdate({...props,update:update(81,800,'/compras')});
 assert.equal(a.cache,'stored');
 assert.equal(saved.owner_id,800);
 assert.equal(saved.tenant_id,'grupo_erick');
 assert.match(saved.reply,/Compras dos últimos 30 dias/);
 a=await core.processUpdate({...props,update:update(82,800,'/compras')});
 assert.equal(a.cache,'hit');
 assert.equal(reads,1);
 assert.match(messages.at(-1),/DADOS EM CACHE/);
 assert.match(messages.at(-1),/22222222/);
 const denied=await core.processUpdate({...props,update:update(83,801,'/compras')});
 assert.equal(denied.kind,'unauthorized');
 assert.equal(messages.length,2);
 assert.equal(reads,1);
});
test('quota exhaustion can cite only a previously verified and dated LotoIA reply',async()=>{
 const snapshot={owner_id:800,tenant_id:'grupo_erick',intent:'lotoia',
  at:now-12*3600000,reply:core.hermesReply('lotoia',lotoia())};
 let answer='',reads=0;
 const a=await core.processUpdate({ownerId:800,clock:()=>now,
  update:update(84,800,'/lotoia'),readCache:async()=>snapshot,
  query:async()=>{reads++;return {denied_status:'request_budget_exhausted'}},
  send:async(_,x)=>{answer=x}});
 assert.equal(a.cache,'quota_fallback');
 assert.equal(reads,1);
 assert.match(answer,/DADOS EM CACHE/);
 assert.match(answer,/Quota compartilhada esgotada/);
 assert.match(answer,/NÃO comprova ausência de pendências/);
});
test('cross-owner, other tenant, expired and tampered snapshots fail closed',async()=>{
 const snapshot={owner_id:800,tenant_id:'grupo_erick',intent:'compras',
  at:now,reply:core.hermesReply('compras',compras())};
 for(const x of [{...snapshot,owner_id:801},{...snapshot,tenant_id:'outside'},
  {...snapshot,at:now-86400001},{...snapshot,reply:'fake balances'}]){
  assert.equal(core.verifiedCache(x,800,'compras',now),null);
 }
 let text='';
 await core.processUpdate({ownerId:800,clock:()=>now,
  update:update(85,800,'/compras'),
  readCache:async()=>({...snapshot,at:now-86400001}),
  query:async()=>({denied_status:'request_budget_exhausted'}),
  send:async(_,x)=>{text=x}});
 assert.match(text,/12 consultas/);
 assert.doesNotMatch(text,/2\.657\.483/);
});
test('poller persists owner scoped cache 0600 and audits no financial values',async()=>{
 const d=dir();
 try{
  fs.chmodSync(d,0o700);
  runner.saveState(d,'owner.json',{owner_id:800,bound_at:now});
  let queries=0;
  const api=async(method,arg)=>{
   if(method==='getUpdates')return arg.offset>88?[]:[update(88,800,'/compras')];
   if(method==='sendMessage')return {message_id:40};
  };
  await runner.pollOnce({stateDir:d,api,clock:()=>now,
   query:async()=>{queries++;return compras()}});
  const f=path.join(d,'cache-compras.json');
  assert.equal(fs.statSync(f).mode&0o777,0o600);
  assert.equal(runner.loadState(d,'cache-compras.json').owner_id,800);
  assert.equal(queries,1);
  const audit=fs.readFileSync(path.join(d,'audit.jsonl'),'utf8');
  assert.match(audit,/"cache":"stored"/);
  assert.doesNotMatch(audit,/2\.657\.483|13\.250,12/);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

const historicalFixture=()=>({
 version:1,tenant_id:'grupo_erick',project_id:'yxmdrrwqxwzsdgcgskrm',
 source_table:'softcom_import.cadastro_de_vendas',
 extracted_at:new Date(now).toISOString(),latest_sale_date:'2026-06-08',
 registered:60,marked_cancelled:6,
 months:['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06']
  .map(month=>({month,registered:10,marked_cancelled:1})),
 stores:['CALCADOS','SIRINHAEM','MAGAZINE','SPORTS-(DESATIVADO)',
   'ERICK SPORTS','VARIEDADES'].map(raw_label=>({raw_label,registered:10,marked_cancelled:1}))
});
test('historical summary and dimensions cite source, vintage and no-revenue caveats',()=>{
 const x=historicalFixture();
 assert.equal(core.safeHistorySnapshot(x,now),true);
 const answer=core.historicalReply('historico',x,now);
 assert.match(answer,/60/);
 assert.match(answer,/6/);
 assert.match(answer,/8 jun\/2026/);
 assert.match(answer,/NÃO faturamento/);
 assert.match(core.historicalReply('historico_lojas',x,now),/SPORTS-\(DESATIVADO\)/);
 assert.match(core.historicalReply('historico_meses',x,now),/2026-06/);
});
test('historical data fails closed on wrong tenant, source, totals, freshness and injection',()=>{
 const x=historicalFixture();
 for(const bad of [
  {...x,tenant_id:'personal::1'}, {...x,project_id:'wrong'},
  {...x,registered:61},{...x,source_table:'auth.users'},
  {...x,extracted_at:'9999-01-01T00:00:00Z'},
  {...x,stores:[{...x.stores[0],raw_label:'unauthorized'},...x.stores.slice(1)]}
 ]){
  assert.equal(core.safeHistorySnapshot(bad,now),false);
  assert.throws(()=>core.historicalReply('historico',bad,now));
 }
});
test('owner-only historical query is answered without business provider call or 12/day quota',async()=>{
 const sent=[];let historyReads=0,upstreamReads=0;
 const args={ownerId:800,clock:()=>now,
   readHistory:async()=>{historyReads++;return historicalFixture()},
   query:async()=>{upstreamReads++;throw Error('must never call upstream')},
   send:async(_,text)=>sent.push(text)};
 const result=await core.processUpdate({...args,update:update(101,800,'/historico')});
 assert.equal(result.kind,'answered');
 assert.equal(result.source,'softcom_snapshot');
 assert.equal(historyReads,1);
 assert.equal(upstreamReads,0);
 assert.match(sent[0],/Histórico de vendas/);
 const denied=await core.processUpdate({...args,update:update(102,801,'/historico lojas')});
 assert.equal(denied.kind,'unauthorized');
 assert.equal(historyReads,1);
 assert.equal(sent.length,1);
});
test('missing historical snapshot shows no fabricated company numbers',async()=>{
 let answer='';
 await core.processUpdate({ownerId:800,clock:()=>now,
  update:update(103,800,'/historico'),
  readHistory:async()=>null,query:async()=>{throw Error('provider called')},
  send:async(_,text)=>{answer=text}});
 assert.match(answer,/indisponível ou não validado/);
 assert.doesNotMatch(answer,/25\.482/);
});
test('poller reads protected historical snapshot via existing state path',async()=>{
 const d=dir();
 try{
  fs.chmodSync(d,0o700);
  runner.saveState(d,'owner.json',{owner_id:800,bound_at:now});
  runner.saveState(d,'history-softcom.json',historicalFixture());
  let calls=0,responded='';
  const api=async(method,p)=>{
   if(method==='getUpdates')return p.offset>104?[]:[update(104,800,'/historico lojas')];
   if(method==='sendMessage'){responded=p.text;return {message_id:41};}
  };
  await runner.pollOnce({stateDir:d,api,clock:()=>now,
   query:async()=>{calls++;throw Error('must not query')}});
  assert.equal(calls,0);
  assert.match(responded,/CALCADOS/);
  assert.equal(fs.statSync(path.join(d,'history-softcom.json')).mode&0o777,0o600);
  const log=fs.readFileSync(path.join(d,'audit.jsonl'),'utf8');
  assert.match(log,/"intent":"historico_lojas"/);
  assert.doesNotMatch(log,/CALCADOS|nome_do_cliente|secret/i);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

const historicalLive=require('../src/runtime/hermes-softcom-live-reader');
test('dynamic historic aggregate supports month/store filters, fixed SQL and live attribution',async()=>{
 const calls=[];
 const client={query:async q=>{
  calls.push(q);
  return {rows:[{registered:'5933',cancelled:'267',last_day:'2026-05-31'}]};
 }};
 const result=await historicalLive.readHistoricalSales(client,{
  tenant_id:'grupo_erick',month:'2026-05',store:'CALCADOS',shape:'total'
 },()=>new Date('2026-10-21T23:00:00.000Z'));
 assert.equal(result.mode,'online_aggregate');
 assert.equal(result.source_table,'hermes_history.daily_sales_v1');
 assert.equal(result.rows[0].registered,5933);
 assert.equal(result.rows[0].marked_cancelled,267);
 assert.equal(calls.length,1);
 assert.match(calls[0].text,/hermes_history\.daily_sales_v1/);
 assert.doesNotMatch(calls[0].text,/cadastro_clientes|nome_do_cliente|select \*/i);
 assert.deepEqual(calls[0].values,['2026-05','CALCADOS']);
 assert.equal(calls[0].query_timeout,5000);
});
test('dynamic historic aggregate never issues SQL for unsupported tenant, months, or injection',async()=>{
 let calls=0;
 const client={query:async()=>{calls++;return {rows:[]}}};
 const invalid=[
  {tenant_id:'personal',shape:'total'},
  {tenant_id:'grupo_erick',month:'2026-07'},
  {tenant_id:'grupo_erick',month:'2026-05;DROP TABLE'},
  {tenant_id:'grupo_erick',store:'CALCADOS OR 1=1'},
  {tenant_id:'grupo_erick',shape:'sql'},
  {tenant_id:'grupo_erick',schema:'softcom_import',shape:'raw'}
 ];
 for(const p of invalid)await assert.rejects(
  historicalLive.readHistoricalSales(client,p),/denied/);
 assert.equal(calls,0);
});
test('dynamic historic aggregate handles typed rows, rejects unrecognized dimensions and bad counts',async()=>{
 const p={tenant_id:'grupo_erick',shape:'months'};
 const good={query:async()=>({rows:[
  {label:'2026-01',registered:'4902',cancelled:'126'},
  {label:'2026-05',registered:'5933',cancelled:'267'}]})};
 const result=await historicalLive.readHistoricalSales(good,p);
 assert.equal(result.rows.length,2);
 for(const rows of [
  [{label:'2026-07',registered:'1',cancelled:'0'}],
  [{label:'2026-01',registered:'1',cancelled:'2'}],
  [{label:'2026-01',registered:'0',cancelled:'0'},{label:'2026-01',registered:'0',cancelled:'0'}],
  [{label:'2026-01',registered:'NaN',cancelled:'0'}],
  Array.from({length:7},(_,i)=>({label:'2026-01',registered:String(i),cancelled:'0'}))
 ])await assert.rejects(
  historicalLive.readHistoricalSales({query:async()=>({rows})},p));
 assert.match(historicalLive.SQL.total,/\$1::text/);
 assert.match(historicalLive.SQL.total,/\$2::text/);
 assert.deepEqual(Object.keys(historicalLive.SQL).sort(),['months','products','stores','total']);
});
test('dynamic historic aggregate is fail-closed on provider failures and absent connection',async()=>{
 await assert.rejects(historicalLive.readHistoricalSales(null,{tenant_id:'grupo_erick'}));
 await assert.rejects(historicalLive.readHistoricalSales(
  {query:async()=>{throw Error('network_down')}},{tenant_id:'grupo_erick'}),/network_down/);
 assert.throws(()=>historicalLive.validate({tenant_id:'other'}));
});

const liveChannel=require('../src/runtime/hermes-softcom-live-channel');
test('dynamic sales grammar accepts only bounded month, store, and group intents',()=>{
 const inputs=[
  ['/vendas 2026-05',{tenant_id:'grupo_erick',month:'2026-05',shape:'total'}],
  ['/vendas lojas 2026-04',{tenant_id:'grupo_erick',month:'2026-04',shape:'stores'}],
  ['/vendas meses',{tenant_id:'grupo_erick',shape:'months'}],
  ['/vendas loja ERICK SPORTS 2026-05',{tenant_id:'grupo_erick',store:'ERICK SPORTS',month:'2026-05',shape:'total'}],
  ['Quantas vendas em maio de 2026?',{tenant_id:'grupo_erick',month:'2026-05',shape:'total'}],
  ['Vendas por loja em março de 2026?',{tenant_id:'grupo_erick',month:'2026-03',shape:'stores'}],
 ];
 for(const [input,expected] of inputs){
  assert.deepEqual(liveChannel.parseSalesCommand(input),expected,input);
  assert.equal(core.intentFor(input),'historico_live');
 }
 for(const bad of ['/vendas 2026-07','/vendas 2026-05; DROP TABLE users',
  '/vendas loja CALCADOS OR 1=1 2026-05','/vendas loja CALCADOS 2027-02',
  '/vendas lojas 2026-13','mande um pix','/historico 2026-05',
  'quantas vendas em julho de 2026?']){
  assert.equal(liveChannel.parseSalesCommand(bad),null,bad);
 }
});
test('verified dynamic monthly response states source and no revenue claims',()=>{
 const req=liveChannel.parseSalesCommand('/vendas 2026-05');
 const obj={tenant_id:'grupo_erick',source_table:'hermes_history.daily_sales_v1',
  mode:'online_aggregate',queried_at:'2026-10-21T23:20:00Z',
  filter:{month:'2026-05',raw_store:null},shape:'total',
  rows:[{registered:5933,marked_cancelled:267,last_day:'2026-05-31'}]};
 const reply=liveChannel.historicalLiveReply(obj,req);
 assert.match(reply,/5\.933/);
 assert.match(reply,/267/);
 assert.match(reply,/NÃO faturamento/);
 assert.match(reply,/Supabase softcom-grupo-erick/);
 assert.throws(()=>liveChannel.historicalLiveReply({...obj,tenant_id:'attacker'},req));
 assert.throws(()=>liveChannel.historicalLiveReply({...obj,filter:{month:'2026-04',raw_store:null}},req));
});
test('private live query refuses nonowner before invoking PostgreSQL and never spends quota if off',async()=>{
 const stateDir=dir();fs.chmodSync(stateDir,0o700);
 const queryCalls=[];const sent=[];
 const api=async(method,payload)=>{
  if(method==='getUpdates')return [update(4321,701,'/vendas 2026-05')];
  if(method==='sendMessage')sent.push(payload.text);
 };
 try{
  runner.saveState(stateDir,'owner.json',{owner_id:700});
  const r=await runner.pollOnce({stateDir,api,query:async()=>{},
   readLive:async p=>{queryCalls.push(p);return null},
   liveEnabled:true,clock:()=>now});
  assert.equal(r.handled,1);
  assert.equal(queryCalls.length,0);
  assert.equal(sent.length,0);
  assert.equal(fs.existsSync(path.join(stateDir,'history-live-budget.json')),false);
 }finally{fs.rmSync(stateDir,{recursive:true,force:true})}
});
test('bounded private live query enforces 8 daily queries and no external domain quota',async()=>{
 const stateDir=dir();fs.chmodSync(stateDir,0o700);
 const sent=[];let reads=0;
 const fakeRead=async p=>{
  reads++;
  return {tenant_id:'grupo_erick',source_table:'hermes_history.daily_sales_v1',
   mode:'online_aggregate',queried_at:'2026-10-21T23:20:00Z',
   filter:{month:p.month||null,raw_store:p.store||null},shape:p.shape||'total',
   rows:[{registered:10,marked_cancelled:1,last_day:'2026-05-31'}]};
 };
 let index=0;
 const api=async(method,payload)=>{
  if(method==='getUpdates')return [update(5000+index++,700,'/vendas 2026-05')];
  if(method==='sendMessage')sent.push(payload.text);
 };
 try{
  runner.saveState(stateDir,'owner.json',{owner_id:700});
  for(let i=0;i<10;i++)await runner.pollOnce({
   stateDir,api,readLive:fakeRead,liveEnabled:true,
   query:async()=>{throw Error('must not query standard Hermes')},clock:()=>now});
  assert.equal(reads,8);
  assert.equal(sent.length,10);
  assert.match(sent[0],/consulta ao banco/);
  assert.match(sent[9],/Limite privado/);
  assert.deepEqual(runner.loadState(stateDir,'history-live-budget.json'),{
   date:new Date(now).toISOString().slice(0,10),count:8});
  assert.equal(fs.existsSync(path.join(stateDir,'cache-compras.json')),false);
  assert.equal(fs.statSync(path.join(stateDir,'history-live-budget.json')).mode&0o777,0o600);
 }finally{fs.rmSync(stateDir,{recursive:true,force:true})}
});
test('no live database connector is loaded without explicit stage-safe flag',async()=>{
 let loaded=false;
 const disabled=runner.createLiveQuery({HERMES_HISTORY_LIVE_ENABLED:'false'},()=>{
  loaded=true;throw Error('driver unexpectedly loaded')});
 await assert.rejects(disabled({tenant_id:'grupo_erick'}),/disabled/);
 assert.equal(loaded,false);
 assert.throws(()=>runner.createLiveQuery({
  HERMES_HISTORY_LIVE_ENABLED:'true',
  HERMES_DEPLOYMENT_STAGE:'production',
  HERMES_EXECUTION_ENABLED:'false',
  HERMES_EXECUTION_KILL_SWITCH:'true'
 },()=>{loaded=true}),/stage_denied/);
 assert.equal(loaded,false);
});

test('live PostgreSQL connector validates protected TLS CA and minimum-privilege user',async()=>{
 const tmp=dir();fs.chmodSync(tmp,0o700);
 const pf=path.join(tmp,'db-password'),ca=path.join(tmp,'root.pem');
 fs.writeFileSync(pf,'x'.repeat(64),{mode:0o600});
 fs.writeFileSync(ca,'-----BEGIN CERTIFICATE-----\\nTEST_ONLY\\n-----END CERTIFICATE-----',{mode:0o600});
 let checked=false;
 class Client{
  constructor(cfg){
   checked=true;
   assert.equal(cfg.user,'hermes_history_login.yxmdrrwqxwzsdgcgskrm');
   assert.equal(cfg.host,'aws-7-sa-east-1.pooler.supabase.com');
   assert.equal(cfg.database,'postgres');
   assert.equal(cfg.ssl.rejectUnauthorized,true);
   assert.match(cfg.ssl.ca,/BEGIN CERTIFICATE/);
   assert.equal(cfg.connectionTimeoutMillis,4000);
   assert.equal(cfg.statement_timeout,5000);
  }
  async connect(){}
  async query(){return {rows:[{registered:'10',cancelled:'1',last_day:'2026-05-09'}]}}
  async end(){}
 }
 const env={HERMES_HISTORY_LIVE_ENABLED:'true',
  HERMES_DEPLOYMENT_STAGE:'staging',
  HERMES_EXECUTION_ENABLED:'false',HERMES_EXECUTION_KILL_SWITCH:'true',
  HERMES_HISTORY_PASSWORD_FILE:pf,HERMES_HISTORY_CA_FILE:ca,
  HERMES_HISTORY_POOLER_HOST:'aws-7-sa-east-1.pooler.supabase.com'};
 try{
  const run=runner.createLiveQuery(env,()=>({Client}));
  const result=await run({tenant_id:'grupo_erick',month:'2026-05'});
  assert.equal(checked,true);
  assert.equal(result.mode,'online_aggregate');
  assert.equal(result.rows[0].registered,10);
  fs.chmodSync(ca,0o644);
  assert.throws(()=>runner.createLiveQuery(env,()=>({Client})),/protected_secret_invalid/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
});

test('pooler host must come from explicit project connection config, never guessed',()=>{
 const base={HERMES_HISTORY_LIVE_ENABLED:'true',
  HERMES_DEPLOYMENT_STAGE:'staging',
  HERMES_EXECUTION_ENABLED:'false',HERMES_EXECUTION_KILL_SWITCH:'true'};
 const invalid=[undefined,'','db.yxmdrrwqxwzsdgcgskrm.supabase.co',
  'https://aws-0-sa-east-1.pooler.supabase.com',
  'aws-0-us-east-1.pooler.supabase.com',
  'localhost','aws-0-sa-east-1.pooler.supabase.com;rm'];
 for(const host of invalid){
  assert.throws(()=>runner.createLiveQuery(
   {...base,HERMES_HISTORY_POOLER_HOST:host},()=>{throw Error('driver loaded')} ),
   /history_pooler_host_unverified/);
 }
});

test('product commands are strictly bounded to H1 2026 and cannot inject query',()=>{
 const accepted=[
  ['/produtos 2026-05',{tenant_id:'grupo_erick',month:'2026-05',shape:'products'}],
  ['produtos com mais registros em maio de 2026?',{tenant_id:'grupo_erick',month:'2026-05',shape:'products'}]
 ];
 for(const [command,params] of accepted){
  assert.deepEqual(liveChannel.parseSalesCommand(command),params);
  assert.equal(core.intentFor(command),'historico_live');
 }
 for(const command of ['/produtos 2026-07','/produtos 2026-05; drop table x',
  '/produtos loja CALCADOS 2026-05','/produtos 2027-01',
  'produtos com mais registros em julho de 2026?']){
  assert.equal(liveChannel.parseSalesCommand(command),null);
 }
 assert.throws(()=>historicalLive.validate({tenant_id:'grupo_erick',shape:'products'}),/filter_denied/);
 assert.throws(()=>historicalLive.validate({tenant_id:'grupo_erick',shape:'products',month:'2026-05',store:'CALCADOS'}),/filter_denied/);
 assert.throws(()=>historicalLive.validate({tenant_id:'personal',shape:'products',month:'2026-05'}),/tenant_denied/);
});
test('monthly product query uses only aggregated view with bounded results, no raw item access',async()=>{
 const calls=[];
 const result=await historicalLive.readHistoricalSales({
  query:async q=>{
   calls.push(q);
   return {rows:[
    {product_code:'32452',product_label:'PRODUTO PROMOCIONAL GRUPO ERICK 1499',item_records:'167',marked_item_cancelled:'4',not_marked_cancelled:'163'},
    {product_code:'22154',product_label:'PRODUTO PROMOCIONAL GRUPO ERICK',item_records:'121',marked_item_cancelled:'3',not_marked_cancelled:'118'}
   ]};
  }
 },{tenant_id:'grupo_erick',month:'2026-05',shape:'products'},()=>new Date('2026-10-22T14:00:00Z'));
 assert.equal(result.source_table,'hermes_history.monthly_product_activity_v1');
 assert.equal(result.mode,'online_aggregate');
 assert.deepEqual(calls[0].values,['2026-05']);
 assert.match(calls[0].text,/LIMIT 5/);
 assert.doesNotMatch(calls[0].text,/softcom_import|clientes|select \*/i);
 const msg=liveChannel.historicalLiveReply(result,{month:'2026-05',shape:'products'});
 assert.match(msg,/163 registros/);
 assert.match(msg,/NÃO unidades líquidas vendidas/);
 assert.match(msg,/monthly_product_activity_v1/);
});
test('product response rejects fake, duplicate, invalid labels and inconsistent totals',async()=>{
 const row={product_code:'32452',product_label:'PRODUTO TESTE',item_records:'20',marked_item_cancelled:'1',not_marked_cancelled:'19'};
 const valid={tenant_id:'grupo_erick',month:'2026-05',shape:'products'};
 for(const rows of [
  [{...row,marked_item_cancelled:'21'}],
  [{...row,product_label:'<script>alert(1)</script>'}],
  [{...row,product_code:'0 OR 1=1'}],
  [row,row],
  Array.from({length:6},(_,i)=>({...row,product_code:String(i+1)})),
 ]){
  await assert.rejects(historicalLive.readHistoricalSales({query:async()=>({rows})},valid));
 }
 const data={tenant_id:'grupo_erick',source_table:'hermes_history.monthly_product_activity_v1',
  mode:'online_aggregate',queried_at:'2026-10-22T14:00:00Z',
  filter:{month:'2026-05',raw_store:null},shape:'products',
  rows:[{product_code:'32452',product_label:'PRODUTO TESTE',item_records:20,marked_item_cancelled:1,not_marked_cancelled:19}]};
 assert.throws(()=>liveChannel.historicalLiveReply({...data,source_table:'softcom_import.vendas_efetuadas'},valid));
 assert.throws(()=>liveChannel.historicalLiveReply({...data,rows:[{...data.rows[0],product_label:'\nINJECTED'}]},valid));
 assert.throws(()=>liveChannel.historicalLiveReply({...data,filter:{month:'2026-04',raw_store:null}},valid));
});
test('product commands remain owner-only and share bounded historical read quota',async()=>{
 const stateDir=dir();fs.chmodSync(stateDir,0o700);
 const sent=[];let reads=0;
 try{
  runner.saveState(stateDir,'owner.json',{owner_id:700});
  const api=async(method,payload)=>{
   if(method==='getUpdates')return [update(887,700,'/produtos 2026-05')];
   if(method==='sendMessage')sent.push(payload.text);
  };
  const result=await runner.pollOnce({
   stateDir,api,liveEnabled:true,clock:()=>now,
   query:async()=>{throw Error('unexpected standard Hermes query')},
   readLive:async params=>{
    reads++;assert.equal(params.shape,'products');
    return {tenant_id:'grupo_erick',source_table:'hermes_history.monthly_product_activity_v1',
     mode:'online_aggregate',queried_at:'2026-10-22T14:00:00Z',
     filter:{month:'2026-05',raw_store:null},shape:'products',
     rows:[{product_code:'32452',product_label:'PRODUTO TESTE',item_records:20,marked_item_cancelled:1,not_marked_cancelled:19}]};
   }});
  assert.equal(result.handled,1);
  assert.equal(reads,1);assert.match(sent[0],/Atividade histórica de produtos/);
  assert.deepEqual(runner.loadState(stateDir,'history-live-budget.json'),{date:new Date(now).toISOString().slice(0,10),count:1});
 }finally{fs.rmSync(stateDir,{recursive:true,force:true})}
});

// Commercial analyst: reusable templates, versioned factual fields, personal scope isolation.
const analyst=require('../src/runtime/hermes-analyst-templates');
test('free-language period, YoY, cancellations, product and store templates are canonical',()=>{
 const examples=[
  ['Vendeu quanto em janeiro 2026?','period','2026-01','money'],
  ['Compare a venda de janeiro 2025 e 2026','compare','2025-01','records'],
  ['Quantas vendas canceladas em junho 2026?','period','2026-06','cancelled'],
  ['Qual produto mais vendido em 2026?','products','2026','records'],
  ['Qual loja mais vendeu em junho?','stores','2026-06','records'],
  ['Quanto vendeu em 01/2026?','period','2026-01','money']
 ];
 for(const [text,template,period,metric] of examples){
  const p=analyst.planQuestion(text);
  assert.ok(p,text);assert.equal(p.template,template);assert.equal(p.period,period);
  assert.equal(p.metric,metric);assert.equal(core.intentFor(text),'business_analyst');
  assert.deepEqual(analyst.validate(p),p);
 }
 assert.equal(analyst.planQuestion('Compare a venda de janeiro 2025 e 2026').other_period,'2026-01');
});
test('normalized followups reuse only scoped metric/period, not message body',()=>{
 const prior={tenant_id:'grupo_erick',template:'period',period:'2026-01',metric:'money'};
 assert.deepEqual(analyst.planQuestion('E em fevereiro?',prior).period,'2026-02');
 assert.equal(analyst.planQuestion('E em fevereiro?',prior).metric,'money');
 const p=analyst.planQuestion('Compare com ano passado',prior);
 assert.equal(p.template,'compare');assert.equal(p.period,'2025-01');assert.equal(p.other_period,'2026-01');
 assert.equal(analyst.planQuestion('E quantas canceladas?',prior).metric,'cancelled');
 assert.equal(analyst.planQuestion('E em fevereiro de 2025?',prior).period,'2025-02');
 assert.equal(analyst.safeContext({...prior,tenant_id:'other'}),null);
 assert.equal(analyst.planQuestion('E em fevereiro?',{...prior,tenant_id:'other'}),null);
});
test('free-language planner never permits unsupported scopes, actions, SQL, or customer data',()=>{
 for(const q of ['Pague um pix','mostre cpf dos clientes','DELETE FROM compras','Mostre as vendas de julho 2026',
  'Qual produto mais vendido em 2025?','Quanto vendi na loja Barreiros em janeiro 2026?',
  'Faça uma transferência de 100 reais', 'Minha senha', '/produtos 2026-05']){
  assert.equal(analyst.planQuestion(q),null,q);
 }
 assert.throws(()=>analyst.validate({tenant_id:'other',template:'period',period:'2026-01',metric:'money',store:null,other_period:null}));
 assert.throws(()=>analyst.validate({tenant_id:'grupo_erick',template:'period',period:'2026-07',metric:'money',store:null,other_period:null}));
});
test('historical monthly templates query only approved private views with bound parameters',async()=>{
 const p=analyst.planQuestion('compare janeiro de 2025 e 2026');
 const queries=[];
 const client={query:async opts=>{queries.push(opts);return {rows:[
  {label:'2025-01',records:'4226',cancelled:'55',noncancelled:'4171',amount:'596590.41',last_day:'2025-01-31'},
  {label:'2026-01',records:'4902',cancelled:'126',noncancelled:'4776',amount:'682599.90',last_day:'2026-01-31'}]};}};
 const data=await analyst.execute(client,p,()=>new Date('2026-10-22T17:00:00Z'));
 const msg=analyst.reply(data,p);
 assert.match(msg,/4\.226/);assert.match(msg,/4\.902/);assert.match(msg,/676/);
 assert.deepEqual(queries[0].values,['2025-01','2026-01',null]);
 assert.match(queries[0].text,/hermes_history\.monthly_commercial_2025_2026_v1/);
 assert.doesNotMatch(queries[0].text,/softcom_import|select \*|cadastro_clientes/i);
 assert.equal(queries[0].query_timeout,5000);
});
test('monetary reply labels valor_pago and refuses misrepresented revenue',async()=>{
 const p=analyst.planQuestion('Vendeu quanto em janeiro 2026?');
 const data=await analyst.execute({query:async()=>({rows:[{
  records:'4902',cancelled:'126',noncancelled:'4776',amount:'682599.90',last_day:'2026-01-31'
 }]})},p);
 const answer=analyst.reply(data,p);
 assert.match(answer,/682\.599,90/);
 assert.match(answer,/NÃO|não é faturamento/);
 assert.match(answer,/valor_pago/);
 assert.throws(()=>analyst.reply({...data,source:'softcom_import.cadastro_clientes'},p));
});
test('analyst query never accepts arbitrary response identifiers or malformed aggregates',async()=>{
 const p=analyst.planQuestion('qual loja mais vendeu em junho 2026');
 for(const rows of [
  [{label:'UNKNOWN',records:'100',cancelled:'0',noncancelled:'100',amount:'0',last_day:'2026-06-08'}],
  [{label:'CALCADOS',records:'10',cancelled:'11',noncancelled:'0',amount:'0',last_day:'2026-06-08'}],
  Array.from({length:7},()=>({label:'CALCADOS',records:'1',cancelled:'0',noncancelled:'1',amount:'0',last_day:'2026-06-08'}))
 ]){
  await assert.rejects(analyst.execute({query:async()=>({rows})},p));
 }
});
test('owner-only analyst conversation writes safe followup context',async()=>{
 const messages=[],records=[];
 const p=analyst.planQuestion('Quantas vendas canceladas em junho 2026?');
 const result={tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.SOURCE,
  at:'2026-10-22T17:00:00Z',plan:p,rows:[{records:1334,cancelled:58,amount:165352.11,last_day:'2026-06-08'}]};
 const resultBase={...result,rows:[{...result.rows[0]}]};
 const ownerUpdate=update(30001,700,'Quantas vendas canceladas em junho 2026?');
 await core.processUpdate({update:ownerUpdate,ownerId:700,
  send:async(id,msg)=>messages.push(msg),query:async()=>{throw Error('wrong tool')},
  readAnalyst:async()=>resultBase,
  readAnalystContext:async()=>null,writeAnalystContext:async ctx=>records.push(ctx)});
 assert.match(messages[0],/58/);assert.equal(records[0].period,'2026-06');
 assert.equal(records[0].metric,'cancelled');
 assert.equal(Object.keys(records[0]).includes('text'),false);
 messages.length=0;
 await core.processUpdate({update:update(30002,701,'Quantas vendas canceladas em junho 2026?'),ownerId:700,
  send:async(id,msg)=>messages.push(msg),query:async()=>{},readAnalyst:async()=>{throw Error('leak')},
  readAnalystContext:async()=>{throw Error('leak')}});
 assert.equal(messages.length,0);
});

test('analyst caches canonical questions for six hours without a second DB read or storing message bodies',async()=>{
 const state=dir();fs.chmodSync(state,0o700);
 runner.saveState(state,'owner.json',{owner_id:700});
 const replies=[];
 let updates=0,dbReads=0;
 const request=analyst.planQuestion('Vendeu quanto em janeiro 2026');
 const source={tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.SOURCE,
  at:'2026-10-22T14:00:00Z',plan:request,
  rows:[{records:4902,cancelled:126,amount:682599.90,last_day:'2026-01-31'}]};
 const api=async(method,payload)=>{
  if(method==='getUpdates'){
   updates++;return [update(70000+updates,700,updates===1?'Vendeu quanto em janeiro 2026?':'Quanto vendeu em janeiro de 2026?')];
  }
  if(method==='sendMessage')replies.push(payload.text);
 };
 try{
  for(let i=0;i<2;i++)await runner.pollOnce({
   stateDir:state,api,clock:()=>Date.parse('2026-10-22T14:00:00Z'),liveEnabled:true,
   query:async()=>{throw Error('unexpected generic query')},
   readLive:async p=>{dbReads++;assert.equal(p.shape,'analyst');return source;}
  });
  assert.equal(dbReads,1);
  assert.equal(replies.length,2);
  assert.match(replies[1],/cache validado/);
  const contents=fs.readFileSync(path.join(state,'history-analyst-cache.json'),'utf8');
  assert.ok(Buffer.byteLength(contents)<=16384);
  assert.doesNotMatch(contents,/Vendeu quanto|Quanto vendeu/);
  assert.equal(fs.statSync(path.join(state,'history-analyst-cache.json')).mode&0o777,0o600);
  assert.equal(runner.loadState(state,'history-live-budget.json').count,1);
  assert.equal(runner.loadState(state,'history-analyst-context.json').metric,'money');
 }finally{fs.rmSync(state,{recursive:true,force:true});}
});
test('analyst followup in owner session retains monetary metric when month changes',async()=>{
 const state=dir();fs.chmodSync(state,0o700);runner.saveState(state,'owner.json',{owner_id:700});
 const sent=[];
 let used=null;
 runner.saveState(state,'history-analyst-context.json',{tenant_id:'grupo_erick',template:'period',metric:'money',period:'2026-01'});
 try{
  await runner.pollOnce({
   stateDir:state,clock:()=>Date.parse('2026-10-22T14:00:00Z'),liveEnabled:true,
   api:async(method,payload)=>{
    if(method==='getUpdates')return [update(81000,700,'E em fevereiro?')];
    if(method==='sendMessage')sent.push(payload.text);
   },query:async()=>{},
   readLive:async p=>{
    used=p.plan;
    return {tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.SOURCE,
     at:'2026-10-22T14:00:00Z',plan:p.plan,
     rows:[{records:3983,cancelled:94,amount:505200.50,last_day:'2026-02-28'}]};
   }
  });
  assert.equal(used.period,'2026-02');
  assert.equal(used.metric,'money');
  assert.match(sent[0],/505\.200,50/);
  assert.equal(runner.loadState(state,'history-analyst-context.json').period,'2026-02');
 }finally{fs.rmSync(state,{recursive:true,force:true});}
});

test('follow-up topic stays products, stores, or YoY comparison unless user explicitly switches',()=>{
 const contexts=[
  [{tenant_id:'grupo_erick',template:'products',period:'2026',metric:'records'},'E em fevereiro?',
   {template:'products',period:'2026-02',metric:'records',other_period:null}],
  [{tenant_id:'grupo_erick',template:'stores',period:'2026-06',metric:'records'},'E em maio?',
   {template:'stores',period:'2026-05',metric:'records',other_period:null}],
  [{tenant_id:'grupo_erick',template:'compare',period:'2025-01',other_period:'2026-01',metric:'money'},'E em fevereiro?',
   {template:'compare',period:'2025-02',other_period:'2026-02',metric:'money'}],
  [{tenant_id:'grupo_erick',template:'period',period:'2026-01',metric:'money',store:'CALCADOS'},'E em fevereiro?',
   {template:'period',period:'2026-02',store:'CALCADOS',metric:'money'}],
  [{tenant_id:'grupo_erick',template:'products',period:'2026',metric:'records'},'E quanto vendeu em fevereiro?',
   {template:'period',period:'2026-02',metric:'money'}]
 ];
 for(const [prior,q,expected] of contexts){
  const plan=analyst.planQuestion(q,prior);
  assert.ok(plan,q);for(const [k,v] of Object.entries(expected))assert.equal(plan[k],v,q+' '+k);
  assert.deepEqual(analyst.validate(plan),plan);
 }
 const invalid={tenant_id:'grupo_erick',template:'compare',period:'2025-01',metric:'money'};
 assert.equal(analyst.safeContext(invalid),null);
 assert.equal(analyst.safeContext({...invalid,other_period:'2026-07'}),null);
 assert.equal(analyst.safeContext({...invalid,other_period:'2026-01',store:'DROP TABLE'}),null);
});
test('owner-only sequential product question followed by month retains product intent and source',async()=>{
 const state=dir();fs.chmodSync(state,0o700);runner.saveState(state,'owner.json',{owner_id:700});
 const questions=['Qual produto mais vendido em 2026?','E em fevereiro?'];
 let round=0;const plans=[],sent=[];
 try{
  for(let i=0;i<questions.length;i++)await runner.pollOnce({
   stateDir:state,liveEnabled:true,clock:()=>Date.parse('2026-10-22T18:00:00Z')+i*1000,
   api:async(method,payload)=>{
    if(method==='getUpdates')return [update(99000+(++round),700,questions[i])];
    if(method==='sendMessage')sent.push(payload.text);
   },query:async()=>{throw Error('wrong_connector')},
   readLive:async payload=>{
    assert.equal(payload.shape,'analyst');
    const p=payload.plan;plans.push(p);
    return {tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.PRODUCT_SOURCE,
     at:'2026-10-22T18:00:00Z',plan:p,
     rows:[{code:'32452',name:'PRODUTO PROMOCIONAL GRUPO ERICK',items:25}]};
   }
  });
  assert.deepEqual(plans.map(p=>p.template),['products','products']);
  assert.deepEqual(plans.map(p=>p.period),['2026','2026-02']);
  assert.match(sent[1],/Produtos por registros/);
  assert.doesNotMatch(sent[1],/Registros: 3\.983/);
  assert.equal(runner.loadState(state,'history-analyst-context.json').template,'products');
  assert.equal(runner.loadState(state,'history-live-budget.json').count,2);
 }finally{fs.rmSync(state,{recursive:true,force:true});}
});
test('period totals do not duplicate the requested count when cancellations are the metric',async()=>{
 const p=analyst.planQuestion('Quantas vendas canceladas em junho 2026?');
 const data=await analyst.execute({query:async()=>({rows:[{
  records:'1334',cancelled:'58',noncancelled:'1276',amount:'165352.11',last_day:'2026-06-08'
 }]})},p);
 const answer=analyst.reply(data,p);
 assert.equal((answer.match(/\b58\b/g)||[]).length,1);
 assert.match(answer,/Total de registros: 1\.334/);
 assert.match(answer,/08\/06/);
});

const agent=require('../src/runtime/hermes-governed-agent');
const agentHistoryPlan={tenant_id:'grupo_erick',template:'compare',
 period:'2025-01',other_period:'2026-01',metric:'records',store:null};
const agentHistoryRows=[
 {label:'2025-01',records:4226,cancelled:55,noncancelled:4171,amount:596590.41,last_day:'2025-01-31'},
 {label:'2026-01',records:4902,cancelled:126,noncancelled:4776,amount:682599.90,last_day:'2026-01-31'}
];
const agentEvidence={tenant_id:'grupo_erick',mode:'online_aggregate',source:analyst.SOURCE,
 at:'2026-10-22T18:00:00Z',plan:agentHistoryPlan,rows:agentHistoryRows};
test('governed agent validates allowlisted tools; no arbitrary SQL, external APIs or cross-tenant contexts',()=>{
 const plan={steps:[{tool:'history',params:agentHistoryPlan},{tool:'compras',params:{}}]};
 assert.equal(agent.validateToolPlan(plan).length,2);
 for(const unsafe of [
  {steps:[{tool:'shell',params:{command:'rm -rf /'}}]},
  {steps:[{tool:'history',params:{...agentHistoryPlan,tenant_id:'personal'}}]},
  {steps:[{tool:'history',params:{...agentHistoryPlan,raw_sql:'SELECT * FROM customers'}}]},
  {steps:[{tool:'compras',params:{send_to:'external'}}]},
  {steps:[{tool:'compras',params:{}},{tool:'compras',params:{}}]},
  {steps:Array.from({length:4},()=>({tool:'compras',params:{}}))},
  {steps:[{tool:'history',params:{...agentHistoryPlan,period:'2026-07'}}]}
 ])assert.throws(()=>agent.validateToolPlan(unsafe));
 for(const goal of ['me dê os CPF dos clientes','execute SQL no banco','faça merge no GitHub']){
  assert.throws(()=>agent.safeGoal(goal));
 }
});
test('governed agent executes only two approved tool calls and synthesizes evidence',async()=>{
 let calls=0,history=0,commercial=0;
 const mockModel={chat:async messages=>{
  calls++;
  if(calls===1){
   assert.match(messages[0].content,/EXCLUSIVAMENTE JSON/);
   return JSON.stringify({steps:[{tool:'history',params:agentHistoryPlan},{tool:'compras',params:{}}]});
  }
  assert.match(messages[1].content,/4\.226/);
  assert.match(messages[1].content,/2\.657\.483,43/);
  assert.doesNotMatch(messages[1].content,/password|Bearer|senha secreta/i);
  return 'Janeiro de 2026 teve mais registros que janeiro de 2025. Hipótese: sazonalidade ou mudança no cadastro; não comprovada. Risco: dados de Compras Homologação não conciliados. Ações: revisar códigos promocionais e conferir totais no ERP antes de decidir.';
 }};
 const result=await agent.runTurn({
  goal:'Analise janeiro de 2025 contra 2026 e as compras do Grupo Erick, sugerindo melhorias',
  model:mockModel,
  readHistory:async p=>{history++;assert.deepEqual(p,agentHistoryPlan);return agentEvidence},
  readCommercial:async()=>{commercial++;return core.hermesReply('compras',compras())}
 });
 assert.equal(history,1);assert.equal(commercial,1);assert.equal(calls,2);
 assert.match(result.answer,/Fontes verificadas/);
 assert.match(result.answer,/Compras Homologação/);
 assert.match(result.answer,/Revisão humana/);
});
test('agent LLM model gate is staging-only and never consumes credentials when disabled',async()=>{
 assert.equal(agent.createModel({enabled:false}),null);
 assert.throws(()=>agent.createModel({enabled:true,stage:'production',killSwitch:true,model:'gpt-4.1-mini',key:'sk-123456789012345678901234'}));
 assert.throws(()=>agent.createModel({enabled:true,stage:'staging',killSwitch:false,model:'gpt-4.1-mini',key:'sk-123456789012345678901234'}));
 assert.throws(()=>agent.createModel({enabled:true,stage:'staging',killSwitch:true,model:'unapproved',key:'sk-123456789012345678901234'}));
 assert.throws(()=>agent.createModel({enabled:true,stage:'staging',killSwitch:true,model:'gpt-4.1-mini',key:'x'}));
 const requests=[];
 const model=agent.createModel({enabled:true,stage:'staging',killSwitch:true,
  model:'gpt-4.1-mini',key:'sk-123456789012345678901234',fetchImpl:async(u,req)=>{
   requests.push({url:u,req});const data={choices:[{message:{content:'{"steps":[]}'}}]};
   return {status:200,ok:true,headers:{get:()=>null},arrayBuffer:async()=>Buffer.from(JSON.stringify(data))};
  }});
 assert.equal(await model.chat([{role:'system',content:'Policy'},{role:'user',content:'Question'}],{maxTokens:650}),'{"steps":[]}');
 assert.equal(requests[0].url,'https://api.openai.com/v1/chat/completions');
 const body=JSON.parse(requests[0].req.body);
 assert.equal(body.store,false);
 assert.equal(body.max_completion_tokens,650);
 assert.equal(requests[0].req.redirect,'error');
 assert.deepEqual(JSON.parse(requests[0].req.body).store,false);
 await model.chat([{role:'system',content:'Output JSON'},{role:'user',content:'Plan only'}],{maxTokens:650,jsonMode:true});
 assert.deepEqual(JSON.parse(requests[1].req.body).response_format,{type:'json_object'});
});
test('unknown intents reach the governed agent only with opt-in and owner verification',async()=>{
 const text='Analise o desempenho empresarial e recomende melhorias para o Grupo Erick';
 const replies=[];let agentCalls=0;
 const base={update:update(990111,700,text),ownerId:700,query:async()=>{},
  send:async(_,msg)=>replies.push(msg),
  readAgent:async()=>{agentCalls++;return {answer:'🧠 Hermes — análise orientada por evidências\n\nDiagnóstico limitado com evidências verificadas.'}}};
 await core.processUpdate({...base,agentEnabled:false});
 assert.equal(agentCalls,0);assert.match(replies[0],/não tenho essa operação/);
 replies.length=0;
 await core.processUpdate({...base,agentEnabled:true});
 assert.equal(agentCalls,1);assert.match(replies[0],/Diagnóstico limitado/);
 replies.length=0;
 await core.processUpdate({...base,update:update(990112,701,text),agentEnabled:true});
 assert.equal(agentCalls,1);assert.equal(replies.length,0);
});
test('runner reserves daily agent budget before model calls and never stores text in private state',async()=>{
 const state=dir();fs.chmodSync(state,0o700);runner.saveState(state,'owner.json',{owner_id:700});
 const goal='Analise janeiro 2025 contra 2026 e compras e me dê recomendações';
 const messages=[];let turn=0,history=0,commercial=0;
 const model={chat:async messages=>{
  if(messages[0].content.includes('EXCLUSIVAMENTE JSON'))
   return JSON.stringify({steps:[{tool:'history',params:agentHistoryPlan},{tool:'compras',params:{}}]});
  return 'Houve crescimento de registros, mas não prova crescimento do lucro. Hipótese de melhora comercial, ainda não comprovada. Risco na conciliação entre fontes. Recomendo conciliar amostras, revisar promoções e validar despesas.';
 }};
 const clock=()=>Date.parse('2026-10-22T18:00:00Z');
 try{
  for(let i=0;i<5;i++)await runner.pollOnce({
   stateDir:state,clock,liveEnabled:true,agentModel:model,
   api:async(method,payload)=>{
    if(method==='getUpdates')return [update(99100+(++turn),700,goal)];
    if(method==='sendMessage')messages.push(payload.text);
   },
   query:async(intent,route)=>{
    commercial++;assert.equal(intent,'compras');assert.equal(route,core.ROUTES.compras);
    return compras();
   },
   readLive:async params=>{
    history++;assert.equal(params.shape,'analyst');return agentEvidence;
   }
  });
  assert.equal(history,4);
  assert.equal(commercial,4);
  assert.equal(messages.length,5);
  assert.match(messages[4],/limite privado de 4 análises com Codex/);
  assert.deepEqual(runner.loadState(state,'agent-llm-budget.json'),{date:'2026-10-22',turns:4});
  const files=fs.readdirSync(state).filter(x=>x.endsWith('.json'));
  for(const name of files)assert.doesNotMatch(fs.readFileSync(path.join(state,name),'utf8'),/Analise janeiro 2025/);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});

test('matched cancellation rate advice uses verified read without consuming LLM quota',async()=>{
 const text='Compare as taxas de cancelamento de janeiro a maio de 2025 e 2026 do Grupo Erick. Informe os totais de registros, cancelados, percentuais e variação em pontos percentuais. Explique os riscos e recomende três ações prioritárias, sem confundir cancelamentos com perdas financeiras.';
 assert.equal(core.cancellationRateRequest(text),true);
 for(const q of [
  'Analise os riscos de cancelamentos 2025 e 2026 sem taxas',
  'Compare taxa de cancelamentos de janeiro a junho de 2025 e 2026',
  'Compare taxa de cancelamentos de janeiro a maio de 2025 e 2027',
  'Compare taxa de cancelamentos de janeiro a maio de 2025 e 2026 com CPF',
  '/historico',
 ])assert.equal(core.cancellationRateRequest(q),false,q);
 const state=dir();fs.chmodSync(state,0o700);
 runner.saveState(state,'owner.json',{owner_id:700});
 runner.saveState(state,'agent-llm-budget.json',{date:'2026-10-22',turns:4});
 const responses=[],history=[];
 const clock=()=>Date.parse('2026-10-22T20:30:00Z');
 const fixture={tenant_id:'grupo_erick',mode:'online_aggregate',
  source:analyst.SOURCE,at:new Date(clock()).toISOString(),
  plan:{tenant_id:'grupo_erick',template:'compare',period:'2025',other_period:'2026',metric:'cancelled',store:null},
  rows:[
   {label:'2025',records:21940,cancelled:238,amount:2730133.04,last_day:'2025-05-31'},
   {label:'2026',records:24148,cancelled:623,amount:2956645.04,last_day:'2026-05-31'}]};
 try{
  await runner.pollOnce({
   stateDir:state,clock,agentModel:{chat:async()=>{throw Error('LLM_MUST_NOT_RUN')}},
   liveEnabled:true,query:async()=>{throw Error('OTHER_DOMAIN_DENIED')},
   readLive:async arg=>{history.push(arg);return fixture},
   api:async(method,payload)=>{
    if(method==='getUpdates')return [update(330001,700,text)];
    if(method==='sendMessage')responses.push(payload.text);
   }
  });
  assert.equal(history.length,1);
  assert.deepEqual(history[0].plan,fixture.plan);
  assert.equal(responses.length,1);
  for(const expected of ['21.940 registros','24.148 registros','1,08%','2,58%',
   '+1,50 pontos percentuais','Orientações padronizadas']){
   assert.ok(responses[0].includes(expected),expected);
  }
  assert.deepEqual(runner.loadState(state,'agent-llm-budget.json'),{date:'2026-10-22',turns:4});
  assert.equal(runner.loadState(state,'history-live-budget.json').count,1);
  const events=fs.readFileSync(path.join(state,'audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).intent,'business_cancel_rate');
  assert.equal(fs.statSync(path.join(state,'history-live-budget.json')).mode&0o777,0o600);
  assert.doesNotMatch(fs.readFileSync(path.join(state,'audit.jsonl'),'utf8'),/Compare as taxas/);
  await core.processUpdate({update:update(330002,701,text),ownerId:700,
   query:async()=>{},send:async()=>{throw Error('sent_to_nonowner')},
   readAnalyst:async()=>{throw Error('nonowner_query')}});
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});
test('cancellation rate guard preserves the history quota and fails closed',async()=>{
 const text='Compare as taxas de cancelamento de janeiro a maio de 2025 e 2026 e recomende ações';
 const out=[];
 const base={update:update(340001,700,text),ownerId:700,
  query:async()=>{},send:async(_,msg)=>out.push(msg),
  agentEnabled:true,readAgent:async()=>{throw Error('LLM_DENIED')}};
 await core.processUpdate({...base,readAnalyst:async()=>({denied_status:'history_budget_exhausted'})});
 assert.match(out.pop(),/Limite diário de consultas históricas/);
 await core.processUpdate({...base,readAnalyst:async()=>{throw Error('SQL_FAILED')}});
 assert.match(out.pop(),/não pôde ser validada/);
});

const codexBridge=require('../src/runtime/hermes-codex-login-bridge');
test('Codex login provider is disabled by default and requires staging read-only gate',()=>{
 assert.equal(codexBridge.createCodexModel({enabled:false}),null);
 for(const t of [
  {enabled:true,stage:'production',killSwitch:true,socketPath:codexBridge.SOCKET},
  {enabled:true,stage:'staging',killSwitch:false,socketPath:codexBridge.SOCKET},
  {enabled:true,stage:'staging',killSwitch:true,socketPath:'/tmp/fake.sock'}
 ])assert.throws(()=>codexBridge.createCodexModel(t));
 assert.throws(()=>codexBridge.validateMessages([{role:'system',content:'Policy'},{role:'user',content:'Prompt'}],1500,false));
 assert.throws(()=>codexBridge.validateMessages([{role:'system',content:'Policy'},{role:'admin',content:'Prompt'}],650,false));
});
test('Codex login local Unix socket integration returns typed answer and rejects malformed calls',async()=>{
 const location=dir(),socket=path.join(location,'private.sock');
 const seen=[];
 const service=codexBridge.createBridgeServer({socketPath:socket,run:async payload=>{
  seen.push(payload);
  return '{"steps":[]}';
 }});
 try{
  await service.listen();
  assert.equal(fs.statSync(socket).mode&0o777,0o600);
  const invoke=async body=>new Promise((resolve,reject)=>{
   const http=require('node:http');
   const data=JSON.stringify(body);
   const req=http.request({method:'POST',socketPath:socket,path:'/v1/complete',
    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{
    let buf='';res.on('data',c=>buf+=c.toString());res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(buf)}));
   });
   req.on('error',reject);req.end(data);
  });
  const valid={messages:[{role:'system',content:'JSON only'},{role:'user',content:'Plan safe tools'}],maxTokens:650,jsonMode:true};
  const good=await invoke(valid);
  assert.equal(good.status,200);assert.equal(good.body.text,'{"steps":[]}');
  assert.deepEqual(seen[0],valid);
  const denied=await invoke({...valid,unexpected:'sql'});
  assert.equal(denied.status,400);
 }finally{await service.close();fs.rmSync(location,{force:true,recursive:true});}
});

// Business analyst coverage equivalence and narrow enterprise memory.
const businessEvidence=require('../src/runtime/hermes-business-evidence-memory');
test('year-on-year history compares only January through May of both years',async()=>{
 const p={tenant_id:'grupo_erick',template:'compare',period:'2025',
  other_period:'2026',metric:'money',store:null};
 let sql=null;
 const data=await analyst.execute({query:async query=>{
  sql=query;
  return {rows:[
   {label:'2025',records:'21940',cancelled:'238',noncancelled:'21702',
    amount:'2730133.04',last_day:'2025-05-31'},
   {label:'2026',records:'24148',cancelled:'623',noncancelled:'23525',
    amount:'2956645.04',last_day:'2026-05-31'}]};
 }},p,()=>new Date('2026-10-22T19:00:00Z'));
 assert.deepEqual(sql.values,['2025','2026',null]);
 assert.match(sql.text,/RIGHT\(month,2\) BETWEEN '01' AND '05'/);
 const txt=analyst.reply(data,p);
 assert.match(txt,/janeiro a maio de cada ano/);
 assert.match(txt,/utiliza apenas janeiro–maio completos nos dois anos/);
 assert.doesNotMatch(txt,/podem não ter cobertura equivalente/);
 assert.match(txt,/2\.730\.133,04/);
 assert.match(txt,/2\.956\.645,04/);
 assert.doesNotMatch(txt,/-62,5%/);
});
test('annual cancelled comparisons expose verified denominators, rates and pp delta to the LLM',async()=>{
 const p={tenant_id:'grupo_erick',template:'compare',period:'2025',
  other_period:'2026',metric:'cancelled',store:null};
 const data=await analyst.execute({query:async()=>({rows:[
  {label:'2025',records:'21940',cancelled:'238',noncancelled:'21702',
   amount:'2730133.04',last_day:'2025-05-31'},
  {label:'2026',records:'24148',cancelled:'623',noncancelled:'23525',
   amount:'2956645.04',last_day:'2026-05-31'}]})},
  p,()=>new Date('2026-10-22T20:00:00Z'));
 const txt=analyst.reply(data,p);
 assert.match(txt,/21\.940 registros/);
 assert.match(txt,/24\.148 registros/);
 assert.match(txt,/1,08%/);
 assert.match(txt,/2,58%/);
 assert.match(txt,/\+1,50 pontos percentuais/);
 assert.match(txt,/não mede perda financeira/);
 const withoutBase={...data,rows:data.rows.map(r=>({...r,records:0,cancelled:0}))};
 const empty=analyst.reply(withoutBase,p);
 assert.match(empty,/indefinida \(sem registros\)/);
 assert.doesNotMatch(empty,/Variação da taxa/);
});
test('June partial YoY and annual separately queried years are denied before SQL',async()=>{
 const bad={tenant_id:'grupo_erick',template:'compare',period:'2025-06',
  other_period:'2026-06',metric:'records',store:null};
 assert.throws(()=>analyst.validate(bad),/partial_month/);
 await assert.rejects(analyst.execute({query:async()=>{throw Error('query_called');}},bad),/partial_month/);
 const year=(y)=>({tenant_id:'grupo_erick',template:'period',period:y,
  other_period:null,metric:'money',store:null});
 assert.throws(()=>agent.validateToolPlan({steps:[
  {tool:'history',params:year('2025')},
  {tool:'history',params:year('2026')}
 ]}),/unmatched_year/);
 assert.equal(agent.validateToolPlan({steps:[{tool:'history',params:{
  ...bad,period:'2025',other_period:'2026'}}]}).length,1);
});
test('business memory persists only source-verified aggregates and is enterprise-scoped',()=>{
 const now=Date.parse('2026-10-22T18:00:00Z');
 const memo=businessEvidence.observe(null,agentEvidence,agentHistoryPlan,now);
 assert.equal(memo.entries.length,1);
 assert.equal(memo.entries[0].tenant_id,'grupo_erick');
 assert.equal(memo.entries[0].scope,'enterprise');
 assert.equal(memo.entries[0].source,analyst.SOURCE);
 assert.equal(typeof memo.entries[0].key,'string');
 assert.ok(!JSON.stringify(memo).includes('Objetivo empresarial:'));
 assert.match(businessEvidence.context(memo,'Analise janeiro 2025 e 2026',now),/2025-01/);
 assert.deepEqual(JSON.parse(businessEvidence.context(memo,'me diga sobre vendas 2024',now)),[]);
 assert.deepEqual(businessEvidence.validStore(memo,now+15*86400000).entries,[]);
 assert.throws(()=>businessEvidence.validStore({...memo,tenant_id:'personal'},now));
 assert.throws(()=>businessEvidence.validStore({...memo,entries:[{...memo.entries[0],source:'softcom_import.clientes'}]},now));
 assert.throws(()=>businessEvidence.normalizeEntry({...agentEvidence,source:'softcom_import.clientes'},agentHistoryPlan,now));
});
test('owner business memory is restored on a later agent turn without persisting Telegram messages',async()=>{
 const state=dir();fs.chmodSync(state,0o700);runner.saveState(state,'owner.json',{owner_id:700});
 let step=0,reads=0,apiCalls=0;const captured=[],responses=[];
 const clock=()=>Date.parse('2026-10-22T18:00:00Z');
 const goal='Analise comercialmente janeiro de 2025 e janeiro de 2026 do grupo Erick';
 const model={chat:async messages=>{
  step++;
  if(messages[0].content.includes('EXCLUSIVAMENTE JSON')){
   captured.push(messages[1].content);
   return JSON.stringify({steps:[{tool:'history',params:agentHistoryPlan}]});
  }
  return 'Dados mostram mais registros em janeiro de 2026; hipótese de expansão de operações, não comprovada. Ação segura: conferir cancelamentos e tipos de produtos antes de decidir.';
 }};
 try{
  for(let i=0;i<2;i++)await runner.pollOnce({
   stateDir:state,clock,agentModel:model,liveEnabled:true,
   api:async(method,payload)=>{
    if(method==='getUpdates'){apiCalls++;return [update(170000+apiCalls,700,goal)];}
    if(method==='sendMessage')responses.push(payload.text);
   },
   readLive:async p=>{reads++;assert.equal(p.shape,'analyst');return agentEvidence;},
   query:async()=>{throw Error('wrong_source')}
  });
  assert.equal(reads,2);
  assert.equal(responses.length,2);
  assert.match(captured[1],/Registros empresariais históricos/);
  assert.match(captured[1],/4\.226/);
  const saved=runner.loadState(state,'business-evidence-memory.json');
  assert.equal(saved.entries.length,1);
  assert.equal(fs.statSync(path.join(state,'business-evidence-memory.json')).mode&0o777,0o600);
  assert.doesNotMatch(fs.readFileSync(path.join(state,'business-evidence-memory.json'),'utf8'),/Analise comercialmente/);
  assert.equal(runner.loadState(state,'agent-llm-budget.json').turns,2);
 }finally{fs.rmSync(state,{force:true,recursive:true});}
});

test('advisory intent has precedence over numeric template without hijacking direct queries',async()=>{
 const cases=[
  'Considerando a análise de 2025 e 2026 que você acabou de fazer, quais problemas merecem prioridade? Consulte as evidências e explique.',
  'Compare janeiro a maio de 2025 e 2026, incluindo vendas e cancelamentos. Identifique os principais riscos.',
  'Analise as vendas em janeiro de 2026 e sugira melhorias',
  'Com base nos dados de 2025 e 2026, explique os riscos',
  'Quais insights e prioridades para as lojas em junho de 2026?'
 ];
 for(const q of cases)assert.equal(core.advisoryRequest(q),true,q);
 for(const q of [
  'Compare vendas em janeiro de 2025 e 2026?',
  'Quantas vendas canceladas em junho de 2026?',
  '/vendas 2026-05','/produtos 2026-05',
  '/historico','/compras','/lotoia','/ajuda','/status'
 ])assert.equal(core.advisoryRequest(q),false,q);
 const answers=[];let askAgent=0,askAnalyst=0,readContext=0;
 const common={ownerId:700,query:async()=>{},agentEnabled:true,
  send:async(_,message)=>answers.push(message),
  readAgent:async()=>{askAgent++;return {answer:'🧠 Hermes — análise orientada por evidências\n\nProblemas priorizados a partir de dados verificados.'};},
  readAnalyst:async()=>{askAnalyst++;return agentEvidence;},
  readAnalystContext:async()=>{readContext++;return null;}};
 for(let i=0;i<cases.length;i++){
  const result=await core.processUpdate({...common,update:update(220000+i,700,cases[i])});
  assert.equal(result.intent,'governed_agent');
 }
 assert.equal(askAgent,cases.length);assert.equal(askAnalyst,0);
 assert.equal(readContext,0);
 const numerical=await core.processUpdate({...common,
  update:update(220500,700,'Compare vendas em janeiro de 2025 e 2026?')});
 assert.equal(numerical.intent,'business_analyst');
 assert.equal(askAnalyst,1);
 await core.processUpdate({...common,update:update(220600,701,cases[0]),
  readAgent:async()=>{throw Error('owner privacy violated');}});
 assert.equal(askAgent,cases.length);
});
test('two-message enterprise conversation remembers grounded evidence and routes followup to governed LLM',async()=>{
 const state=dir();fs.chmodSync(state,0o700);
 runner.saveState(state,'owner.json',{owner_id:700});
 const questions=[
  'Compare janeiro a maio de 2025 e 2026, incluindo vendas e cancelamentos. Identifique os principais riscos.',
  'Considerando a análise de 2025 e 2026 que você acabou de fazer, quais problemas merecem prioridade? Consulte as evidências e explique.'
 ];
 let index=0,reads=0,requests=0;
 const prompts=[],sent=[];
 const model={chat:async messages=>{
  if(messages[0].content.includes('EXCLUSIVAMENTE JSON')){
   prompts.push(messages[1].content);
   return JSON.stringify({steps:[{tool:'history',params:agentHistoryPlan}]});
  }
  return 'A comparação histórica indica crescimento de registros, mas exige investigar os cancelamentos por loja. Hipótese ainda não comprovada. Prioridade: verificar cancelamentos, conferir códigos de loja e conciliar o indicador financeiro.';
 }};
 const clock=()=>Date.parse('2026-10-22T19:19:20Z');
 try{
  for(index=0;index<2;index++)await runner.pollOnce({
   stateDir:state,clock,agentModel:model,liveEnabled:true,
   api:async(method,payload)=>{
    if(method==='getUpdates')return [update(230000+(++requests),700,questions[index])];
    if(method==='sendMessage')sent.push(payload.text);
   },
   readLive:async p=>{reads++;assert.equal(p.shape,'analyst');return agentEvidence;},
   query:async()=>{throw Error('unpermitted tool')},
  });
  assert.equal(sent.length,2);
  for(const answer of sent)assert.match(answer,/🧠 Hermes — análise orientada por evidências/);
  assert.equal(reads,2);
  assert.equal(prompts.length,2);
  assert.match(prompts[1],/Registros empresariais históricos anteriores/);
  assert.match(prompts[1],/4\.226/);
  assert.equal(runner.loadState(state,'agent-llm-budget.json').turns,2);
  const memory=runner.loadState(state,'business-evidence-memory.json');
  assert.equal(memory.entries.length,1);
  assert.equal(fs.statSync(path.join(state,'business-evidence-memory.json')).mode&0o777,0o600);
  const body=fs.readFileSync(path.join(state,'business-evidence-memory.json'),'utf8');
  assert.doesNotMatch(body,/Considerando a análise|Identifique os principais riscos/);
 }finally{fs.rmSync(state,{recursive:true,force:true});}
});


test('three verified long enterprise observations fit bounded context instead of denying agent',()=>{
 const now=Date.parse('2026-10-22T20:30:00Z');
 const prototype=businessEvidence.normalizeEntry(agentEvidence,agentHistoryPlan,now);
 const entries=[0,1,2].map((i)=>({
  ...prototype,
  key:String(i).padStart(24,'0'),
  summary:'📊 Hermes — comparação de registros e valores historicos. '+
   ('Observação agregada verificada com proveniência, sem dados pessoais. ').repeat(13)
 }));
 const store={schema:businessEvidence.SCHEMA,tenant_id:'grupo_erick',scope:'enterprise',entries};
 const previous=businessEvidence.context(store,'Quais problemas de 2025 e 2026 merecem prioridade?',now);
 const found=JSON.parse(previous);
 assert.ok(previous.length<=1500);
 assert.equal(found.length,3);
 assert.ok(found.every(x=>x.source===analyst.SOURCE&&x.scope==='enterprise'&&x.summary.length>=48));
 assert.equal(JSON.parse(businessEvidence.context(store,'compare 2024',now)).length,0);
 assert.throws(()=>businessEvidence.context({...store,tenant_id:'personal'},'2025',now));
});

// Human-confirmed private enterprise decisions are separate from Agent Memory Registry.
// They must never be inferred from model output or from ordinary Telegram messages.
const decisionMemory=require('../src/runtime/hermes-owner-decision-memory');
test('enterprise decision memory requires explicit human proposal and second confirmation',()=>{
 const stamp=Date.parse('2026-10-22T21:00:00Z');
 const proposal='/decisao propor compras | Revisar títulos em aberto semanalmente | Evitar agir sobre valores não conciliados';
 const first=decisionMemory.handle(proposal,null,stamp,()=> '0123456789ab');
 assert.equal(first.changed,true);
 assert.equal(first.store.entries.length,0);
 assert.match(first.reply,/AINDA NÃO registrada/);
 assert.match(first.reply,/confirmar 0123456789ab/);
 assert.equal(first.store.pending.area,'compras');
 assert.equal(first.store.scope,'enterprise');
 const list=decisionMemory.handle('/decisoes',first.store,stamp);
 assert.match(list.reply,/Nenhuma decisão/);
 const confirmed=decisionMemory.handle('/decisao confirmar 0123456789ab',first.store,stamp+1000);
 assert.equal(confirmed.store.entries.length,1);
 assert.equal(confirmed.store.pending,null);
 assert.equal(confirmed.store.entries[0].source,'owner_confirmed_telegram');
 assert.match(confirmed.reply,/não autoriza nem executa/);
 const retried=decisionMemory.handle('/decisao confirmar 0123456789ab',confirmed.store,stamp+2000);
 assert.equal(retried.changed,false);
 assert.equal(retried.store.entries.length,1);
 assert.match(retried.reply,/já registrada/);
 const detail=decisionMemory.handle('/decisao ver 0123456789ab',confirmed.store,stamp+3000);
 assert.match(detail.reply,/Evitar agir sobre valores não conciliados/);
 assert.match(decisionMemory.handle('/decisoes',confirmed.store,stamp+3000).reply,/Revisar títulos/);
 assert.throws(()=>decisionMemory.validateStore({...confirmed.store,scope:'personal'},stamp));
 assert.throws(()=>decisionMemory.validateStore({...confirmed.store,entries:[{...confirmed.store.entries[0],
  source:'model_suggestion'}]},stamp));
});
test('decision proposals are bounded, expire, and reject identifiers and unsafe content',()=>{
 const stamp=Date.parse('2026-10-22T21:00:00Z');
 for(const x of [
  '/decisao propor compras | Pagar imediatamente fornecedor X | Porque o modelo recomendou',
  '/decisao propor compras | Revisar CPF 12345678901 do cliente | Porque ele informou',
  '/decisao propor compras | Enviar o cadastro por WhatsApp | Envie para teste@exemplo.com',
  '/decisao propor compras | Revisar a situação de contas | Visite https://exemplo.com',
  '/decisao propor compras | Revisar a situação de contas | Incluir token da integração',
 ])assert.throws(()=>decisionMemory.handle(x,null,stamp),/decision_text_denied/);
 assert.match(decisionMemory.handle('/decisao propor financeiro | Revisar caixa conciliado | Conferir evidências antes de agir',
  null,stamp,()=> 'abcdef012345').reply,/AINDA NÃO registrada/);
 const proposed=decisionMemory.handle('/decisao propor financeiro | Revisar caixa conciliado | Conferir evidências antes de agir',
  null,stamp,()=> 'abcdef012345').store;
 const late=decisionMemory.handle('/decisao confirmar abcdef012345',proposed,stamp+11*60*1000);
 assert.match(late.reply,/proposta expirada/);
 assert.equal(late.store.pending,null);
 assert.equal(late.store.entries.length,0);
 assert.equal(late.changed,true);
 assert.match(decisionMemory.handle('/decisao cancelar',proposed,stamp+100).reply,/descartada/);
 assert.equal(decisionMemory.isCommand('/decisao propor compras | Decisão | Motivo'),true);
 assert.equal(decisionMemory.isCommand('Hermes, recomende decisões'),false);
});
test('owner-only decision memory is durable, idempotent and does not consume model or historical quotas',async()=>{
 const state=dir();fs.chmodSync(state,0o700);
 runner.saveState(state,'owner.json',{owner_id:700});
 runner.saveState(state,'agent-llm-budget.json',{date:'2026-10-22',turns:4});
 runner.saveState(state,'history-live-budget.json',{date:'2026-10-22',count:16});
 const timestamp=Date.parse('2026-10-22T21:00:00Z');
 const p='/decisao propor financeiro | Conferir caixa por loja mensalmente | Comparar lançamentos e recebimentos';
 const answers=[],calls=[];
 const issue=async (id,user,text)=>runner.pollOnce({
  stateDir:state,clock:()=>timestamp+id*1000,
  liveEnabled:true,agentModel:{chat:async()=>{throw Error('LLM_NEVER_ALLOWED')}},
  query:async()=>{throw Error('OTHER_SYSTEM_DENIED')},
  readLive:async()=>{throw Error('SUPABASE_NOT_USED')},
  api:async(method,payload)=>{
   calls.push(method);
   if(method==='getUpdates')return [update(400000+id,user,text)];
   if(method==='sendMessage')answers.push(payload.text);
  }
 });
 try{
  await issue(1,701,p); // unauthorized: must neither reply nor persist
  assert.equal(answers.length,0);
  assert.equal(fs.existsSync(path.join(state,'owner-decisions.json')),false);
  await issue(2,700,p);
  assert.match(answers.at(-1),/AINDA NÃO registrada/);
  const saved=runner.loadState(state,'owner-decisions.json');
  assert.equal(saved.entries.length,0);
  assert.equal(saved.pending.area,'financeiro');
  assert.equal(fs.statSync(path.join(state,'owner-decisions.json')).mode&0o777,0o600);
  const code=saved.pending.id;
  await issue(3,700,'/decisao confirmar '+code);
  assert.match(answers.at(-1),/registrada por confirmação humana/);
  await issue(4,700,'/decisao confirmar '+code);
  assert.match(answers.at(-1),/já registrada/);
  await issue(5,700,'/decisoes');
  assert.match(answers.at(-1),/Conferir caixa por loja mensalmente/);
  const done=runner.loadState(state,'owner-decisions.json');
  assert.equal(done.entries.length,1);
  assert.equal(done.pending,null);
  assert.deepEqual(runner.loadState(state,'agent-llm-budget.json'),{date:'2026-10-22',turns:4});
  assert.deepEqual(runner.loadState(state,'history-live-budget.json'),{date:'2026-10-22',count:16});
  const log=fs.readFileSync(path.join(state,'audit.jsonl'),'utf8');
  assert.doesNotMatch(log,/Conferir caixa por loja mensalmente/);
  assert.doesNotMatch(log,/Comparar lançamentos e recebimentos/);
  assert.match(log,/"intent":"owner_decision"/);
  assert.equal(calls.filter(x=>x==='sendMessage').length,4);
  assert.equal(calls.filter(x=>x==='getUpdates').length,5);
 }finally{fs.rmSync(state,{force:true,recursive:true})}
});

test('confirmed decision becomes a bounded, read-only context, never pending or personal',()=>{
 const now=Date.parse('2026-10-22T21:20:00Z');
 const input='/decisao propor financeiro | Revisar compromissos após conciliação | Conferir os dados históricos no ERP antes de agir';
 const proposed=decisionMemory.handle(input,null,now,()=>'0123456789ab').store;
 assert.deepEqual(JSON.parse(decisionMemory.context(proposed,
  'Analise os riscos financeiros do Grupo Erick',now)),[]);
 const confirmed=decisionMemory.handle('/decisao confirmar 0123456789ab',
  proposed,now+1000).store;
 const relevant=decisionMemory.context(confirmed,'Quais riscos financeiros merecem prioridade?',now+2000);
 const parsed=JSON.parse(relevant);
 assert.equal(parsed.length,1);
 assert.equal(parsed[0].id,'0123456789ab');
 assert.equal(parsed[0].kind,'human_confirmed_decision');
 assert.equal(parsed[0].origin,'owner_confirmed_telegram');
 assert.equal(parsed[0].implementation_verified,false);
 assert.equal(parsed[0].operational_authority,false);
 assert.match(parsed[0].rationale,/dados históricos/);
 assert.ok(relevant.length<=1000);
 assert.equal(JSON.parse(decisionMemory.context(confirmed,'Quais campanhas de marketing são populares?',now+2000)).length,0);
 assert.throws(()=>decisionMemory.context({...confirmed,tenant_id:'personal'},'riscos financeiros',now));
 assert.throws(()=>decisionMemory.context({...confirmed,entries:[{...confirmed.entries[0],source:'agent_suggestion'}]},
  'riscos financeiros',now));
 assert.equal(decisionMemory.context(confirmed,'Quais riscos financeiros merecem prioridade?',now+2000),relevant);
});

test('governed agent contextualizes human decisions without treating them as business evidence or execution',async()=>{
 const stamp=Date.parse('2026-10-22T20:30:00Z');
 const proposed=decisionMemory.handle(
  '/decisao propor financeiro | Revisar compromissos após conciliação | Confirmar recebimentos no ERP antes de ampliar compromissos',
  null,stamp,()=>'112233aabbcc').store;
 const confirmed=decisionMemory.handle('/decisao confirmar 112233aabbcc',proposed,stamp+1000).store;
 let turns=0,history=0,decisionReads=0,commercial=0;
 const goal='Analise os principais riscos financeiros e recomende próximos passos';
 const model={chat:async messages=>{
  turns++;
  if(turns===1){
   assert.doesNotMatch(messages[1].content,/Revisar compromissos após conciliação/);
   return JSON.stringify({steps:[{tool:'history',params:agentHistoryPlan}]});
  }
  assert.match(messages[0].content,/Decisões humanas confirmadas/);
  assert.match(messages[1].content,/112233aabbcc/);
  assert.match(messages[1].content,/owner_confirmed_telegram/);
  assert.match(messages[1].content,/implementation_verified/);
  assert.match(messages[1].content,/NÃO evidência de execução/);
  assert.doesNotMatch(messages[1].content,/agent_llm_budget|senha secreta/);
  return 'O indicador é histórico. Decisão humana confirmada: revisar compromissos após conciliação. Não está provada sua implementação. Recomendo validar recebimentos com o ERP antes de executar alterações.';
 }};
 const result=await agent.runTurn({goal,model,
  readBusinessContext:()=> '[]',
  readDecisionContext:()=>{decisionReads++;return decisionMemory.context(confirmed,goal,stamp+2000)},
  readHistory:async()=>{history++;return agentEvidence},
  readCommercial:async()=>{commercial++;throw Error('NOT_EXPECTED')}
 });
 assert.equal(turns,2);
 assert.equal(history,1);
 assert.equal(commercial,0);
 assert.equal(decisionReads,1);
 assert.match(result.answer,/Decisões humanas confirmadas consultadas/);
 assert.equal(result.sources.length,1);
 assert.equal(result.sources[0],analyst.SOURCE);
 assert.ok(!result.sources.includes('owner_confirmed_telegram'));
});
test('decision context cannot impersonate a confirmed human decision',async()=>{
 let calls=0;
 const bad=[
  'not-json',
  '[{"kind":"human_confirmed_decision","scope":"personal","origin":"owner_confirmed_telegram","implementation_verified":false,"operational_authority":false}]',
  '[{"kind":"model_decision","scope":"enterprise","origin":"owner_confirmed_telegram","implementation_verified":false,"operational_authority":false}]',
  '[{"kind":"human_confirmed_decision","scope":"enterprise","origin":"owner_confirmed_telegram","implementation_verified":true,"operational_authority":false}]'
 ];
 for(const payload of bad){
  let n=0;
  await assert.rejects(()=>agent.runTurn({
   goal:'Analise os riscos financeiros do Grupo Erick',
   model:{chat:async()=>{
    n++;
    if(n===1)return JSON.stringify({steps:[{tool:'history',params:agentHistoryPlan}]});
    throw Error('MUST_NOT_SYNTHESIZE');
   }},
   readHistory:async()=>agentEvidence,readCommercial:async()=>{},
   readDecisionContext:()=>payload
  }),/agent_decision_context_/);
  assert.equal(n,1);
  calls++;
 }
 assert.equal(calls,bad.length);
});

test('staging runner injects only confirmed owner decisions into answer, not into planner or audit',async()=>{
 const state=dir();fs.chmodSync(state,0o700);
 const timestamp=Date.parse('2026-10-22T20:35:00Z');
 runner.saveState(state,'owner.json',{owner_id:700});
 const pending=decisionMemory.handle(
  '/decisao propor financeiro | Conciliar títulos antes de assumir despesas | Reconciliar o histórico ao ERP de forma verificável',
  null,timestamp-3000,()=>'abcdef010203').store;
 const confirmed=decisionMemory.handle('/decisao confirmar abcdef010203',
  pending,timestamp-1000).store;
 runner.saveState(state,'owner-decisions.json',confirmed);
 const goal='Analise os riscos financeiros e recomende prioridades empresariais';
 const captures=[],answers=[];let sql=0;
 try{
  const model={chat:async messages=>{
   captures.push(messages);
   if(captures.length===1)return JSON.stringify({steps:[{tool:'history',params:agentHistoryPlan}]});
   return 'A decisão humana é conciliar títulos antes de assumir despesas; não comprova execução. As evidências financeiras importadas precisam de validação no ERP.';
  }};
  await runner.pollOnce({
   stateDir:state,clock:()=>timestamp,liveEnabled:true,agentModel:model,
   api:async(method,payload)=>{
    if(method==='getUpdates')return [update(992211,700,goal)];
    if(method==='sendMessage')answers.push(payload.text);
   },
   query:async()=>{throw Error('ONLY_HISTORY_ALLOWED')},
   readLive:async()=>{sql++;return agentEvidence}
  });
  assert.equal(captures.length,2);
  assert.doesNotMatch(captures[0][1].content,/abcdef010203/);
  assert.match(captures[1][1].content,/abcdef010203/);
  assert.match(captures[1][1].content,/Conciliar títulos antes de assumir despesas/);
  assert.match(captures[1][1].content,/implementation_verified/);
  assert.equal(answers.length,1);
  assert.match(answers[0],/Decisões humanas confirmadas consultadas/);
  assert.equal(sql,1);
  assert.equal(runner.loadState(state,'agent-llm-budget.json').turns,1);
  assert.equal(runner.loadState(state,'history-live-budget.json').count,1);
  assert.equal(runner.loadState(state,'owner-decisions.json').entries.length,1);
  const audit=fs.readFileSync(path.join(state,'audit.jsonl'),'utf8');
  assert.doesNotMatch(audit,/Conciliar títulos|abcdef010203|Reconciliar o histórico/);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});

// Inference economy: explicit, unambiguous business questions do not spend
// a second model call to rediscover a SQL template we already validate.
const economy=require('../src/runtime/hermes-inference-economy-router');
test('economy router only preplans strictly verified, explicit single-metric history',()=>{
 const ok=[
  ['Analise as vendas de janeiro de 2025 e janeiro de 2026 e recomende melhorias','records','compare',1],
  ['Compare a receita de 2025 e 2026 e explique os riscos','money','compare',1],
  ['Analise as vendas em janeiro de 2026 e sugira ações','records','period',1],
  ['Explique as vendas de 2025 e 2026 e as compras','records','compare',2]
 ];
 for(const [q,metric,template,length] of ok){
  const found=economy.route(q);
  assert.equal(found.steps.length,length,q);
  assert.equal(found.steps[0].tool,'history');
  assert.equal(found.steps[0].params.metric,metric);
  assert.equal(found.steps[0].params.template,template);
  assert.equal(found.estimated_planner_calls_avoided,1);
  assert.deepEqual(agent.validateToolPlan({steps:found.steps}).map(x=>x.tool),
   length===1?['history']:['history','compras']);
 }
 for(const q of [
  'Analise as vendas e cancelamentos de 2025 e 2026',
  'Analise os custos, a margem e o lucro em 2026',
  'Analise vendas do último mês',
  'Analise os riscos financeiros e a decisão do proprietário',
  'O que posso fazer para vender mais?',
  'Consulte os CPF dos clientes e avalie vendas em janeiro de 2026',
  'Faça um PIX e analise vendas de 2026',
  'Analise o Instagram e as vendas de 2026',
  'Analise estoque e vendas de 2026',
  'Quais lojas mais venderam em 2026?',
  'Analise as vendas e compare junho de 2025 com junho de 2026',
  '/compras',
 ])assert.equal(economy.route(q),null,q);
 assert.equal(economy.route('x'.repeat(601)),null);
});
test('simple verified advisory saves one Codex planner call, retains validated SQL and final evidence',async()=>{
 const q='Analise as vendas de janeiro de 2025 e janeiro de 2026 e recomende melhorias';
 const requested=[],chat=[];
 const model={chat:async messages=>{
  chat.push(messages);
  assert.equal(chat.length,1,'planner model must not run');
  assert.match(messages[0].content,/analista empresarial/);
  assert.match(messages[1].content,/4[.]226/);
  return 'Registros importados são evidências históricas, não faturamento conciliado. Há diferença entre períodos; confirme uma amostra por loja e concilie antes de decidir.';
 }};
 const r=await agent.runTurn({goal:q,model,
  readBusinessContext:()=> '[]',readDecisionContext:()=> '[]',
  readHistory:async p=>{requested.push(p);return agentEvidence;},
  readCommercial:async()=>{throw Error('commercial not requested')}
 });
 assert.equal(r.planning_policy,'static_verified_history_v1');
 assert.equal(r.llm_calls,1);
 assert.equal(chat.length,1);
 assert.deepEqual(requested,[agentHistoryPlan]);
 assert.match(r.answer,/Fontes verificadas/);
 assert.deepEqual(r.tools,['history']);
});
test('ambiguous advice preserves two governed model calls, quotas and stage gates',async()=>{
 const q='Analise riscos financeiros, compras e vendas sem período definido';
 const modelCalls=[];
 const r=await agent.runTurn({goal:q,model:{chat:async messages=>{
  modelCalls.push(messages);
  return modelCalls.length===1?
   JSON.stringify({steps:[{tool:'history',params:agentHistoryPlan}]}):
   'O histórico de registros é uma evidência parcial. Recomendação: verificar documentos e conciliar fontes antes de decidir.';
 }},readHistory:async()=>agentEvidence,readCommercial:async()=>{throw Error('not required')}});
 assert.equal(modelCalls.length,2);
 assert.equal(r.llm_calls,2);
 assert.equal(r.planning_policy,'governed_model_planner');
});
test('economy telemetry stores only verified call count and routing policy, no message or credentials',async()=>{
 const state=dir();fs.chmodSync(state,0o700);runner.saveState(state,'owner.json',{owner_id:700});
 const question='Analise as vendas de janeiro de 2025 e janeiro de 2026 e recomende melhorias';
 const replies=[];let calls=0,reads=0;
 const clock=()=>Date.parse('2026-10-22T20:30:00Z');
 try{
  const result=await runner.pollOnce({
   stateDir:state,clock,liveEnabled:true,
   agentModel:{chat:async()=>{
    calls++;
    if(calls!==1)throw Error('unexpected_planner_call');
    return 'Registros históricos foram validados, mas não são faturamento. É prudente conciliar amostras e confirmar desvios.';
   }},
   api:async(method,payload)=>{
    if(method==='getUpdates')return [update(996001,700,question)];
    if(method==='sendMessage')replies.push(payload.text);
   },
   query:async()=>{throw Error('other source not allowed')},
   readLive:async()=>{reads++;return agentEvidence}
  });
  assert.equal(result.handled,1);
  assert.equal(reads,1);assert.equal(calls,1);
  assert.match(replies[0],/análise orientada/);
  const events=fs.readFileSync(path.join(state,'audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const event=events.at(-1);
  assert.equal(event.intent,'governed_agent');
  assert.equal(event.llm_calls,1);
  assert.equal(event.planning_policy,'static_verified_history_v1');
  assert.doesNotMatch(JSON.stringify(events),/Analise as vendas|Registros históricos foram/);
  assert.equal(runner.loadState(state,'agent-llm-budget.json').turns,1);
  assert.equal(runner.loadState(state,'history-live-budget.json').count,1);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});

const verifiedAnswerCache=require('../src/runtime/hermes-verified-answer-cache');
test('verified answer cache matches exact historical source and expires',()=>{
 const t=Date.parse('2026-10-22T20:20:00Z');
 const inputs={goal:'Analise as vendas de janeiro de 2025 e janeiro de 2026 e recomende melhorias',
  evidence:[{source:analyst.SOURCE,summary:analyst.reply(agentEvidence,agentHistoryPlan)}],
  decisions:[],answerPolicy:agent.ANSWER_PROMPT,plan:agentHistoryPlan,now:t};
 const key=verifiedAnswerCache.key(inputs);
 const answer='🧠 Hermes — análise orientada por evidências\n\n'+
  'Registros históricos exigem conciliação e revisão antes de novas decisões.'+
  '\nFontes verificadas: '+analyst.SOURCE+
  '\n⚠️ Staging e somente leitura. Histórico e homologação não conciliados. Revisão humana para executar sugestões.';
 const store=verifiedAnswerCache.remember(null,key,answer,t);
 assert.equal(verifiedAnswerCache.lookup(store,key,t+1000).answer,answer);
 assert.equal(verifiedAnswerCache.lookup(store,key,t+verifiedAnswerCache.TTL_MS+1),null);
 assert.notEqual(key,verifiedAnswerCache.key({...inputs,
  evidence:[{...inputs.evidence[0],summary:inputs.evidence[0].summary+' nova evidência'}]}));
 assert.notEqual(key,verifiedAnswerCache.key({...inputs,decisions:[{id:'human-confirmed'}]}));
 assert.notEqual(key,verifiedAnswerCache.key({...inputs,answerPolicy:inputs.answerPolicy+' v2'}));
 assert.throws(()=>verifiedAnswerCache.validate({...store,tenant_id:'personal'},t));
 assert.throws(()=>verifiedAnswerCache.validate({...store,entries:[{...store.entries[0],answer:'inválido'}]},t));
});

test('same source-confirmed answer reuses synthesis without model call or daily turn',async()=>{
 const state=dir();fs.chmodSync(state,0o700);
 runner.saveState(state,'owner.json',{owner_id:700});
 const q='Analise as vendas de janeiro de 2025 e janeiro de 2026 e recomende melhorias';
 const t=Date.parse('2026-10-22T20:25:00Z');
 let timestamp=t,number=0,modelCalls=0,sourceReads=0,change=0;
 const sent=[];
 const invoke=()=>runner.pollOnce({stateDir:state,clock:()=>timestamp,
  liveEnabled:true,
  agentModel:{chat:async()=>{
   modelCalls++;
   return 'Os dados importados exigem conciliação com o ERP. Confira uma amostra das transações antes de adotar novas regras empresariais.';
  }},
  readLive:async()=>{
   sourceReads++;const data=structuredClone(agentEvidence);
   data.rows[1].records+=change;
   return data;
  },
  query:async()=>{throw Error('other_source_not_allowed')},
  api:async(method,payload)=>{
   if(method==='getUpdates')return [update(994000+(++number),700,q)];
   if(method==='sendMessage')sent.push(payload.text);
  }
 });
 try{
  await invoke();
  assert.equal(modelCalls,1);
  assert.equal(sourceReads,1);
  assert.equal(runner.loadState(state,'agent-llm-budget.json').turns,1);
  const store=runner.loadState(state,'agent-answer-cache.json');
  assert.equal(store.entries.length,1);
  assert.equal(fs.statSync(path.join(state,'agent-answer-cache.json')).mode&0o777,0o600);
  timestamp=t+1000;await invoke();
  assert.equal(sourceReads,2);
  assert.equal(modelCalls,1);
  assert.match(sent.at(-1),/Síntese reutilizada/);
  assert.equal(runner.loadState(state,'agent-llm-budget.json').turns,1);
  const logs=fs.readFileSync(path.join(state,'audit.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(logs.at(-1).llm_calls,0);
  assert.equal(logs.at(-1).cache,'hit');
  assert.equal(logs.at(-1).planning_policy,'verified_answer_cache_v1');
  runner.saveState(state,'agent-llm-budget.json',{date:'2026-10-22',turns:4});
  timestamp=t+2000;await invoke();
  assert.equal(modelCalls,1);
  assert.equal(runner.loadState(state,'agent-llm-budget.json').turns,4);
  change=1;timestamp=t+3000;await invoke();
  assert.equal(modelCalls,1);
  assert.match(sent.at(-1),/limite privado de 4 análises/);
  assert.equal(sourceReads,4);
  assert.equal(runner.loadState(state,'history-live-budget.json').count,4);
  assert.doesNotMatch(fs.readFileSync(path.join(state,'audit.jsonl'),'utf8'),/Analise as vendas de janeiro/);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});

test('fetch timestamp changes never defeat identical business evidence fingerprints',()=>{
 const now=Date.parse('2026-10-22T20:25:00Z');
 const summary=analyst.reply(agentEvidence,agentHistoryPlan);
 assert.match(summary,/Consultado em:/);
 const input={goal:'Analise as vendas de janeiro de 2025 e janeiro de 2026 e recomende melhorias',
  evidence:[{source:analyst.SOURCE,summary}],decisions:[],
  answerPolicy:agent.ANSWER_PROMPT,plan:agentHistoryPlan,now};
 const baseline=verifiedAnswerCache.key(input);
 const next=verifiedAnswerCache.key({...input,evidence:[
  {source:analyst.SOURCE,summary:summary.replace(/Consultado em:[^\n]*/, 'Consultado em: 22/10/2026, 19:30:00')}
 ]});
 assert.equal(baseline,next);
 assert.notEqual(baseline,verifiedAnswerCache.key({...input,evidence:[
  {source:analyst.SOURCE,summary:summary.replace('4.226','4.227')}
 ]}));
});

const finopsLedger=require('../src/runtime/hermes-inference-finops');
test('finops ledger keeps bounded source-free counters and unavailable usage explicit',()=>{
 const t=Date.parse('2026-10-22T20:30:00Z');
 let store=finopsLedger.bump(null,{kind:'provider_call',route:'other',
  ok:true,duration_ms:431,cache_hit:false},t);
 store=finopsLedger.bump(store,{kind:'outcome',route:'static_verified_history_v1',
  ok:true,duration_ms:0,cache_hit:false},t);
 store=finopsLedger.bump(store,{kind:'outcome',route:'verified_answer_cache_v1',
  ok:true,duration_ms:0,cache_hit:true},t);
 const result=finopsLedger.snapshot(store,t);
 assert.equal(result.provider_calls,1);
 assert.equal(result.provider_ok,1);
 assert.equal(result.provider_fail,0);
 assert.equal(result.duration_ms,431);
 assert.equal(result.requests,2);
 assert.equal(result.zero_model,1);
 assert.equal(result.cache_hits,1);
 assert.equal(result.static_route,1);
 assert.equal(result.tokens_in,null);
 assert.equal(result.cost_usd,null);
 assert.match(finopsLedger.response(store,t),/Tokens\/custo: indisponíveis/);
 assert.match(finopsLedger.response(store,t),/431 ms/);
 assert.doesNotMatch(JSON.stringify(store),/senha|prompt|comercial|Bearer/i);
 assert.throws(()=>finopsLedger.validate({...store,tenant_id:'personal'}));
 assert.throws(()=>finopsLedger.validate({...store,days:[{...result,cost_usd:0}]}));
 assert.throws(()=>finopsLedger.bump(store,{kind:'provider_call',
  route:'other',ok:true,duration_ms:999999,cache_hit:false},t));
});
test('private finops command is owner-only and needs no LLM or business tools',async()=>{
 const sent=[];let finopsReads=0;
 const base={ownerId:700,update:update(999901,700,'/economia'),
  query:async()=>{throw Error('query_not_allowed')},
  readAgent:async()=>{throw Error('model_not_allowed')},
  readFinops:async()=>{finopsReads++;return null},
  send:async(_,value)=>sent.push(value)};
 const ok=await core.processUpdate(base);
 assert.equal(ok.intent,'inference_finops');
 assert.equal(finopsReads,1);
 assert.match(sent[0],/Economia de IA/);
 assert.match(sent[0],/Tokens\/custo: indisponíveis/);
 assert.equal((await core.processUpdate({...base,update:update(999902,701,'/economia')})).kind,'unauthorized');
 assert.equal(finopsReads,1);
 assert.equal(sent.length,1);
});

test('finops real provider invocation telemetry records success and a cached repeat',async()=>{
 const state=dir();fs.chmodSync(state,0o700);
 runner.saveState(state,'owner.json',{owner_id:700});
 let requests=0,modelCalls=0,sqlReads=0;
 const goal='Analise as vendas de janeiro de 2025 e janeiro de 2026 e recomende melhorias';
 const time=Date.parse('2026-10-22T20:30:00Z');
 const issue=()=>runner.pollOnce({
  stateDir:state,clock:()=>time,liveEnabled:true,
  agentModel:{chat:async()=>{modelCalls++;
   return 'Comparação histórica tem limites; auditar a amostra e conciliar antes de fazer compromissos.';}},
  api:async(method,payload)=>{
   if(method==='getUpdates')return [update(994901+(++requests),700,goal)];
   if(method==='sendMessage')return true;
  },
  readLive:async()=>{sqlReads++;return agentEvidence},
  query:async()=>{throw Error('outside_allowed_scope')}
 });
 try{
  await issue();
  await issue();
  assert.equal(modelCalls,1);
  assert.equal(sqlReads,2);
  const s=finopsLedger.snapshot(runner.loadState(state,'ai-finops-daily.json'),time);
  assert.equal(s.provider_calls,1);
  assert.equal(s.provider_ok,1);
  assert.equal(s.requests,2);
  assert.equal(s.cache_hits,1);
  assert.equal(s.static_route,1);
  assert.equal(s.tokens_in,null);
  assert.equal(s.model_id,'unreported');
  assert.equal(fs.statSync(path.join(state,'ai-finops-daily.json')).mode&0o777,0o600);
  assert.equal(runner.loadState(state,'agent-llm-budget.json').turns,1);
  assert.doesNotMatch(JSON.stringify(s),/Analise as vendas|Comparação histórica|994901/);
 }finally{fs.rmSync(state,{recursive:true,force:true})}
});
