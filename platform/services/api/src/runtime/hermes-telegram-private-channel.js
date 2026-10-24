'use strict';
// Hermes Telegram: private owner-only intent gateway. No generic AI/tool execution.
const {createHash,timingSafeEqual}=require('node:crypto');
const {parseSalesCommand,historicalLiveReply}=require('./hermes-softcom-live-channel');
const analyst=require('./hermes-analyst-templates');
const governed=require('./hermes-governed-agent');
const ownerDecisions=require('./hermes-owner-decision-memory');
const finops=require('./hermes-inference-finops');
const diagnostic=require('./hermes-owner-diagnostic');
const matrix=require('./hermes-store-month-matrix');
const alerts=require('./hermes-operational-alerts');
const fallback=require('./hermes-codex-fallback');
const brainReader=require('./hermes-brain-telegram-reader');
const ROUTES=Object.freeze({
 compras:'/internal/commercial-read-pilot/brief',
 lotoia:'/internal/lotoia-read-pilot/health',status:'/health'
});
const HELP='Hermes Grupo Erick — piloto privado de leitura.\n\n'+
 'Comandos: /compras, /lotoia, /historico, /historico lojas, /historico meses, /status, /ajuda.\n'+
 'Pergunte naturalmente: vendeu quanto em janeiro 2026; compare janeiro 2025 e 2026; cancelamentos em junho; qual loja vendeu mais.\n'+
 'Consultas usam indicadores históricos auditáveis, não faturamento conciliado.\n'+
 'Comandos antigos: /vendas 2026-05, /produtos 2026-05.\n'+
 'Também aceito "resumo das compras" e "situação do LotoIA".\n'+
 'Memória de decisões: /decisao (propor, confirmar, cancelar) e /decisoes.\n'+
 'Segundo cérebro central: /cerebro TERMO (somente quando conexão RLS autorizada).\n'+
 'Métricas privadas de IA: /economia. Diagnóstico: /diagnostico, /diagnostico lojas, /diagnostico cruzamento. Alertas: /alertas historicos.\n'+
 'Não faço pagamentos, apostas, publicações ou envio a terceiros.';
