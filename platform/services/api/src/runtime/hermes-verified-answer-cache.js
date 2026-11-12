'use strict';
// Enterprise-only, exact-goal cached synthesis, never semantic matching.
// Input digest includes all freshly validated source evidence, confirmed
// decisions, answer policy version and the exact normalized owner question.
const crypto=require('node:crypto');
const VERSION=1,TENANT='grupo_erick',SCOPE='enterprise';
const TTL_MS=20*60*1000,MAX_ENTRIES=6,MAX_ANSWER=3150;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
function key({goal,evidence,decisions,answerPolicy,plan,now}){
 if(typeof goal!=='string'||goal.length<8||goal.length>600||
  !Array.isArray(evidence)||evidence.length!==1||
  !exact(evidence[0],['source','summary'])||
  typeof evidence[0].source!=='string'||!evidence[0].source.startsWith('hermes_history.')||
  typeof evidence[0].summary!=='string'||!evidence[0].summary.startsWith('📊 Hermes')||
  evidence[0].summary.length>2200||
  !Array.isArray(decisions)||decisions.length>2||
  typeof answerPolicy!=='string'||answerPolicy.length>2500||
  !exact(plan,['tenant_id','template','period','other_period','metric','store'])||
  plan.tenant_id!==TENANT||!Number.isSafeInteger(now))
  throw Error('answer_cache_fingerprint_denied');
 // Source lookup time is transport metadata, not the business data version.
 // Current-source verification still runs for EVERY reuse, but identical
 // records with a new "Consultado em" timestamp must have the same key.
 const meaningfulEvidence=evidence.map(e=>({...e,
  summary:e.summary.replace(/^Consultado em:.*$/m,'Consultado em: [revalidado]')}));
 return digest({version:VERSION,tenant:TENANT,scope:SCOPE,
  goal:goal.normalize('NFC'),evidence:meaningfulEvidence,decisions,answerPolicy,plan});
}
function safeAnswer(answer){
 if(typeof answer!=='string'||answer.length<80||answer.length>MAX_ANSWER||
  !answer.startsWith('🧠 Hermes — análise orientada por evidências')||
  !answer.includes('Fontes verificadas: hermes_history.')||
  !answer.includes('⚠️ Staging e somente leitura.')||
  /https?:\/\/|www\.|@[\w.-]+|\b(?:cpf|cnpj|senha|password|token|chave pix|segredo)\b|\b\d{9,}\b/i.test(answer))
  throw Error('answer_cache_content_denied');
 return answer;
}
function validate(store,now=Date.now()){
 if(store===null||store===undefined)return {schema:VERSION,tenant_id:TENANT,scope:SCOPE,entries:[]};
 if(!exact(store,['schema','tenant_id','scope','entries'])||
  store.schema!==VERSION||store.tenant_id!==TENANT||store.scope!==SCOPE||
  !Array.isArray(store.entries)||store.entries.length>MAX_ENTRIES)throw Error('answer_cache_store_denied');
 const seen=new Set();
 for(const item of store.entries){
  if(!exact(item,['key','at','answer'])||
   typeof item.key!=='string'||!/^[0-9a-f]{64}$/.test(item.key)||
   !Number.isSafeInteger(item.at)||item.at<0||item.at>now+60000||
   seen.has(item.key))throw Error('answer_cache_entry_denied');
  seen.add(item.key);
  safeAnswer(item.answer);
 }
 return store;
}
function lookup(store,fingerprint,now=Date.now()){
 const state=validate(store,now);
 if(typeof fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(fingerprint))throw Error('answer_cache_key_denied');
 const item=state.entries.find(x=>x.key===fingerprint);
 if(!item||now-item.at<0||now-item.at>TTL_MS)return null;
 return {answer:item.answer,recorded_at:item.at};
}
function remember(store,fingerprint,answer,now=Date.now()){
 const state=validate(store,now);
 if(typeof fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(fingerprint)||
 !Number.isSafeInteger(now))throw Error('answer_cache_key_denied');
 safeAnswer(answer);
 const entries=state.entries.filter(x=>x.key!==fingerprint&&now-x.at<=TTL_MS)
  .slice(-(MAX_ENTRIES-1)).concat({key:fingerprint,at:now,answer});
 return validate({schema:VERSION,tenant_id:TENANT,scope:SCOPE,entries},now);
}
module.exports={VERSION,TENANT,SCOPE,TTL_MS,MAX_ENTRIES,key,safeAnswer,validate,lookup,remember};
