'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {makeBridge,command,responseText,durableWrite,protectedRead}=
 require('../src/runtime/hermes-telegram-private-bridge');
const NOW=Date.parse('2026-10-21T12:00:00Z');
const token='123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcd123456789abcdefghij';
const ENV={HERMES_DEPLOYMENT_STAGE:'staging',HERMES_EXECUTION_ENABLED:'false',
 HERMES_EXECUTION_KILL_SWITCH:'true',HERMES_MISSION_INGRESS_ENABLED:'false'};
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hermes-tg-test-'));
 fs.chmodSync(dir,0o700);
 fs.writeFileSync(path.join(dir,'bot.token'),token,{mode:0o600});
 fs.writeFileSync(path.join(dir,'machine.bearer'),'hermes-test-machine-credential',{mode:0o600});
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
function bridge(dir,fetchImpl){
 const before=Object.fromEntries(Object.keys(ENV).map(k=>[k,process.env[k]]));
 Object.assign(process.env,ENV);
 try{return makeBridge({directory:dir,fetchImpl,clock:()=>NOW});}
 finally{for(const [k,v] of Object.entries(before)){
  if(v===undefined)delete process.env[k];else process.env[k]=v;
 }}
}
function message(id,sender,text){return {update_id:id,
 message:{from:{id:sender,is_bot:false},chat:{id:sender,type:'private'},text}};}
function compras(){return {status:'succeeded',executed:true,simulated:false,write_performed:false,
 production_used:false,trace_id:'aaaaaaaa-cccc-4444-8888-123456789000',
 source:'Compras homologacao',company:'Grupo Erick',erp_linx_conciliated:false,
 purchases_last_30_days:{count:25,net_brl:385410.97},
 overdue_titles:{count:471,balance_brl:1198243.10},
 next_30_days_titles:{count:88,balance_brl:189280.82}};}
function lotoia(){return {status:'succeeded',executed:true,simulated:false,write_performed:false,
 production_used:false,trace_id:'aaaaaaaa-cccc-4444-8888-123456789000',
 source:'LotoIA',company:'Grupo Erick',qa_included:false,store_count:2,
 real_world_operations_verified:false,open_pending_count:0,unresolved_alert_count:0,
 data_coverage:{status:'no_recent_records',window_days:7,real_world_completeness_verified:false}};}
