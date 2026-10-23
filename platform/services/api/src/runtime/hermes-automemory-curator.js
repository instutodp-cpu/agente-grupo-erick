'use strict';
// Autonomous corporate memory pilot. Only pre-authorized, validated structured sources;
// never raw messages, personal feeds, scraped mail or model-generated orders.
const crypto=require('node:crypto');
const decision=require('./hermes-owner-decision-memory');
const evidence=require('./hermes-business-evidence-memory');
const TENANT='grupo_erick',DAY=86400000;
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const forbidden=/\b(?:cpf|cnpj|senha|password|token|api.key|pix|telefone|e-?mail)\b/i;
function check(store,now=Date.now()){
 if(store==null)return {schema:1,tenant_id:TENANT,date:null,items:[]};
 if(!store||store.schema!==1||store.tenant_id!==TENANT||
  !Array.isArray(store.items)||store.items.length>40||
  Buffer.byteLength(JSON.stringify(store),'utf8')>32000||
  (store.date!==null&&!/^20\d\d-\d\d-\d\d$/.test(store.date)))throw Error('autocurated_store_invalid');
 const ids=new Set();
 for(const m of store.items){
  if(!m||m.tenant_id!==TENANT||m.visibility!=='owner_only'||
    !['durable','short'].includes(m.retention)||
    !['confirmed_decision','verified_aggregate'].includes(m.kind)||
    (m.kind==='confirmed_decision')!==(m.retention==='durable')||
    !/^[a-f0-9]{64}$/.test(m.id)||ids.has(m.id)||
    !/^[a-z][a-z0-9_]{0,63}$/.test(m.domain)||
    typeof m.source!=='string'||m.source.length>130||
    typeof m.text!=='string'||m.text.length<12||m.text.length>420||forbidden.test(m.text)||
    !Number.isFinite(Date.parse(m.at))||!Number.isFinite(Date.parse(m.expires_at))||
    Date.parse(m.expires_at)<=Date.parse(m.at)||Date.parse(m.at)>now+60000)
      throw Error('autocurated_item_invalid');
  ids.add(m.id);
 }
 return store;
}
function compactVerifiedEvidence(summary){
 const lines=summary.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const heading=lines.find(x=>/^(Comparação — |Ranking das lojas por |Produtos por |Período: )/.test(x));
 const measured=lines.filter(x=>x.startsWith('• '));
 if(!heading||!measured.length)throw Error('memory_metrics_missing');
 const result=[heading],limit=410;
 if(lines.some(x=>x.startsWith('📅 Cobertura equivalente:')))
  result.push('Cobertura: jan–mai completos em ambos os anos.');
 for(const line of measured){
  if(line.length>300||forbidden.test(line))continue;
  if(result.join(' | ').length+3+line.length>limit)continue;
  result.push(line);
 }
 if(result.length < (result[1]?.startsWith('Cobertura:')?3:2))
  throw Error('memory_metrics_omitted');
 return result.join(' | ');
}
function curate({ownerDecisions,businessEvidence,previous=null,now=Date.now(),policy}={}){
 if(!Number.isSafeInteger(now)||!policy||policy.enabled!==true||
   policy.tenant_id!==TENANT||typeof policy.decisions!=='boolean'||
   typeof policy.aggregates!=='boolean')throw Error('autocurated_policy_denied');
 check(previous,now);
 const entries=[];
 if(policy.decisions){
  for(const e of decision.validateStore(ownerDecisions,now).entries){
   const at=Date.parse(e.confirmed_at);
   if(at>now||now-at>=180*DAY)continue;
   const text='Decisão confirmada: '+e.decision+'. Justificativa: '+e.rationale;
   if(text.length>420||forbidden.test(text))continue;
   entries.push({id:digest(TENANT+':decision:'+e.id),tenant_id:TENANT,
    kind:'confirmed_decision',retention:'durable',visibility:'owner_only',
    domain:e.area,source:'owner_confirmed_telegram:'+e.id,text,at:e.confirmed_at,
    expires_at:new Date(at+180*DAY).toISOString()});
  }
 }
 if(policy.aggregates){
  for(const e of evidence.validStore(businessEvidence,now).entries){
   const at=Date.parse(e.at);
   if(at>now||now-at>=14*DAY)continue;
   let text;
   try{text=compactVerifiedEvidence(e.summary)}catch{continue}
   if(text.length<12||forbidden.test(text))continue;
   entries.push({id:digest(TENANT+':verified:'+e.key+':'+e.at),tenant_id:TENANT,
    kind:'verified_aggregate',retention:'short',visibility:'owner_only',
    domain:'comercial',source:e.source,text,at:e.at,
    expires_at:new Date(at+14*DAY).toISOString()});
  }
 }
 const ordered=entries.sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id));
 const durable=ordered.filter(e=>e.retention==='durable');
 if(durable.length>40)throw Error('autocurated_protected_capacity');
 const items=[...durable,...ordered.filter(e=>e.retention==='short').slice(0,40-durable.length)]
  .sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id));
 const out={schema:1,tenant_id:TENANT,date:new Date(now).toISOString().slice(0,10),items};
 check(out,now);
 return out;
}
function render(store,now=Date.now()){
 const active=check(store,now).items.filter(m=>Date.parse(m.expires_at)>now);
 if(!active.length)return '🧠 Memórias automáticas: nenhuma fonte elegível consolidada.';
 const lines=['🧠 Hermes AutoMemory — Grupo Erick (staging)',
  'Fontes permitidas. Memória não é autorização para executar.'];
 for(const m of active.slice(0,4)){
  const line='• '+(m.retention==='durable'?'Decisão':'Histórico')+
   ' ['+m.domain+'] '+m.at.slice(0,10)+': '+m.text.replace(/[\r\n]+/g,' ');
  if((lines.join('\n')+'\n'+line).length>1360)continue;
  lines.push(line);
 }
 lines.push('Evidências históricas não substituem a fonte atual.');
 return lines.join('\n');
}
module.exports={curate,check,render};
