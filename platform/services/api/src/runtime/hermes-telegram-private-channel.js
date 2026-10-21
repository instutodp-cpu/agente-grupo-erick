'use strict';
// Hermes Telegram: private owner-only intent gateway. No generic AI/tool execution.
const {createHash,timingSafeEqual}=require('node:crypto');
const ROUTES=Object.freeze({
 compras:'/internal/commercial-read-pilot/brief',
 lotoia:'/internal/lotoia-read-pilot/health',status:'/health'
});
const HELP='Hermes Grupo Erick — piloto privado de leitura.\n\n'+
 'Comandos: /compras, /lotoia, /status, /ajuda.\n'+
 'Também aceito "resumo das compras" e "situação do LotoIA".\n'+
 'Não faço pagamentos, apostas, publicações ou envio a terceiros.';
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const num=new Intl.NumberFormat('pt-BR');
function intentFor(text){
 if(typeof text!=='string'||text.length>600)return 'unknown';
 const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(/^\/(?:start|ajuda|help)(?:@\w+)?$/.test(t)||t==='ajuda')return 'help';
 if(/^\/status(?:@\w+)?$/.test(t)||t==='status')return 'status';
 if(/^\/compras(?:@\w+)?$/.test(t)||
  (/\b(compras|duplicatas)\b/.test(t)&&
   /\b(resumo|saldo|venciment\w*|pendenc\w*|total|quanto|qual|quais|mostre|mostra|situacao|relatorio)\b/.test(t)))
  return 'compras';
 if(/^\/lotoia(?:@\w+)?$/.test(t)||
   (/\b(lotoia|loterica|lotericas)\b/.test(t)&&
   /\b(resumo|saldo|caixa|pendenc\w*|situacao|lancamento\w*|cobertura|relatorio|qual|quais|mostra)\b/.test(t)))
  return 'lotoia';
 return 'unknown';
}
function privateMessage(update){
 const m=update?.message;
 if(!Number.isSafeInteger(update?.update_id)||update.update_id<0||
  !m||m.chat?.type!=='private'||!Number.isSafeInteger(m.chat.id)||
  m.chat.id<=0||!Number.isSafeInteger(m.from?.id)||
  m.from.id!==m.chat.id||m.from.is_bot===true||
  m.forward_origin||m.forward_from||m.is_automatic_forward||
  typeof m.text!=='string'||m.text.length>600)return null;
 return {updateId:update.update_id,userId:m.from.id,text:m.text.trim()};
}
function pairValid(code,record,now){
 if(typeof code!=='string'||!/^[a-zA-Z0-9_-]{12}$/.test(code)||
 !record||!/^[a-f0-9]{64}$/.test(record.sha256||'')||
 !Number.isSafeInteger(record.expires_at)||now>record.expires_at||
 !Number.isInteger(record.attempts)||record.attempts<0||record.attempts>=5)return false;
 return timingSafeEqual(createHash('sha256').update(code).digest(),
  Buffer.from(record.sha256,'hex'));
}
const safeCount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000;
const safeMoney=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<1e10;
function hermesReply(intent,x){
 if(intent==='status')return x===true?
  '✅ Hermes online em staging. Consultas somente leitura.':
  'Hermes indisponível; nenhuma consulta comercial foi realizada.';
 if(x?.status!=='succeeded'||x.executed!==true||
  x.network_call_performed!==true||x.simulated!==false||
  x.write_performed!==false||x.production_used!==false||
  !/^[a-f0-9-]{36}$/.test(x.trace_id||''))throw Error('unverified_hermes_read');
 const trace=x.trace_id.slice(0,8);
 if(intent==='compras'){
  const b=x.brief;
  if(b?.source!=='Compras homologacao'||b.company!=='Grupo Erick'||
   b.source_state!=='homologacao'||b.erp_linx_conciliated!==false||
   b.alerts_dispatched!==false||b.payment_authorized!==false)
   throw Error('wrong_commercial_scope');
  const opened=b.open_titles,over=b.overdue_titles,upcoming=b.next_30_days_titles;
  const purchases=b.purchases_last_30_days;
  if(![opened,over,upcoming].every(v=>safeCount(v?.count)&&safeMoney(v.balance_brl))||
   !safeCount(purchases?.count)||!safeMoney(purchases?.net_brl)||
   over.balance_brl>opened.balance_brl)throw Error('invalid_balances');
  return ['📦 Compras — Grupo Erick (homologação)',
   'Referência: '+b.as_of,
   'Compras dos últimos 30 dias: '+brl.format(purchases.net_brl)+
    ' ('+num.format(purchases.count)+' registros)',
   'Registrado em aberto: '+brl.format(opened.balance_brl),
   'Marcado como vencido: '+brl.format(over.balance_brl)+
    ' ('+num.format(over.count)+' títulos)',
   'Próximos 30 dias: '+brl.format(upcoming.balance_brl)+
    ' ('+num.format(upcoming.count)+' títulos)',
   '⚠️ Dados não conciliados com o ERP Linx.',
   'Somente leitura. Rastreio: '+trace].join('\n');
 }
 if(intent==='lotoia'){
  const c=x.data_coverage;
  if(x.source!=='LotoIA'||x.company!=='Grupo Erick'||
   x.store_count!==2||x.qa_included!==false||
   x.real_world_operations_verified!==false||
   x.financial_authority!==false||
   c?.window_days!==7||c.real_world_completeness_verified!==false||
   !['no_recent_records','partial_records','sources_present_unverified']
   .includes(c.status)||!safeCount(x.open_pending_count)||
   !safeCount(x.unresolved_alert_count))
   throw Error('wrong_lotoia_scope');
  const state={
   no_recent_records:'sem lançamentos recentes no aplicativo',
   partial_records:'registros parciais por loja/fonte',
   sources_present_unverified:'fontes com registros, mas sem conciliação'
  }[c.status];
  if(!Array.isArray(x.stores)||x.stores.length!==2||
   !safeMoney(x.open_pending_known_balance_brl))throw Error('invalid_lotoia_stores');
  const names=['Erick Lotérica Barreiros','Erick Lotérica Sirinhaém'];
  const storeLines=names.map(name=>{
   const s=x.stores.find(item=>item?.name===name);
   if(!s||!safeCount(s.open_pending_count)||
    !safeCount(s.unresolved_alert_count)||
    !safeMoney(s.open_pending_known_balance_brl)||
    !s.recent_source_counts||
    !['operator_cash','physical_counts','caixa_reports','financial_movements','closures']
      .every(k=>safeCount(s.recent_source_counts[k])))
    throw Error('invalid_lotoia_store_coverage');
   const hasRecords=Object.values(s.recent_source_counts).some(n=>n>0);
   return name+': '+num.format(s.open_pending_count)+
    ' pendência(s) registrada(s), '+brl.format(s.open_pending_known_balance_brl)+
    ' de valor conhecido; '+(hasRecords?'há lançamentos, sem conciliação':
     'sem registros recentes nas fontes consultadas');
  });
  return ['🎟️ LotoIA — duas lotéricas Erick',
   'Referência: '+x.as_of,'Cobertura de 7 dias: '+state,
   ...storeLines,
   'Pendências registradas no aplicativo: '+num.format(x.open_pending_count),
   'Alertas registrados: '+num.format(x.unresolved_alert_count),
   '⚠️ Ausência de registro NÃO comprova ausência de pendências ou conciliação de caixa.',
   'Somente leitura. Rastreio: '+trace].join('\n');
 }
 throw Error('intent_not_allowed');
}
async function processUpdate({update,ownerId=null,pairing=null,clock=()=>Date.now(),
 send,saveOwner,savePairing,query}){
 const msg=privateMessage(update);
 if(!msg)return {kind:'ignored'};
 if(typeof send!=='function'||typeof query!=='function')
  throw Error('telegram_dependencies_missing');
 if(ownerId===null){
  if(msg.text==='/start'){
   await send(msg.userId,'Hermes privado. Vincule sua conta com /vincular CODIGO obtido no console seguro da VPS.');
   return {kind:'onboarding'};
  }
  const pair=msg.text.match(/^\/vincular\s+([a-zA-Z0-9_-]{12})$/);
  if(!pair)return {kind:'unpaired'};
  if(!pairValid(pair[1],pairing,clock())){
   if(pairing&&pairing.attempts<5&&pairing.expires_at>=clock())
    await savePairing({...pairing,attempts:pairing.attempts+1});
   return {kind:'pair_denied'};
  }
  await saveOwner(msg.userId);
  await send(msg.userId,'✅ Conta privada vinculada. Envie /ajuda, /compras ou /lotoia.');
  return {kind:'paired'};
 }
 if(msg.userId!==ownerId)return {kind:'unauthorized'};
 const intent=intentFor(msg.text);
 if(intent==='help'){await send(msg.userId,HELP);return {kind:'answered',intent};}
 if(intent==='unknown'){
  await send(msg.userId,'Ainda não tenho essa operação liberada.\n\n'+HELP);
  return {kind:'unsupported',intent};
 }
 let response;
 try{
  const data=await query(intent,ROUTES[intent]);
  response=data?.denied_status==='request_budget_exhausted'?
   'Limite compartilhado de 12 consultas em 24h atingido. Não repetirei a consulta.':
   data?.denied_status?
   'Consulta indisponível. Nenhum dado foi considerado confirmado.':
   hermesReply(intent,data);
 }catch{
  response='Não consegui validar a resposta na origem. Nenhum dado foi tratado como confirmado.';
 }
 await send(msg.userId,response);
 return {kind:'answered',intent};
}
module.exports={ROUTES,HELP,intentFor,privateMessage,pairValid,hermesReply,processUpdate};
