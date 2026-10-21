'use strict';
// Hermes Telegram: private, one-time paired, read-only polling bridge.
// No generic actions, no PII ingestion and no publicly exposed endpoint.
const fs=require('node:fs'),path=require('node:path');
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {TextDecoder}=require('node:util');
const {setTimeout:sleep}=require('node:timers/promises');
const HERMES='http://127.0.0.1:8098',USERNAME='grupoerick_bot';
const ROUTES=Object.freeze({
 compras:'/internal/commercial-read-pilot/summary',
 vencimentos:'/internal/commercial-read-pilot/brief',
 lotoia:'/internal/lotoia-read-pilot/health'
});
const validId=x=>Number.isSafeInteger(x)&&x>0;
function protectedRead(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('..'))
  throw Error('unsafe_path');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const st=fs.fstatSync(fd);
  if(!st.isFile()||(st.mode&0o777)!==0o600||st.size<1||st.size>8192)
   throw Error('file_not_private');
  return fs.readFileSync(fd,'utf8');
 }finally{fs.closeSync(fd);}
}
function durableWrite(file,data){
 const dir=path.dirname(file),st=fs.statSync(dir);
 if((st.mode&0o077)!==0||!st.isDirectory())throw Error('directory_not_private');
 const tmp=path.join(dir,'.tmp-'+randomBytes(10).toString('hex'));
 const fd=fs.openSync(tmp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
 try{fs.writeSync(fd,JSON.stringify(data)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.renameSync(tmp,file);const d=fs.openSync(dir,fs.constants.O_RDONLY);
  try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
 }catch(e){try{fs.unlinkSync(tmp);}catch{}throw e;}
}
function command(text){
 if(typeof text!=='string'||text.length>400)return 'help';
 const s=text.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 if(/^\/(start|ajuda|help)(@grupoerick_bot)?(\s|$)/.test(s)||
   /^(ajuda|menu|oi|ola|bom dia)$/.test(s))return 'help';
 if(s==='/status'||s==='status')return 'status';
 if(/^\/vencimentos(@grupoerick_bot)?$/.test(s)||/venciment|titulo|duplicata/.test(s))return 'vencimentos';
 if(/^\/lotoia(@grupoerick_bot)?$/.test(s)||/lotoia|loterica|fechamento do caixa/.test(s))return 'lotoia';
 if(/^\/compras(@grupoerick_bot)?$/.test(s)||/compra|fornecedor/.test(s))return 'compras';
 return 'help';
}
const HELP='Hermes do Grupo Erick — consultas reais, somente leitura.\n/compras — resumo das compras\n/vencimentos — títulos cadastrados\n/lotoia — situação dos lançamentos\n/status — conexão\n\nNão executo pagamentos, apostas nem movimentações.';
const money=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e10;
const count=x=>Number.isSafeInteger(x)&&x>=0&&x<=1e7;
const brl=x=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(x);
function responseText(kind,x){
 if(x?.status!=='succeeded'||x.executed!==true||x.simulated!==false||
   x.write_performed!==false||x.production_used!==false||
   typeof x.trace_id!=='string')throw Error('unverified_hermes_response');
 const trace='\nTrace: '+x.trace_id.slice(0,8);
 if(kind==='lotoia'){
  if(x.source!=='LotoIA'||x.company!=='Grupo Erick'||x.qa_included!==false||
   x.store_count!==2||x.real_world_operations_verified!==false||
   x.data_coverage?.real_world_completeness_verified!==false||
   x.data_coverage?.window_days!==7||
   !['no_recent_records','partial_records','sources_present_unverified'].includes(x.data_coverage?.status)||
   !count(x.open_pending_count)||!count(x.unresolved_alert_count))
   throw Error('lotoia_unverified');
  const cases={no_recent_records:'Sem lançamentos recentes no aplicativo',
   partial_records:'Cobertura parcial de lançamentos',
   sources_present_unverified:'Registros presentes, não conciliados'};
  return '🏪 LotoIA — '+cases[x.data_coverage.status]+
   '\nPendências registradas: '+x.open_pending_count+
   '\nAlertas registrados: '+x.unresolved_alert_count+
   '\n⚠️ Ausência de registros não é prova de caixa conciliado.'+trace;
 }
 const d=kind==='vencimentos'?x.brief:x;
 if(d?.source!=='Compras homologacao'||d.company!=='Grupo Erick'||
   d.erp_linx_conciliated!==false||!count(d.overdue_titles?.count)||
   !money(d.overdue_titles?.balance_brl)||!count(d.next_30_days_titles?.count)||
   !money(d.next_30_days_titles?.balance_brl))throw Error('commercial_unverified');
 if(kind==='vencimentos')
  return '📆 Próximos 30 dias: '+d.next_30_days_titles.count+' títulos, '+
   brl(d.next_30_days_titles.balance_brl)+
   '\nMarcados como vencidos: '+d.overdue_titles.count+' títulos, '+
   brl(d.overdue_titles.balance_brl)+
   '\n⚠️ Valores do app, não conciliados com Linx.'+trace;
 if(!count(d.purchases_last_30_days?.count)||!money(d.purchases_last_30_days?.net_brl))
  throw Error('commercial_unverified');
 return '🛍 Grupo Erick — compras nos últimos 30 dias: '+d.purchases_last_30_days.count+
  ', '+brl(d.purchases_last_30_days.net_brl)+
  '\nVencidos cadastrados: '+brl(d.overdue_titles.balance_brl)+
  '\nPróximos 30 dias: '+brl(d.next_30_days_titles.balance_brl)+
  '\n⚠️ Informações de homologação, não conciliadas com Linx.'+trace;
}
function makeBridge({directory,fetchImpl=globalThis.fetch,clock=()=>Date.now(),delay=sleep}={}){
 const e=process.env;
 if(e.HERMES_DEPLOYMENT_STAGE!=='staging'||e.HERMES_EXECUTION_ENABLED!=='false'||
    e.HERMES_EXECUTION_KILL_SWITCH!=='true'||e.HERMES_MISSION_INGRESS_ENABLED!=='false')
   throw Error('execution_kill_switch_required');
 if(!directory||!path.isAbsolute(directory)||directory.includes('..'))
  throw Error('private_directory_required');
 const token=protectedRead(path.join(directory,'bot.token')).trim();
 if(!/^[0-9]{5,16}:[A-Za-z0-9_-]{30,}$/.test(token))throw Error('invalid_bot_token');
 const bearer=protectedRead(path.join(directory,'machine.bearer')).trim();
 if(bearer.length<12||bearer.length>512)throw Error('invalid_machine_identity');
 let state=null,cursor=0;
 try{
  state=JSON.parse(protectedRead(path.join(directory,'state.json')));
  if(!validId(state.user_id)||state.user_id!==state.chat_id||
   !Number.isSafeInteger(state.offset)||state.offset<0)throw Error('invalid_state');
 }catch(err){if(err.code!=='ENOENT')throw err;}
 if(!state){
  try{const c=JSON.parse(protectedRead(path.join(directory,'cursor.json')));
   if(!Number.isSafeInteger(c.offset)||c.offset<0)throw Error('invalid_cursor');
   cursor=c.offset;
  }catch(err){if(err.code!=='ENOENT')throw err;}
 }
 async function telegram(method,payload){
  // The token occurs in the HTTPS URL; NEVER emit URLs or exception text to logs.
  const res=await fetchImpl('https://api.telegram.org/bot'+token+'/'+method,{
   method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(payload),signal:AbortSignal.timeout(method==='getUpdates'?22000:13000)
  });
  if(!res?.ok||!res.body)throw Error('telegram_api_unavailable');
  let raw='',size=0;
  const reader=res.body.getReader(),decoder=new TextDecoder('utf8',{fatal:true});
  for(;;){const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;if(size>40960)throw Error('telegram_response_too_large');
   raw+=decoder.decode(value,{stream:true});
  }
  const data=JSON.parse(raw+decoder.decode());
  if(data.ok!==true)throw Error('telegram_api_denied');
  return data.result;
 }
 async function validate(){
  const me=await telegram('getMe',{});
  if(me?.is_bot!==true||String(me.username||'').toLowerCase()!==USERNAME)
   throw Error('wrong_bot_identity');
  const hook=await telegram('getWebhookInfo',{});
  if(hook?.url)throw Error('webhook_conflict');
 }
 async function reply(id,text){
  await telegram('sendMessage',{chat_id:id,text:text.slice(0,3900),disable_web_page_preview:true});
 }
 async function getHermes(kind){
  const res=await fetchImpl(HERMES+ROUTES[kind],{
   method:'GET',redirect:'error',
   headers:{Authorization:'Bearer '+bearer},signal:AbortSignal.timeout(16000)});
  if(res?.status!==200||!res.ok)throw Error('hermes_unavailable');
  return responseText(kind,await res.json());
 }
 async function process(update){
  const m=update.message,id=m?.from?.id;
  if(m?.chat?.type!=='private'||!validId(id)||m.chat.id!==id||m.from?.is_bot)return;
  const text=typeof m.text==='string'?m.text.trim():'';
  if(!state){
   let pairing;
   try{pairing=JSON.parse(protectedRead(path.join(directory,'pairing.json')));}
   catch{return;}
   const start=text.match(/^\/start ([A-Za-z0-9_-]{18,32})$/);
   if(!start||!Number.isSafeInteger(pairing.expires_at_ms)||
    clock()>pairing.expires_at_ms||typeof pairing.code!=='string')return;
   const a=Buffer.from(start[1]),b=Buffer.from(pairing.code);
   if(a.length!==b.length||!timingSafeEqual(a,b))return;
   state={user_id:id,chat_id:id,offset:update.update_id+1};
   durableWrite(path.join(directory,'state.json'),state);
   fs.unlinkSync(path.join(directory,'pairing.json'));
   try{fs.unlinkSync(path.join(directory,'cursor.json'));}catch(err){if(err.code!=='ENOENT')throw err;}
   await reply(id,'✅ Hermes vinculado. '+HELP);
   return;
  }
  if(id!==state.user_id||m.chat.id!==state.chat_id)return;
  const kind=command(text);
  let response=HELP;
  if(kind==='status')response='✅ Hermes conectado. Consultas apenas quando solicitadas; escritas financeiras desabilitadas.';
  if(ROUTES[kind]){
   try{response=await getHermes(kind);}
   catch{response='⚠️ Não consegui validar os dados agora; não vou inventar valores. Tente novamente mais tarde.';}
  }
  await reply(id,response);
 }
 async function step(){
  const rows=await telegram('getUpdates',{offset:state?state.offset:cursor,
   limit:10,timeout:15,allowed_updates:['message']});
  if(!Array.isArray(rows)||rows.length>10)throw Error('invalid_updates');
  for(const u of rows){
   if(!Number.isSafeInteger(u?.update_id)||u.update_id<0)throw Error('invalid_update');
   if(u.update_id<(state?state.offset:cursor))continue;
   // Claim before any provider GET: crashes NEVER automatically repeat a financial read.
   if(state){state.offset=u.update_id+1;durableWrite(path.join(directory,'state.json'),state);}
   else{cursor=u.update_id+1;durableWrite(path.join(directory,'cursor.json'),{offset:cursor});}
   await process(u);
  }
 }
 async function run({signal}={}){
  await validate();
  while(!signal?.aborted){try{await step();}catch{if(!signal?.aborted)await delay(4000);}}
 }
 return Object.freeze({validate,step,run,paired:()=>!!state});
}
module.exports={makeBridge,command,responseText,durableWrite,protectedRead};