function fake({batches=[],read=()=>compras(),http=200,webhook=''}={}){
 const calls=[],queue=[...batches];
 const fetchImpl=async(url,init)=>{
  if(String(url).startsWith('https://api.telegram.org/bot')){
   const method=url.split('/').at(-1),payload=JSON.parse(init.body);
   calls.push({kind:'telegram',method,payload});
   let result={};
   if(method==='getMe')result={is_bot:true,username:'Grupoerick_bot'};
   else if(method==='getWebhookInfo')result={url:webhook};
   else if(method==='getUpdates')result=queue.shift()||[];
   else if(method==='sendMessage')result={message_id:777};
   else throw Error('unrecognized_telegram_method');
   return new Response(JSON.stringify({ok:true,result}),{status:200});
  }
  calls.push({kind:'hermes',url,init});
  return new Response(JSON.stringify(read(url)),{status:http});
 };
 return {fetchImpl,calls};
}
test('natural language routing only calls three existing read operations',()=>{
 assert.equal(command('resumo das compras'),'compras');
 assert.equal(command('me mostre os próximos vencimentos'),'vencimentos');
 assert.equal(command('/lotoia'),'lotoia');
 assert.equal(command('/status'),'status');
 assert.equal(command('faça um Pix agora'),'help');
 assert.equal(command('delete tudo'),'help');
 assert.equal(command('x'.repeat(500)),'help');
});
test('verified financial and LotoIA responses include disclaimers, reject untrusted data',()=>{
 assert.match(responseText('compras',compras()),/385\.410,97/);
 assert.match(responseText('compras',compras()),/Linx/);
 const brief={...compras(),brief:{source:'Compras homologacao',company:'Grupo Erick',
  erp_linx_conciliated:false,overdue_titles:compras().overdue_titles,
  next_30_days_titles:compras().next_30_days_titles}};
 assert.match(responseText('vencimentos',brief),/189\.280,82/);
 assert.match(responseText('lotoia',lotoia()),/Sem lançamentos recentes/);
 assert.throws(()=>responseText('compras',{...compras(),simulated:true}));
 assert.throws(()=>responseText('lotoia',{...lotoia(),qa_included:true}));
 assert.throws(()=>responseText('vencimentos',{...brief,brief:{...brief.brief,company:'QA'}}));
});
test('private files reject unsafe permissions and a missing kill switch',t=>{
 const dir=fixture(t);
 assert.equal(protectedRead(path.join(dir,'bot.token')),token);
 fs.chmodSync(path.join(dir,'bot.token'),0o644);
 assert.throws(()=>bridge(dir,fake().fetchImpl));
 fs.chmodSync(path.join(dir,'bot.token'),0o600);
 const old=process.env.HERMES_EXECUTION_ENABLED;
 process.env.HERMES_EXECUTION_ENABLED='true';
 try{assert.throws(()=>makeBridge({directory:dir}),/kill_switch/);}
 finally{if(old===undefined)delete process.env.HERMES_EXECUTION_ENABLED;
  else process.env.HERMES_EXECUTION_ENABLED=old;}
});
test('single-use pairing approves one Telegram private user; other users never read or receive',async t=>{
 const dir=fixture(t),code='ValidPairingSecret1234567';
 durableWrite(path.join(dir,'pairing.json'),{code,expires_at_ms:NOW+60000});
 const tr=fake({batches:[
  [message(1,222,'/start bad'),message(2,111,'/start '+code)],
  [message(3,222,'/compras'),message(4,111,'/status')]
 ]});
 const b=bridge(dir,tr.fetchImpl);
 await b.validate();await b.step();
 assert.equal(b.paired(),true);
 assert.equal(fs.existsSync(path.join(dir,'pairing.json')),false);
 const state=JSON.parse(protectedRead(path.join(dir,'state.json')));
 assert.equal(state.user_id,111);assert.equal(state.offset,3);
 await b.step();
 assert.equal(tr.calls.filter(x=>x.kind==='hermes').length,0);
 const sends=tr.calls.filter(x=>x.method==='sendMessage');
 assert.equal(sends.length,2);
 assert.ok(sends.every(x=>x.payload.chat_id===111));
 assert.match(sends[0].payload.text,/Hermes vinculado/);
 assert.equal(JSON.parse(protectedRead(path.join(dir,'state.json'))).offset,5);
});
test('owner can request authenticated Compras, vencimentos and LotoIA exactly once each',async t=>{
 const dir=fixture(t);
 durableWrite(path.join(dir,'state.json'),{user_id:111,chat_id:111,offset:10});
 const tr=fake({batches:[[message(10,111,'/compras'),message(11,111,'/vencimentos'),message(12,111,'/lotoia')]],
  read:url=>url.includes('lotoia')?lotoia():
  url.endsWith('brief')?{...compras(),brief:{source:'Compras homologacao',company:'Grupo Erick',
   erp_linx_conciliated:false,overdue_titles:compras().overdue_titles,
   next_30_days_titles:compras().next_30_days_titles}}:compras()});
 await bridge(dir,tr.fetchImpl).step();
 const queries=tr.calls.filter(x=>x.kind==='hermes');
 assert.deepEqual(queries.map(x=>x.url),[
  'http://127.0.0.1:8098/internal/commercial-read-pilot/summary',
  'http://127.0.0.1:8098/internal/commercial-read-pilot/brief',
  'http://127.0.0.1:8098/internal/lotoia-read-pilot/health'
 ]);
 assert.ok(queries.every(x=>x.init.method==='GET'&&
  x.init.headers.Authorization==='Bearer hermes-test-machine-credential'));
 const sends=tr.calls.filter(x=>x.method==='sendMessage');
 assert.equal(sends.length,3);assert.ok(sends.every(x=>x.payload.chat_id===111));
 assert.match(sends[0].payload.text,/385\.410,97/);
 assert.match(sends[2].payload.text,/não é prova de caixa conciliado/);
});
test('unavailable source fails closed instead of fabricating financial results',async t=>{
 const dir=fixture(t);
 durableWrite(path.join(dir,'state.json'),{user_id:111,chat_id:111,offset:1});
 const tr=fake({batches:[[message(1,111,'/compras')]],http:503});
 await bridge(dir,tr.fetchImpl).step();
 const reply=tr.calls.find(x=>x.method==='sendMessage');
 assert.match(reply.payload.text,/Não consegui validar/);
 assert.doesNotMatch(reply.payload.text,/385\.410/);
});
test('webhook conflict prevents competing polling consumer',async t=>{
 const dir=fixture(t);
 const b=bridge(dir,fake({webhook:'https://existing.example/hook'}).fetchImpl);
 await assert.rejects(b.validate(),/webhook_conflict/);
});
test('cursor advances before a potentially failed reply: no duplicate provider read',async t=>{
 const dir=fixture(t);
 durableWrite(path.join(dir,'state.json'),{user_id:111,chat_id:111,offset:5});
 let provider=0;
 const fetchImpl=async(url)=>{
  if(url.endsWith('/getUpdates'))
   return new Response(JSON.stringify({ok:true,result:[message(5,111,'/compras')]}));
  if(url.endsWith('/sendMessage'))throw Error('send_failed');
  provider++;return new Response(JSON.stringify(compras()));
 };
 const b=bridge(dir,fetchImpl);
 await assert.rejects(b.step(),/send_failed/);
 await b.step();
 assert.equal(provider,1);
 assert.equal(JSON.parse(protectedRead(path.join(dir,'state.json'))).offset,6);
});