'use strict';
// Hermes Brain -> Telegram, staging-only, dedicated PostgreSQL NOINHERIT machine role.
// RLS and owner-only per-item attestation are enforced by migration 047.
// Never accept raw SQL, service-role keys, elevated identity or arbitrary tenant ids.
const {createHash}=require('node:crypto');
const PROJECT='asceucchdnuoaqgdjbtg';
const USER='hermes_telegram_brain_reader.'+PROJECT;
const QUERY=`SELECT m.tenant_id,m.title,m.content,m.domain,m.expires_at,
 m.source_item_digest,m.source_version,s.provider,a.content_digest
 FROM hermes_brain.memory_items m
 JOIN hermes_brain.sources s
 ON s.tenant_id=m.tenant_id AND s.source_id=m.source_id
 JOIN hermes_brain.automemory_admissions a
 ON a.tenant_id=m.tenant_id AND a.source_id=m.source_id
 AND a.source_item_digest=m.source_item_digest
 AND a.source_version=m.source_version
 WHERE m.tenant_id=$1 AND m.status='approved'
 AND m.classification='internal' AND m.visibility='owner_only'
 AND m.expires_at>now() AND s.status='verified' AND a.status='admitted'
 AND pg_catalog.to_tsvector('simple',m.title||' '||m.content)
 @@ pg_catalog.plainto_tsquery('simple',$2)
 ORDER BY m.expires_at DESC,m.source_item_digest LIMIT $3`;
const DENIED=Object.freeze({enabled:false,query:async()=>{throw Error('brain_machine_reader_not_activated')}});
function safeTerm(text){
 if(typeof text!=='string')throw Error('brain_query_invalid');
 const q=text.trim();
 if(q.length<2||q.length>100||/[\x00-\x1F\x7F]/.test(q))
  throw Error('brain_query_invalid');
 return q;
}
function createReader(env,{readSecret,loadDriver=()=>require('pg')}={}){
 if(env.HERMES_BRAIN_LIVE_ENABLED!=='true')return DENIED;
 if(env.HERMES_DEPLOYMENT_STAGE!=='staging'||
  env.HERMES_EXECUTION_ENABLED!=='false'||
  env.HERMES_EXECUTION_KILL_SWITCH!=='true'||
  env.HERMES_MISSION_INGRESS_ENABLED!=='false')throw Error('brain_telegram_stage_denied');
 const host=env.HERMES_BRAIN_POOLER_HOST;
 if(typeof host!=='string'||
  !/^aws-[0-9]+-sa-east-1\.pooler\.supabase\.com$/.test(host))
  throw Error('brain_telegram_pooler_host_denied');
 if(typeof readSecret!=='function')throw Error('brain_secret_reader_required');
 const password=readSecret(env.HERMES_BRAIN_PASSWORD_FILE);
 if(password.length<40||password.length>180)throw Error('brain_machine_password_invalid');
 const ca=readSecret(env.HERMES_BRAIN_CA_FILE);
 if(!ca.startsWith('-----BEGIN CERTIFICATE-----')||
   !ca.endsWith('-----END CERTIFICATE-----'))throw Error('brain_telegram_tls_invalid');
 const driver=loadDriver();
 if(typeof driver?.Client!=='function')throw Error('brain_telegram_driver_denied');
 return Object.freeze({enabled:true,query:async text=>{
  const term=safeTerm(text);
  const client=new driver.Client({
   host,port:5432,database:'postgres',user:USER,password,
   ssl:{ca,rejectUnauthorized:true},application_name:'hermes-brain-telegram-staging-v1',
   connectionTimeoutMillis:4000,statement_timeout:5000,query_timeout:5000,
   options:'-c default_transaction_read_only=on'
  });
  try{
   await client.connect();
   const response=await client.query(QUERY,['grupo_erick',term,3]);
   const rows=response?.rows;
   if(!Array.isArray(rows)||rows.length>3)throw Error('brain_result_contract_denied');
   const now=Date.now();
   for(const row of rows){
    if(row?.tenant_id!=='grupo_erick'||
       !['financeiro','comercial'].includes(row.domain)||
       !['telegram_owner_confirmed','supabase_history'].includes(row.provider)||
       typeof row.title!=='string'||row.title.length>240||
       typeof row.content!=='string'||row.content.length>420||
       !/^sha256:[a-f0-9]{64}$/.test(row.source_item_digest||'')||
       row.content_digest!=='sha256:'+createHash('sha256').update(row.content).digest('hex')||
       !(Date.parse(row.expires_at)>now))
       throw Error('brain_result_provenance_denied');
   }
   return rows;
  }finally{await client.end().catch(()=>{});}
 }});
}
function render(rows){
 if(!Array.isArray(rows)||rows.length>3)throw Error('brain_render_invalid');
 const lines=['🧠 Hermes Brain — memórias empresariais verificadas',
  'Fonte: Supabase hermes-brain, leitura PostgreSQL com RLS.',
  'Escopo: Grupo Erick, proprietário; somente leitura.'];
 if(rows.length===0)lines.push('Nenhuma memória aprovada corresponde à pesquisa.');
 else for(const row of rows){
  const expiry=new Date(row.expires_at).toLocaleDateString('pt-BR',{timeZone:'America/Recife'});
  lines.push('• '+row.title+' ('+row.domain+')',
   row.content,'Fonte verificada: '+row.provider+' · validade até '+expiry);
 }
 lines.push('⚠️ Memórias históricas não representam saldos atuais nem autorizam decisões ou pagamentos.');
 const reply=lines.join('\n');
 if(reply.length>3200)throw Error('brain_reply_too_large');
 return reply;
}
module.exports={createReader,safeTerm,render,QUERY,PROJECT,USER};
