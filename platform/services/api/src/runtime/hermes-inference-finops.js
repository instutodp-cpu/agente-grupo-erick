'use strict';
// No text, IDs, secrets, prompts, generated answers, or inferred token counts.
// The current Codex login bridge only returns text, not provider usage.
const SCHEMA=1,TENANT='grupo_erick',SCOPE='enterprise',KEEP_DAYS=7;
const ROUTES=Object.freeze(['verified_answer_cache_v1','static_verified_history_v1',
 'governed_model_planner','other']);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const validCount=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000;
function emptyDay(date){
 return {date,requests:0,zero_model:0,static_route:0,governed_route:0,
  cache_hits:0,provider_calls:0,provider_ok:0,provider_fail:0,
  duration_ms:0,usage_status:'unavailable',tokens_in:null,tokens_out:null,
  cost_usd:null,model_id:'unreported'};
}
function day(date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
  new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
  throw Error('finops_day_denied');
 return date;
}
function validate(raw){
 if(raw==null)return {schema:SCHEMA,tenant_id:TENANT,scope:SCOPE,days:[]};
 if(!exact(raw,['schema','tenant_id','scope','days'])||raw.schema!==SCHEMA||
  raw.tenant_id!==TENANT||raw.scope!==SCOPE||!Array.isArray(raw.days)||
  raw.days.length>KEEP_DAYS)throw Error('finops_store_denied');
 const seen=new Set();
 for(const d of raw.days){
  const e=emptyDay(d?.date);
  if(!exact(d,Object.keys(e))||seen.has(d.date))throw Error('finops_shape_denied');
  day(d.date);seen.add(d.date);
  for(const k of ['requests','zero_model','static_route','governed_route',
   'cache_hits','provider_calls','provider_ok','provider_fail','duration_ms']){
   if(!validCount(d[k]))throw Error('finops_count_denied');
  }
  if(d.provider_calls!==d.provider_ok+d.provider_fail||
   d.zero_model>d.requests||d.cache_hits>d.zero_model||
   d.static_route+d.governed_route>d.requests||
   d.usage_status!=='unavailable'||d.tokens_in!==null||d.tokens_out!==null||
   d.cost_usd!==null||d.model_id!=='unreported')throw Error('finops_usage_denied');
 }
 return raw;
}
function bump(raw,record,now=Date.now()){
 const state=validate(raw),date=day(new Date(now).toISOString().slice(0,10));
 const next=state.days.find(x=>x.date===date)?{...state.days.find(x=>x.date===date)}:emptyDay(date);
 if(!exact(record,['kind','route','ok','duration_ms','cache_hit'])||
  !['provider_call','outcome'].includes(record.kind)||!ROUTES.includes(record.route)||
  typeof record.ok!=='boolean'||typeof record.cache_hit!=='boolean'||
  !Number.isSafeInteger(record.duration_ms)||record.duration_ms<0||record.duration_ms>90000)
  throw Error('finops_event_denied');
 if(record.kind==='provider_call'){
  if(record.cache_hit)throw Error('finops_event_denied');
  next.provider_calls++;next.provider_ok+=Number(record.ok);
  next.provider_fail+=Number(!record.ok);next.duration_ms+=record.duration_ms;
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
  'Roteamentos históricos estáticos: '+s.static_route+'\n'+
  'Roteamentos por modelo: '+s.governed_route+'\n'+
  'Chamadas reais ao modelo: '+s.provider_calls+
  ' (sucesso '+s.provider_ok+', falha '+s.provider_fail+')\n'+
  'Latência média por chamada: '+(avg===null?'sem amostras':avg+' ms')+'\n'+
  'Provedor: Codex Login (modelo exato não informado)\n'+
  'Tokens/custo: indisponíveis no bridge atual — não estimados.\n'+
  'Contabilização iniciada com V14; métricas anteriores não reconstruídas.\n'+
  'Somente métricas agregadas. Sem dados pessoais.';
}
module.exports={SCHEMA,TENANT,SCOPE,ROUTES,validate,bump,snapshot,response};
