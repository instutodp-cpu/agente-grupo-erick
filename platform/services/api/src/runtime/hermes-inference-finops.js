'use strict';
// No text, IDs, secrets, prompts, generated answers, or inferred token counts.
// The current Codex login bridge only returns text, not provider usage.
const SCHEMA=2,TENANT='grupo_erick',SCOPE='enterprise',KEEP_DAYS=7;
const ROUTES=Object.freeze(['verified_answer_cache_v1','static_verified_history_v1',
 'governed_model_planner','other',
 'direct_history','direct_domain','direct_decision','direct_information']);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const validCount=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000;
const DIRECT=['direct_requests','direct_cache_hits','direct_history',
 'direct_domain','direct_decision','direct_information'];
function emptyDay(date){
 return {date,requests:0,zero_model:0,static_route:0,governed_route:0,
  cache_hits:0,provider_calls:0,provider_ok:0,provider_fail:0,
  duration_ms:0,usage_status:'unavailable',tokens_in:null,tokens_out:null,
  cost_usd:null,model_id:'unreported',
  direct_requests:0,direct_cache_hits:0,direct_history:0,
  direct_domain:0,direct_decision:0,direct_information:0};
}
function legacyDay(date){const d=emptyDay(date);for(const k of DIRECT)delete d[k];return d;}
function day(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
  new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
  throw Error('finops_day_denied');
 return date;
}
function validate(raw){
 if(raw==null)return {schema:SCHEMA,tenant_id:TENANT,scope:SCOPE,days:[]};
 const legacy=raw?.schema===1;
 if(!exact(raw,['schema','tenant_id','scope','days'])||
  ![1,SCHEMA].includes(raw.schema)||
  raw.tenant_id!==TENANT||raw.scope!==SCOPE||!Array.isArray(raw.days)||
  raw.days.length>KEEP_DAYS)throw Error('finops_store_denied');
 const seen=new Set();
 for(const d of raw.days){
  const e=legacy?legacyDay(d?.date):emptyDay(d?.date);
  if(!exact(d,Object.keys(e))||seen.has(d.date))throw Error('finops_shape_denied');
  day(d.date);seen.add(d.date);
  for(const k of ['requests','zero_model','static_route','governed_route',
   'cache_hits','provider_calls','provider_ok','provider_fail','duration_ms',
   ...(legacy?[]:DIRECT)]){
   if(!validCount(d[k]))throw Error('finops_count_denied');
  }
  if(d.provider_calls!==d.provider_ok+d.provider_fail||
   d.zero_model>d.requests||d.cache_hits>d.zero_model||
   d.static_route+d.governed_route>d.requests||
   d.usage_status!=='unavailable'||d.tokens_in!==null||d.tokens_out!==null||
   d.cost_usd!==null||d.model_id!=='unreported'||
   (!legacy&&(d.direct_cache_hits>d.direct_requests||
    d.direct_history+d.direct_domain+d.direct_decision+
    d.direct_information!==d.direct_requests)))throw Error('finops_usage_denied');
 }
 return legacy?{...raw,schema:SCHEMA,days:raw.days.map(d=>({...d,
  ...Object.fromEntries(DIRECT.map(k=>[k,0]))}))}:raw;
}
function bump(raw,record,now=Date.now()){
 const state=validate(raw),date=day(new Date(now).toISOString().slice(0,10));
 const next=state.days.find(x=>x.date===date)?{...state.days.find(x=>x.date===date)}:emptyDay(date);
 if(!exact(record,['kind','route','ok','duration_ms','cache_hit'])||
  !['provider_call','outcome','direct_outcome'].includes(record.kind)||!ROUTES.includes(record.route)||
  typeof record.ok!=='boolean'||typeof record.cache_hit!=='boolean'||
  !Number.isSafeInteger(record.duration_ms)||record.duration_ms<0||record.duration_ms>90000)
  throw Error('finops_event_denied');
 if(record.kind==='provider_call'){
  if(record.cache_hit)throw Error('finops_event_denied');
  next.provider_calls++;next.provider_ok+=Number(record.ok);
  next.provider_fail+=Number(!record.ok);next.duration_ms+=record.duration_ms;
 }else if(record.kind==='direct_outcome'){
  if(!record.ok||!['direct_history','direct_domain','direct_decision',
   'direct_information'].includes(record.route))throw Error('finops_direct_denied');
  next.direct_requests++;
  next[record.route]++;
  next.direct_cache_hits+=Number(record.cache_hit);
 }else{
  next.requests++;
  if(record.cache_hit){next.cache_hits++;next.zero_model++;}
  if(record.route==='static_verified_history_v1')next.static_route++;
  if(record.route==='governed_model_planner')next.governed_route++;
 }
 const days=state.days.filter(x=>x.date!==date)
  .concat(next).sort((a,b)=>a.date.localeCompare(b.date)).slice(-KEEP_DAYS);
 return validate({...state,days});
}
function snapshot(raw,now=Date.now()){
 const state=validate(raw),date=day(new Date(now).toISOString().slice(0,10));
 return state.days.find(x=>x.date===date)||emptyDay(date);
}
function response(raw,now=Date.now()){
 const s=snapshot(raw,now);
 const avg=s.provider_calls?Math.round(s.duration_ms/s.provider_calls):null;
 return '📉 Hermes — Economia de IA (staging)\n'+
  'Data UTC: '+s.date+'\n'+
  'Solicitações ao fluxo governado: '+s.requests+'\n'+
  'Reutilizações verificadas (0 LLM): '+s.cache_hits+'\n'+
  'Respostas por rotas diretas (0 LLM): '+s.direct_requests+'\n'+
  '• Histórico: '+s.direct_history+' | Compras/LotoIA: '+s.direct_domain+'\n'+
  '• Decisões: '+s.direct_decision+' | Comandos informativos: '+s.direct_information+'\n'+
  'Cache nas rotas diretas: '+s.direct_cache_hits+'\n'+
  'Roteamentos históricos estáticos: '+s.static_route+'\n'+
  'Roteamentos por modelo: '+s.governed_route+'\n'+
  'Chamadas reais ao modelo: '+s.provider_calls+
  ' (sucesso '+s.provider_ok+', falha '+s.provider_fail+')\n'+
  'Latência média por chamada: '+(avg===null?'sem amostras':avg+' ms')+'\n'+
  'Provedores: Codex Login (primário) e OpenRouter Auto (secundário quando habilitado).\n'+
  'Rota por chamada: evento seguro model_provider_call no registro de auditoria.\n'+
  'Tokens/custo: indisponíveis no bridge atual — não estimados.\n'+
  'Contabilização iniciada com V14; métricas anteriores não reconstruídas.\n'+
  'Somente métricas agregadas. Sem dados pessoais.';
}
module.exports={SCHEMA,TENANT,SCOPE,ROUTES,validate,bump,snapshot,response};
