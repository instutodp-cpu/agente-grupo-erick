'use strict';
// First operational ENTERPRISE-only Context Assembly input.
// This is a bounded, owner-only, source-grounded evidence index, NOT the
// simulation Agent Memory Registry and NOT a personal/conversation memory.
const crypto=require('node:crypto');
const analyst=require('./hermes-analyst-templates');
const TENANT='grupo_erick',KIND='historical_aggregate_v1';
const MAX_ENTRIES=12,MAX_AGE_MS=14*86400000,MAX_CONTEXT=1500;
const SCHEMA=1;
function shape(o,fields){
 return o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===fields.slice().sort().join('|');
}
function normalizeEntry(data,plan,now=Date.now()){
 const p=analyst.validate(plan);
 if(!shape(data,['tenant_id','mode','source','at','plan','rows'])||
 data.tenant_id!==TENANT||data.mode!=='online_aggregate'||!Array.isArray(data.rows))throw Error('memory_data_denied');
 const summary=analyst.reply(data,p);
 if(summary.length>1800||!summary.startsWith('📊 Hermes'))throw Error('memory_summary_denied');
 const timestamp=Date.parse(data.at);
 if(!Number.isFinite(timestamp)||timestamp>now+60000||timestamp<now-MAX_AGE_MS)throw Error('memory_time_denied');
 const key=crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0,24);
 return {kind:KIND,tenant_id:TENANT,scope:'enterprise',
   key,at:data.at,period:p.period,other_period:p.other_period,
   template:p.template,metric:p.metric,source:data.source,
   summary};
}
function validEntry(e,now=Date.now()){
 if(!shape(e,['kind','tenant_id','scope','key','at','period','other_period','template','metric','source','summary'])||
 e.kind!==KIND||e.tenant_id!==TENANT||e.scope!=='enterprise'||
 typeof e.key!=='string'||!/^[a-f0-9]{24}$/.test(e.key)||
 typeof e.at!=='string'||!Number.isFinite(Date.parse(e.at))||
 Date.parse(e.at)>now+60000||
 typeof e.summary!=='string'||e.summary.length<50||e.summary.length>1800||
 !e.summary.startsWith('📊 Hermes')||
 !['period','compare','stores','products'].includes(e.template)||
 !['money','records','cancelled'].includes(e.metric)||
 !analyst.isPeriod(e.period)||
 e.other_period!==null&&(typeof e.other_period!=='string'||!analyst.isPeriod(e.other_period))||
 e.source!==(e.template==='products'?analyst.PRODUCT_SOURCE:analyst.SOURCE))throw Error('memory_entry_denied');
 return e;
}
function validStore(store,now=Date.now()){
 if(store==null)return {schema:SCHEMA,tenant_id:TENANT,scope:'enterprise',entries:[]};
 if(!shape(store,['schema','tenant_id','scope','entries'])||
  store.schema!==SCHEMA||store.tenant_id!==TENANT||store.scope!=='enterprise'||
  !Array.isArray(store.entries)||store.entries.length>MAX_ENTRIES)throw Error('memory_store_denied');
 const keys=new Set();
 for(const e of store.entries){validEntry(e,now);if(keys.has(e.key))throw Error('memory_duplicate');keys.add(e.key);}
 // Expired but otherwise valid entries must be evicted, never poison future reads.
 return {...store,entries:store.entries.filter(e=>now-Date.parse(e.at)<=MAX_AGE_MS)};
}
function observe(store,data,plan,now=Date.now()){
 const current=validStore(store,now);
 const next=normalizeEntry(data,plan,now);
 const entries=current.entries.filter(e=>e.key!==next.key).concat(next)
  .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,MAX_ENTRIES);
 return validStore({schema:SCHEMA,tenant_id:TENANT,scope:'enterprise',entries},now);
}
function context(store,goal,now=Date.now()){
 const current=validStore(store,now);
 if(typeof goal!=='string'||goal.length>600)throw Error('memory_goal_denied');
 const normalized=analyst.normalize(goal);
 const years=[...normalized.matchAll(/\b20[0-9]{2}\b/g)].map(x=>x[0]);
 const pool=current.entries.filter(e=>!years.length||
  years.some(y=>e.period.startsWith(y)||e.other_period?.startsWith(y)));
 const facts=pool.slice(0,3).map(e=>({
  scope:e.scope,source:e.source,queried_at:e.at,period:e.period,
  other_period:e.other_period,summary:e.summary.slice(0,410)
 }));
 const result=JSON.stringify(facts);
 if(result.length>MAX_CONTEXT)throw Error('memory_context_oversize');
 return result;
}
module.exports={KIND,TENANT,MAX_ENTRIES,SCHEMA,normalizeEntry,validEntry,validStore,observe,context};
