'use strict';
// Owner-confirmed decision register. This is NOT the Agent Memory Registry
// simulation and grants ZERO authority to execute any business operation.
const {randomBytes}=require('node:crypto');
const TENANT='grupo_erick',SCOPE='enterprise',SCHEMA=1,MAX=40;
const TTL=10*60*1000;
const CATEGORIES=Object.freeze(['financeiro','compras','comercial','operacoes','marketing','rh']);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
const validTime=(str,now,maxFuture=60000)=>typeof str==='string'&&
 /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(str)&&
 Number.isFinite(Date.parse(str))&&Date.parse(str)<=now+maxFuture;
function safeText(value,max,min=12){
 if(typeof value!=='string')throw Error('decision_text_denied');
 const text=value.trim().replace(/ +/g,' ');
 if(text.length<min||text.length>max||
  /[\u0000-\u001f\u007f<>|{}\[\]\\]/.test(text)||
  /https?:|www\.|@|(?:cpf|cnpj|senha|token|chave\s*pix|pagar|transferir|executar|autorizar\s+pagamento)\b/i.test(text)||
  /\b\d{9,}\b/.test(text))throw Error('decision_text_denied');
 return text;
}
function validateEntry(e,now){
 if(!exact(e,['id','area','decision','rationale','source','proposed_at','confirmed_at'])||
  !/^[a-f0-9]{12}$/.test(e.id)||!CATEGORIES.includes(e.area)||
  e.source!=='owner_confirmed_telegram'||!validTime(e.proposed_at,now)||
  !validTime(e.confirmed_at,now)||
  Date.parse(e.confirmed_at)<Date.parse(e.proposed_at))throw Error('decision_record_denied');
 safeText(e.decision,170);safeText(e.rationale,220);
 return e;
}
function validateStore(store,now=Date.now()){
 if(store==null)return {schema:SCHEMA,tenant_id:TENANT,scope:SCOPE,entries:[],pending:null};
 if(!exact(store,['schema','tenant_id','scope','entries','pending'])||
  store.schema!==SCHEMA||store.tenant_id!==TENANT||store.scope!==SCOPE||
  !Array.isArray(store.entries)||store.entries.length>MAX)
  throw Error('decision_store_denied');
 const ids=new Set();
 for(const e of store.entries){validateEntry(e,now);if(ids.has(e.id))throw Error('decision_duplicate');ids.add(e.id);}
 if(store.pending!==null){
  const p=store.pending;
  if(!exact(p,['id','area','decision','rationale','proposed_at','expires_at'])||
   !/^[a-f0-9]{12}$/.test(p.id)||ids.has(p.id)||!CATEGORIES.includes(p.area)||
   !validTime(p.proposed_at,now)||!validTime(p.expires_at,now,TTL+60000)||
   Date.parse(p.expires_at)-Date.parse(p.proposed_at)!==TTL)
   throw Error('decision_pending_denied');
  safeText(p.decision,170);safeText(p.rationale,220);
 }
 return store;
}
const HELP='Memória de decisões (somente proprietário, staging):\n'+
 '/decisao propor AREA | DECISAO | JUSTIFICATIVA\n'+
 '/decisao confirmar CODIGO\n/decisao cancelar\n/decisoes\n/decisao ver CODIGO\n'+
 'Áreas: '+CATEGORIES.join(', ')+'.\n'+
 'Somente registro após confirmação explícita. NÃO executa operações.';