const brl=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const num=new Intl.NumberFormat('pt-BR');
function intentFor(text){
 if(typeof text!=='string'||text.length>600)return 'unknown';
 const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(/^\/(?:start|ajuda|help)(?:@\w+)?$/.test(t)||t==='ajuda')return 'help';
 if(/^\/status(?:@\w+)?$/.test(t)||t==='status')return 'status';
 if(/^\/historico(?:@\w+)?\s+lojas$/.test(t)||t==='vendas por loja'||
    t==='qual loja teve mais vendas?')return 'historico_lojas';
 if(/^\/historico(?:@\w+)?\s+meses$/.test(t)||t==='vendas por mes')
  return 'historico_meses';
 if(/^\/historico(?:@\w+)?$/.test(t)||t==='historico de vendas'||
    t==='resumo historico de vendas')return 'historico';
 if(parseSalesCommand(text))return 'historico_live';
 if(analyst.planQuestion(text))return 'business_analyst';
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
// Interpretation/advice must not be demoted to a numeric template merely
// because the question mentions years, stores or commercial indicators.
// Explicit slash commands stay deterministic, and this is NOT an approval.
function advisoryRequest(text){
 if(typeof text!=='string'||text.length<3||text.length>600)return false;
 const q=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 if(q.startsWith('/'))return false;
 return /\b(?:analise|analisar|avaliar|avaliacao|diagnostico|identifique|identificar|investigue|investigar|prioridade|prioridades|priorize|priorizar|problema|problemas|risco|riscos|insight|insights|melhoria|melhorias|recomende|recomendar|sugira|sugerir|sugestao|sugestoes|evidencia|evidencias|explique|explicar|considerando|proximos passos)\b/.test(q);
}
// Fixed, source-verified historic comparison, not a governed LLM turn.
// Strict grammar prevents unrelated advisory questions being silently demoted.
function cancellationRateRequest(text){
 if(typeof text!=='string'||text.length>600)return false;
 const q=analyst.normalize(text);
 if(q.startsWith('/')||!/\b(?:taxas?|percentuais?)\b/.test(q)||
  !/\bcancelament(?:o|os)\b|\bcancelad(?:os|as)\b/.test(q)||
  !/\b(?:janeiro a maio|jan-mai|jan a maio)\b/.test(q))return false;
 const years=[...q.matchAll(/\b20\d{2}\b/g)].map(m=>m[0]);
 if(years.length!==2||!years.includes('2025')||!years.includes('2026'))return false;
 if(/\b(?:fevereiro|marco|abril|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(q))return false;
 // Hard-denied subjects never fall into an automatic historical lookup.
 if(/\b(?:cpf|cnpj|senha|token|pix|transferencia|pagar|apagar|sql|clientes)\b/.test(q))return false;
 return true;
}
const CANCEL_RATE_PLAN=Object.freeze({tenant_id:'grupo_erick',template:'compare',
 period:'2025',other_period:'2026',metric:'cancelled',store:null});
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
const CACHE_REUSE_MS=6*3600000,CACHE_MAX_MS=24*3600000;
function verifiedCache(x,ownerId,intent,now){
 if(!x||!['compras','lotoia'].includes(intent)||x.owner_id!==ownerId||
    x.tenant_id!=='grupo_erick'||x.intent!==intent||
    !Number.isSafeInteger(x.at)||!Number.isSafeInteger(now))return null;
 const age=now-x.at;
 const prefix=intent==='compras'?'📦 Compras — Grupo Erick (homologação)':
    '🎟️ LotoIA — duas lotéricas Erick';
 if(age<0||age>CACHE_MAX_MS||typeof x.reply!=='string'||
    Buffer.byteLength(x.reply,'utf8')>1500||!x.reply.startsWith(prefix)||
    !/Somente leitura\. Rastreio: [a-f0-9]{8}$/.test(x.reply))return null;
 return {reply:x.reply,at:x.at,age};
}
function cachedReply(x){
 const date=new Date(x.at).toLocaleString('pt-BR',{timeZone:'America/Recife',hour12:false});
 return x.reply+'\n\n⏱️ DADOS EM CACHE — consulta real de '+date+
  '. Não foi feita nova consulta; os valores podem ter mudado.';
}
const HISTORY_PROJECT='yxmdrrwqxwzsdgcgskrm';
const HISTORY_SOURCE='softcom_import.cadastro_de_vendas';
const HISTORY_STORES=['CALCADOS','SIRINHAEM','MAGAZINE',
 'SPORTS-(DESATIVADO)','ERICK SPORTS','VARIEDADES'];
const HISTORY_MONTHS=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
function safeHistorySnapshot(x,now=Date.now()){
 if(!x||x.version!==1||x.tenant_id!=='grupo_erick'||
  x.project_id!==HISTORY_PROJECT||x.source_table!==HISTORY_SOURCE||
  !Number.isSafeInteger(now)||typeof x.extracted_at!=='string'||
  !/^20\d{2}-\d{2}-\d{2}T/.test(x.extracted_at)||
  !Number.isFinite(Date.parse(x.extracted_at))||
  Date.parse(x.extracted_at)>now+60000||
  x.latest_sale_date!=='2026-06-08'||
  !Array.isArray(x.months)||x.months.length!==6||
  !Array.isArray(x.stores)||x.stores.length!==6)return false;
 let total=0,excluded=0,storeTotal=0,storeExcluded=0;
 for(let i=0;i<HISTORY_MONTHS.length;i++){
  const m=x.months[i];
  if(m?.month!==HISTORY_MONTHS[i]||!safeCount(m.registered)||
   !safeCount(m.marked_cancelled)||m.marked_cancelled>m.registered)return false;
  total+=m.registered;excluded+=m.marked_cancelled;
 }
 for(let i=0;i<HISTORY_STORES.length;i++){
  const v=x.stores[i];
  if(v?.raw_label!==HISTORY_STORES[i]||!safeCount(v.registered)||
   !safeCount(v.marked_cancelled)||v.marked_cancelled>v.registered)return false;
  storeTotal+=v.registered;storeExcluded+=v.marked_cancelled;
 }
 return total===storeTotal&&excluded===storeExcluded&&
  x.registered===total&&x.marked_cancelled===excluded&&
  x.registered<=1000000;
}
function historicalReply(intent,x,now=Date.now()){
 if(!safeHistorySnapshot(x,now))throw Error('historical_snapshot_unverified');
 const stamp=new Date(x.extracted_at).toLocaleString('pt-BR',{
  timeZone:'America/Recife',hour12:false});
 const root=['📚 Histórico de vendas — Grupo Erick',
  'Fonte: Supabase softcom-grupo-erick / softcom_import.cadastro_de_vendas',
  'Extração verificada: '+stamp,
  'Cobertura analisada: jan–8 jun/2026 (junho parcial; julho ausente)',
  'Registros no período: '+num.format(x.registered),
  'Marcados como cancelados: '+num.format(x.marked_cancelled),
  'Não marcados como cancelados: '+num.format(x.registered-x.marked_cancelled)];
 if(intent==='historico_lojas')
  root.push('Por código original de loja:',
   ...x.stores.map(v=>'• '+v.raw_label+': '+num.format(v.registered)+
    ' registros ('+num.format(v.marked_cancelled)+' marcados cancelados)'));
 if(intent==='historico_meses')
  root.push('Por mês:',
   ...x.months.map(v=>'• '+v.month+': '+num.format(v.registered)+
    ' registros ('+num.format(v.marked_cancelled)+' marcados cancelados)'));
 root.push('⚠️ Contagem de registros, NÃO faturamento nem vendas líquidas; códigos de lojas não conciliados.',
  'Snapshot privado e datado; nenhuma consulta online ao Supabase nesta resposta.',
  'Somente leitura; não consome quota de Compras/LotoIA.');
 return root.join('\n');
}
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
 send,saveOwner,savePairing,query,
 readCache=async()=>null,writeCache=async()=>{},readHistory=async()=>null,
 readLive=async()=>null,
 readAnalystContext=async()=>null,writeAnalystContext=async()=>{},
 readAnalyst=async()=>null,readAgent=async()=>null,agentEnabled=false,
 readDecisions=async()=>null,writeDecisions=async()=>{},
 readFinops=async()=>null,readAutocurated=async()=>null,readGovernedFallback=async()=>null,
 readBrain=async()=>{throw Error('brain_machine_reader_not_activated')}}){
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
 if(msg.text==='/cerebro'){
  await send(msg.userId,'🧠 Consulte o segundo cérebro central com /cerebro TERMO. Exemplo: /cerebro conciliação. Somente fontes aprovadas e ainda válidas.');
  return {kind:'answered',intent:'brain_help',source:'local_instruction'};
 }
 const brainMatch=msg.text.match(/^\/cerebro\s+(.+)$/i);
 if(brainMatch){
  let reply;
  try{
   const rows=await readBrain(brainMatch[1]);
   reply=brainReader.render(rows);
  }catch{
   reply='Segundo cérebro central indisponível ou não autorizado. Nenhuma memória foi inferida ou substituída por cache local.';
  }
  await send(msg.userId,reply);
  return {kind:'answered',intent:'brain_live',source:'supabase_brain_rls'};
 }
 if(msg.text==='/memorias'){
  let reply;
  try{
   reply=await readAutocurated();
   if(typeof reply!=='string'||reply.length>1700||
      !/^(🧠 Memórias automáticas|🧠 Hermes AutoMemory|Memória automática indisponível)/.test(reply))
    throw Error('autocurated_response_invalid');
  }catch{reply='Memórias automáticas indisponíveis; nenhuma informação foi liberada.';}
  await send(msg.userId,reply);
  return {kind:'answered',intent:'auto_memory',source:'trusted_structured'};
 }
 if(msg.text==='/economia'){
  let answer;
  try{answer=finops.response(await readFinops(),clock());}
  catch{answer='Métricas de IA indisponíveis ou inconsistentes; não serão estimadas.';}
  await send(msg.userId,answer);
  return {kind:'answered',intent:'inference_finops',source:'local_aggregate'};
 }
 // A bounded, static financial diagnostic from approved saved sources only.
 // No LLM, no database read, no implicit execution authority.
 if(msg.text==='/alertas historicos'){
  let answer;
  try{
   const raw=await readLive({tenant_id:'grupo_erick',shape:'matrix'});
   if(raw?.denied_status==='history_budget_exhausted'){
    answer='Limite privado de consultas históricas atingido; alertas não gerados nem estimados.';
   }else{
    answer=alerts.render({
     snapshot:await readHistory(),aggregate:raw,decisions:await readDecisions(),
     now:clock(),validSnapshot:safeHistorySnapshot
    });
   }
  }catch{
   answer='Alertas indisponíveis: evidências ou decisões não passaram na validação. Nenhum indicador foi presumido.';
  }
  await send(msg.userId,answer);
  return {kind:'answered',intent:'business_history_alerts',source:'approved_history_aggregate'};
 }
 if(msg.text==='/diagnostico cruzamento'){
  let answer;
  try{
   const raw=await readLive({tenant_id:'grupo_erick',shape:'matrix'});
   if(raw?.denied_status==='history_budget_exhausted')
    answer='Limite privado de consultas históricas atingido; o cruzamento não foi consultado nem estimado.';
   else answer=matrix.render({
    snapshot:await readHistory(),aggregate:raw,now:clock(),
    validSnapshot:safeHistorySnapshot
   });
  }catch{
   answer='Cruzamento mês × código indisponível: a consulta ou conciliação não passou nos controles. Nenhum indicador foi presumido.';
  }
  await send(msg.userId,answer);
  return {kind:'answered',intent:'business_diagnostic_matrix',source:'approved_history_aggregate'};
 }
 if(msg.text==='/diagnostico lojas'){
  let answer;
  try{answer=diagnostic.byStore({
   snapshot:await readHistory(),now:clock(),validSnapshot:safeHistorySnapshot
  });}
  catch{answer='Indicadores por loja indisponíveis: o snapshot original não passou na validação. Nenhuma taxa foi presumida.';}
  await send(msg.userId,answer);
  return {kind:'answered',intent:'business_diagnostic_store',source:'verified_snapshot_raw_labels'};
 }
 if(msg.text==='/diagnostico'){
  let answer;
  try{answer=diagnostic.build({
   snapshot:await readHistory(),decisions:await readDecisions(),
   now:clock(),validSnapshot:safeHistorySnapshot
  });}
  catch{answer='Diagnóstico indisponível: não consegui validar o histórico e a memória financeira. Nenhum indicador foi presumido.';}
  await send(msg.userId,answer);
  return {kind:'answered',intent:'business_diagnostic',source:'verified_snapshot_and_confirmed_decisions'};
 }
 // The owner explicitly proposes then confirms a structured human decision.
 // Never promote model advice automatically, and never grant execution rights.
 if(ownerDecisions.isCommand(msg.text)){
  let reply;
  try{
   const data=ownerDecisions.handle(msg.text,await readDecisions(),clock());
   if(data.changed)await writeDecisions(data.store);
   reply=data.reply;
  }catch{
   reply='Não consegui validar ou registrar a memória de decisão. Nada foi confirmado.';
  }
  await send(msg.userId,reply);
  return {kind:'answered',intent:'owner_decision',source:'human_confirmation_only'};
 }
 // Explicit matched-year cancellation rates are a deterministic read path.
 // This is not a backdoor to LLM quota: no model call, no write, one bounded
 // historical template governed by the existing history budget and owner gate.
 if(cancellationRateRequest(msg.text)){
  let response,cache='miss';
  try{
   const data=await readAnalyst(CANCEL_RATE_PLAN);
   if(data?.denied_status==='history_budget_exhausted'){
    response='Limite diário de consultas históricas atingido. Não consultei dados novos nem estimei taxas.';
   }else{
    response=analyst.reply(data,CANCEL_RATE_PLAN);
    if(data.cached===true){
     cache='hit';
     response+='\n\n⏱️ Consulta validada reutilizada do cache, com data da fonte acima.';
    }
    if(advisoryRequest(msg.text)){
     response+='\n\nOrientações padronizadas (hipóteses, não causas comprovadas):'+
      '\n1. Auditar uma amostra de cancelamentos por mês, loja e motivo.'+
      '\n2. Conferir lançamentos, estornos e duplicidades com os registros oficiais.'+
      '\n3. Conciliar valores com ERP e recebimentos antes de avaliar perdas e tomar decisões.'+
      '\n⚠️ A taxa de cancelamento não mede prejuízo, receita perdida ou liquidez.';
    }
   }
  }catch{
   response='A comparação histórica não pôde ser validada. Não apresentarei taxas presumidas.';
  }
  await send(msg.userId,response);
  return {kind:'answered',intent:'business_cancel_rate',cache,source:'softcom_analyst'};
 }
 // Owner-only advisory requests go to the governed LLM so it can retrieve
 // business evidence and produce recommendations with fresh verified tools.
 // Direct numeric questions and slash commands retain fixed, cheaper routes.
 const useAgent=agentEnabled&&advisoryRequest(msg.text);
 const previous=useAgent?null:await readAnalystContext();
 const plan=useAgent?null:analyst.planQuestion(msg.text,previous);
 const intent=useAgent?'unknown':plan?'business_analyst':intentFor(msg.text);
 if(intent==='help'){await send(msg.userId,HELP);return {kind:'answered',intent};}
 if(intent==='unknown'){
  if(!agentEnabled){
   await send(msg.userId,'Ainda não tenho essa operação liberada.\n\n'+HELP);
   return {kind:'unsupported',intent};
  }
  let response,modelAccounting=null,cache='miss',failureCode=null;
  try{
   const result=await readAgent(msg.text);
   if(typeof result?.answer!=='string'||result.answer.length>3150||
      !result.answer.startsWith('🧠 Hermes — análise orientada por evidências'))
    throw Error('agent_output_invalid');
   response=result.answer;
   if((result.llm_calls===0||result.llm_calls===1||result.llm_calls===2)&&
    ['verified_answer_cache_v1','static_verified_history_v1','governed_model_planner'].includes(result.planning_policy))
    modelAccounting={llm_calls:result.llm_calls,planning_policy:result.planning_policy};
   if(result.cache==='hit'&&result.llm_calls===0)cache='hit';
  }catch(error){
   const code=typeof error?.message==='string'?error.message:'unknown';
   if(fallback.permitted(code)){
    try{
     response=await readGovernedFallback(msg.text,code);
     if(typeof response!=='string'||response.length>1800||
      !response.startsWith('🧠 Hermes — leitura histórica disponível'))
      throw Error('fallback_response_denied');
     failureCode=code;
    }catch{
     response=code==='agent_daily_quota'?
      'O limite privado de 4 análises com Codex por dia (UTC) foi atingido. Nenhuma nova chamada foi feita. As consultas históricas numéricas continuam sujeitas à quota própria.':
      'A análise com IA não pôde ser concluída e não foi possível validar memórias para uma leitura alternativa. Nenhuma ação foi executada.';
     failureCode=code;
    }
   }else{
    response='Esta análise não pôde ser concluída com fontes verificáveis e ferramentas autorizadas. Não executei nenhuma ação.';
    failureCode='validation_denied';
   }
  }
  await send(msg.userId,response);
  return {kind:'answered',intent:'governed_agent',source:'governed_read_only',cache,
   ...(failureCode?{failure_code:failureCode}:{}),
   ...(modelAccounting||{})};
 }
 if(intent==='business_analyst'){
  let response,cache='miss';
  try{
   const data=await readAnalyst(plan);
   if(data?.denied_status==='history_budget_exhausted'){
    response='Limite diário de análises históricas alcançado; nenhum dado novo consultado.';
   }else{
    response=analyst.reply(data,plan);
    if(data.cached===true){cache='hit';response+='\n\n⏱️ Resposta reutilizada de cache validado ('+new Date(data.at).toLocaleString('pt-BR',{timeZone:'America/Recife'})+').';}
    await writeAnalystContext({tenant_id:'grupo_erick',template:plan.template,metric:plan.metric,period:plan.period,other_period:plan.other_period,store:plan.store});
   }
  }catch{
   response='Não consegui validar essa análise no banco. Não vou apresentar números presumidos.';
  }
  await send(msg.userId,response);
  return {kind:'answered',intent,cache,source:'softcom_analyst'};
 }
 if(intent==='historico_live'){
  const req=parseSalesCommand(msg.text);
  let response;
  try{
   const data=await readLive(req);
   response=data?.denied_status==='history_budget_exhausted'?
    'Limite privado de consultas históricas alcançado. Não executei nova leitura.':
    historicalLiveReply(data,req);
  }catch{
   response='Consulta dinâmica indisponível ou não autorizada. O histórico anterior permanece acessível em /historico.';
  }
  await send(msg.userId,response);
  return {kind:'answered',intent,source:'softcom_live'};
 }
 if(['historico','historico_lojas','historico_meses'].includes(intent)){
  let response;
  try{response=historicalReply(intent,await readHistory(),clock());}
  catch{response='Histórico ainda indisponível ou não validado. Não exibirei números não verificados.';}
  await send(msg.userId,response);
  return {kind:'answered',intent,source:'softcom_snapshot'};
 }
 let response,cacheStatus=null;
 try{
  const isDomain=intent==='compras'||intent==='lotoia';
  const cached=isDomain?verifiedCache(await readCache(intent),msg.userId,intent,clock()):null;
  if(cached&&cached.age<=CACHE_REUSE_MS){
   await send(msg.userId,cachedReply(cached));
   return {kind:'answered',intent,cache:'hit'};
  }
  const data=await query(intent,ROUTES[intent]);
  if(data?.denied_status==='request_budget_exhausted'){
   response=cached?cachedReply(cached)+
    '\n⚠️ Quota compartilhada esgotada; exibindo apenas a leitura anterior.':
    'Limite compartilhado de 12 consultas em 24h atingido. Não repetirei a consulta.';
   cacheStatus=cached?'quota_fallback':'miss';
  }else if(data?.denied_status){
   response='Consulta indisponível. Nenhum dado foi considerado confirmado.';
  }else{
   response=hermesReply(intent,data);
   if(isDomain){
    const record={owner_id:msg.userId,tenant_id:'grupo_erick',intent,at:clock(),reply:response};
    if(Buffer.byteLength(JSON.stringify(record),'utf8')<=2048){
     try{await writeCache(intent,record);cacheStatus='stored';}
     catch{cacheStatus='store_failed';}
    }else cacheStatus='oversize';
   }
  }
 }catch{
  response='Não consegui validar a resposta na origem. Nenhum dado foi tratado como confirmado.';
 }
 await send(msg.userId,response);
 return {kind:'answered',intent,cache:cacheStatus};
}
module.exports={ROUTES,HELP,intentFor,advisoryRequest,privateMessage,pairValid,hermesReply,verifiedCache,cachedReply,safeHistorySnapshot,historicalReply,cancellationRateRequest,processUpdate};
