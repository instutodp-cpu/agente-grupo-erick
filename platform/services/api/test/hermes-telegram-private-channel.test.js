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
