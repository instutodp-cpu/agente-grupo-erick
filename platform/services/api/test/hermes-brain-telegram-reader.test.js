'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const reader=require('../src/runtime/hermes-brain-telegram-reader');
const {processUpdate}=require('../src/runtime/hermes-telegram-private-channel');
const base={HERMES_BRAIN_LIVE_ENABLED:'true',HERMES_DEPLOYMENT_STAGE:'staging',
 HERMES_EXECUTION_ENABLED:'false',HERMES_EXECUTION_KILL_SWITCH:'true',
 HERMES_MISSION_INGRESS_ENABLED:'false',
 HERMES_BRAIN_POOLER_HOST:'aws-0-sa-east-1.pooler.supabase.com',
 HERMES_BRAIN_PASSWORD_FILE:'/secure/pw',
 HERMES_BRAIN_CA_FILE:'/secure/ca'};
function secret(p){
 return p==='/secure/pw'?'t'.repeat(72):
 p==='/secure/ca'?'-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----':
 'unexpected_secret';
}
const content='Decisão confirmada: conciliação antes de ampliar compromissos.';
const validRow=()=>({tenant_id:'grupo_erick',domain:'financeiro',
 provider:'telegram_owner_confirmed',title:'Decisão confirmada — financeiro',
 content,source_item_digest:'sha256:'+'a'.repeat(64),
 content_digest:'sha256:'+createHash('sha256').update(content).digest('hex'),
 source_version:'2026-10-22T20:59:52.272Z',
 expires_at:new Date(Date.now()+86400000).toISOString()});
test('reader disabled without credentials and fails closed',async()=>{
 const x=reader.createReader({...base,HERMES_BRAIN_LIVE_ENABLED:'false'});
 assert.equal(x.enabled,false);
 await assert.rejects(x.query('conciliação'),/not_activated/);
});
test('refuses production, wrong pooler, wrong stage, missing certificate',()=>{
 assert.throws(()=>reader.createReader({...base,HERMES_DEPLOYMENT_STAGE:'production'},{readSecret:secret}),/stage_denied/);
 assert.throws(()=>reader.createReader({...base,HERMES_BRAIN_POOLER_HOST:'evil.example.org'},{readSecret:secret}),/host_denied/);
 assert.throws(()=>reader.createReader({...base,HERMES_EXECUTION_ENABLED:'true'},{readSecret:secret}),/stage_denied/);
 assert.throws(()=>reader.createReader({...base,HERMES_BRAIN_CA_FILE:'/bad'},{readSecret:secret}),/tls_invalid/);
});
test('queries are parameterized, bounded, isolated and TLS-verified',async()=>{
 const all=[];
 class Client{
  constructor(config){all.push({config});}
  async connect(){all.push({connected:true});}
  async query(sql,args){all.push({sql,args});return {rows:[validRow()]};}
  async end(){all.push({ended:true});}
 }
 const live=reader.createReader(base,{readSecret:secret,loadDriver:()=>({Client})});
 const rows=await live.query('conciliação');
 assert.equal(rows.length,1);
 const query=all.find(e=>e.sql);
 assert.deepEqual(query.args,['grupo_erick','conciliação',3]);
 assert.ok(query.sql.includes('m.tenant_id=$1'));
 assert.ok(query.sql.includes('a.status=\'admitted\''));
 assert.equal(all[0].config.user,reader.USER);
 assert.equal(all[0].config.ssl.rejectUnauthorized,true);
 assert.equal(all[0].config.options,'-c default_transaction_read_only=on');
 assert.equal(all.at(-1).ended,true);
 assert.match(reader.render(rows),/Supabase hermes-brain/);
});
test('rejects tampered data and closes client',async()=>{
 let closed=false;
 class Client{async connect(){}async query(){const m=validRow();m.content='adulterado';return {rows:[m]};}async end(){closed=true;}}
 const live=reader.createReader(base,{readSecret:secret,loadDriver:()=>({Client})});
 await assert.rejects(live.query('conciliação'),/provenance_denied/);
 assert.equal(closed,true);
});
test('no cross tenant, expired, long or control-character search allowed',async()=>{
 class Client{async connect(){}async query(){return {rows:[{...validRow(),tenant_id:'client::different'}]};}async end(){}}
 const live=reader.createReader(base,{readSecret:secret,loadDriver:()=>({Client})});
 await assert.rejects(live.query('conciliação'),/provenance_denied/);
 for(const q of ['a','x'.repeat(101),'olá\nSELECT'])await assert.rejects(live.query(q),/query_invalid/);
});
function msg(userId,text){return {update_id:321,message:{chat:{id:userId,type:'private'},from:{id:userId,is_bot:false},text}};}
test('only already-paired owner may invoke /cerebro, no fallback on denied central data',async()=>{
 const replies=[];let calls=0;
 const cfg={ownerId:42,pairing:null,query:async()=>{},clock:()=>Date.now(),
  saveOwner:async()=>{},savePairing:async()=>{},
  send:async(_id,value)=>replies.push(value),
  readBrain:async()=>{calls++;return [validRow()];}};
 const denied=await processUpdate({...cfg,update:msg(43,'/cerebro conciliação')});
 assert.equal(denied.kind,'unauthorized');assert.equal(calls,0);
 const allowed=await processUpdate({...cfg,update:msg(42,'/cerebro conciliação')});
 assert.equal(allowed.intent,'brain_live');assert.equal(calls,1);
 assert.match(replies[0],/memórias empresariais verificadas/);
 const deniedRead=await processUpdate({...cfg,update:msg(42,'/cerebro cancelados'),
  readBrain:async()=>{throw Error('postgres_unavailable')}});
 assert.equal(deniedRead.intent,'brain_live');
 assert.match(replies.at(-1),/indisponível ou não autorizado/);
 assert.doesNotMatch(replies.at(-1),/cache/);
});