function isCommand(message){return /^\/decis(?:ao|oes)(?:\s|$)/i.test(message||'');}
function handle(message,raw,now=Date.now(),generateId=()=>randomBytes(6).toString('hex')){
 if(typeof message!=='string'||message.length>600||!Number.isSafeInteger(now))throw Error('decision_command_denied');
 const data=validateStore(raw,now);
 const cleaned=data.pending&&Date.parse(data.pending.expires_at)<now?
  {...data,pending:null}:data;
 let changed=cleaned!==data;
 const done=(reply,next=cleaned,write=changed)=>({reply,store:next,changed:write});
 const text=message.trim(),low=text.toLowerCase();
 if(low==='/decisao'||low==='/decisoes ajuda'||low==='/decisao ajuda')return done(HELP);
 if(low==='/decisoes'){
  if(cleaned.entries.length===0)return done('Nenhuma decisão empresarial confirmada registrada.');
  const entries=cleaned.entries.slice(-5).reverse().map(e=>
   '• '+e.id+' | '+e.area+' | '+e.decision+' ('+e.confirmed_at.slice(0,10)+')');
  return done('📒 Decisões humanas confirmadas ('+cleaned.entries.length+'):\n'+entries.join('\n')+
   '\nDetalhes: /decisao ver CODIGO. Não são decisões executadas.');
 }
 const view=text.match(/^\/decisao ver ([a-f0-9]{12})$/i);
 if(view){
  const e=cleaned.entries.find(x=>x.id===view[1].toLowerCase());
  return done(e?'📒 Decisão confirmada '+e.id+
   '\nÁrea: '+e.area+'\nDecisão: '+e.decision+'\nJustificativa: '+e.rationale+
   '\nConfirmada em: '+e.confirmed_at+
   '\nFonte: proprietário autenticado. Nenhuma ação executada.':
   'Decisão não encontrada.');
 }
 if(low==='/decisao cancelar'){
  if(!cleaned.pending)return done('Não existe proposta pendente.');
  return done('Proposta descartada, nenhuma decisão registrada.',{...cleaned,pending:null},true);
 }
 const propose=text.match(/^\/decisao propor ([a-z]+) \| ([^|\r\n]+) \| ([^|\r\n]+)$/i);
 if(propose){
  const area=propose[1].toLowerCase();
  if(!CATEGORIES.includes(area))return done('Área não permitida. '+HELP);
  const decision=safeText(propose[2],170),rationale=safeText(propose[3],220);
  if(cleaned.pending)return done('Já existe uma proposta pendente. Use /decisao cancelar antes de propor outra.');
  if(cleaned.entries.length>=MAX)return done('Memória cheia. Nenhuma decisão será descartada automaticamente.');
  const id=generateId();
  if(typeof id!=='string'||!/^[a-f0-9]{12}$/.test(id)||
   cleaned.entries.some(x=>x.id===id))throw Error('decision_id_denied');
  const proposed_at=new Date(now).toISOString();
  const pending={id,area,decision,rationale,proposed_at,expires_at:new Date(now+TTL).toISOString()};
  return done('Proposta recebida, mas AINDA NÃO registrada.\nÁrea: '+area+
   '\nDecisão: '+decision+'\nJustificativa: '+rationale+
   '\nPara confirmar em até 10 minutos: /decisao confirmar '+id+
   '\nPara descartar: /decisao cancelar.',
   {...cleaned,pending},true);
 }
 const confirm=text.match(/^\/decisao confirmar ([a-f0-9]{12})$/i);
 if(confirm){
  const id=confirm[1].toLowerCase();
  if(cleaned.entries.some(x=>x.id===id))
   return done('Decisão '+id+' já registrada. Nenhum registro duplicado.');
  if(!cleaned.pending||cleaned.pending.id!==id)
   return done('Código inválido ou proposta expirada. Nenhuma decisão registrada.');
  if(cleaned.entries.length>=MAX)throw Error('decision_capacity_denied');
  const p=cleaned.pending;
  const e={id:p.id,area:p.area,decision:p.decision,rationale:p.rationale,
   source:'owner_confirmed_telegram',proposed_at:p.proposed_at,
   confirmed_at:new Date(now).toISOString()};
  const next={...cleaned,pending:null,entries:[...cleaned.entries,e]};
  validateStore(next,now);
  return done('✅ Decisão '+id+' registrada por confirmação humana.\n'+
   'Área: '+e.area+'\nDecisão: '+e.decision+
   '\nRegistro de memória; não autoriza nem executa operações.',next,true);
 }
 return done('Comando de decisão inválido. '+HELP);
}
module.exports={TENANT,SCHEMA,SCOPE,CATEGORIES,MAX,TTL,HELP,
 isCommand,safeText,validateStore,handle};
