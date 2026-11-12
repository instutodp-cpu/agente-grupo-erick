'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapter=require('../src/runtime/hermes-brain-automemory-publication');
const curate=require('../src/runtime/hermes-automemory-curator');
const now=Date.parse('2026-10-23T18:00:00Z');
const uid='ae8965c2-9c45-4f5f-8e1e-2a6fce819c7a';
const sourceId='5f3cfe9b-715b-4b5c-a71b-353c1fe00f0b';
const at=new Date(now-10000).toISOString();
const decisions={schema:1,tenant_id:'grupo_erick',scope:'enterprise',pending:null,entries:[{
 id:'abcd1234abcd',area:'financeiro',
 decision:'Exigir conciliação antes de assumir novos compromissos',
 rationale:'Valores de compras ainda dependem da verificação do Linx',
 source:'owner_confirmed_telegram',proposed_at:at,confirmed_at:at
}]};
const store=curate.curate({ownerDecisions:decisions,now,
 policy:{enabled:true,tenant_id:'grupo_erick',decisions:true,aggregates:false}});
const principal={tenant_id:'grupo_erick',user_id:uid,authenticated:true};
const membership={tenant_id:'grupo_erick',user_id:uid,status:'active',
 allowed_domains:['financeiro'],allowed_classifications:['internal'],
 allowed_visibilities:['owner_only']};
const verifiedSources=[{tenant_id:'grupo_erick',source_id:sourceId,
 provider:'telegram_owner_confirmed',status:'verified',
 reference_digest:adapter.sourceDigest(store.items[0].source)}];
const invoke=overrides=>adapter.prepare({store,principal,membership,verifiedSources,now,...overrides});
test('current Supabase membership projects-only blocks auto publication',()=>{
 const out=invoke({membership:{...membership,allowed_domains:['projetos']}});
 assert.deepEqual(out,{status:'blocked',reason:'membership_domain_scope_denied',count:0,rows:[]});
});
test('proof of Supabase identity cannot be substituted by Telegram owner id',()=>{
 assert.equal(invoke({principal:null}).reason,'supabase_user_identity_required');
 assert.equal(invoke({principal:{...principal,authenticated:false}}).reason,'supabase_user_identity_required');
 assert.equal(invoke({principal:{...principal,tenant_id:'client::other'}}).reason,'supabase_user_identity_required');
 assert.equal(invoke({membership:{...membership,user_id:'2216c8bd-7cdf-4301-a4b1-b1b80e06b24d'}}).reason,'authenticated_membership_required');
 assert.equal(invoke({membership:{...membership,status:'revoked'}}).reason,'authenticated_membership_required');
});
test('verified source and owner only ABAC gates are mandatory',()=>{
 assert.equal(invoke({verifiedSources:[]}).reason,'source_verification_required');
 assert.equal(invoke({verifiedSources:[{...verifiedSources[0],status:'unverified'}]}).reason,'source_verification_required');
 assert.equal(invoke({verifiedSources:[{...verifiedSources[0],tenant_id:'client::other'}]}).reason,'source_verification_required');
 assert.equal(invoke({verifiedSources:[{...verifiedSources[0],reference_digest:'sha256:'+'a'.repeat(64)}]}).reason,'source_verification_required');
 assert.equal(invoke({membership:{...membership,allowed_visibilities:['tenant_shared']}}).reason,'membership_domain_scope_denied');
});
test('authenticated verified source can yield idempotent limited uncommitted rows',()=>{
 const a=invoke(),b=invoke();
 assert.equal(a.status,'prepared_uncommitted');
 assert.equal(a.count,1);
 assert.deepEqual(a,b);
 assert.equal(a.rows[0].owner_user_id,uid);
 assert.equal(a.rows[0].visibility,'owner_only');
 assert.equal(a.rows[0].classification,'internal');
 assert.equal(a.rows[0].source_id,sourceId);
 assert.equal(a.rows[0].domain,'financeiro');
 assert.match(a.rows[0].source_item_digest,/^sha256:[a-f0-9]{64}$/);
 assert(!('status' in a.rows[0]));
 assert(!('secret' in a.rows[0]));
});
test('cannot publish expired, tampered, cross-tenant or unverified local memories',()=>{
 assert.equal(invoke({now:now+181*86400000}).reason,'no_active_memories');
 assert.throws(()=>invoke({store:{...store,tenant_id:'client::other'}}),/autocurated_store_invalid/);
 assert.throws(()=>invoke({store:{...store,items:[{...store.items[0],visibility:'tenant_shared'}]}}),/autocurated_item_invalid/);
 const changed={...store,items:[{...store.items[0],source:'unknown_public_internet'}]};
 assert.throws(()=>invoke({store:changed}),/brain_source_not_authorized/);
});


function db({role='authenticated',actor=uid,domains=['financeiro'],sources=verifiedSources,
 grant=false,writeRows=[{memory_id:'9bcc0653-b82e-4c5f-85a2-908e1fb4ecc6'}],fail=false}={}){
 const calls=[];let released=false;
 const pool={connect:async()=>({
  query:async(sql,params)=>{
   calls.push({sql,params});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
   if(sql.startsWith('SELECT (SELECT auth.uid())'))return {rows:[{user_id:actor,db_role:role}]};
   if(sql===adapter.MEMBERSHIP_SQL)return {rows:[{...membership,allowed_domains:domains}]};
   if(sql===adapter.SOURCES_SQL)return {rows:sources};
   if(sql===adapter.PRIVILEGE_SQL)return {rows:[{allowed:grant}]};
   if(sql===adapter.INSERT_SQL){
    if(fail)throw Error('rls_denied');
    return {rows:writeRows};
   }
   throw Error('unexpected_query');
  },release:()=>{released=true}
 })};
 return {pool,calls,get released(){return released}};
}
test('publisher remains blocked with the current projetos-only membership',async()=>{
 const x=db({domains:['projetos'],grant:true});
 const r=await adapter.publish({pool:x.pool,user_id:uid,store,now});
 assert.equal(r.reason,'membership_domain_scope_denied');
 assert.equal(x.calls.length,4);
 assert.equal(x.calls.at(-1).sql,'COMMIT');
 assert(x.released);
});
test('no memory write without independently authorized INSERT role',async()=>{
 const x=db();
 const r=await adapter.publish({pool:x.pool,user_id:uid,store,now});
 assert.equal(r.reason,'memory_write_role_denied');
 assert(!x.calls.some(q=>q.sql===adapter.INSERT_SQL));
 assert(x.released);
});
test('verified principal is required; privileged role and forged identity rejected',async()=>{
 for(const opts of [{role:'service_role'},{role:'postgres'},
  {actor:'b0cec593-8309-42f6-885f-d69daed6a478'}]){
  const x=db(opts);
  await assert.rejects(adapter.publish({pool:x.pool,user_id:uid,store,now}),/rls_principal_denied/);
  assert.deepEqual(x.calls.map(c=>c.sql),[
   'BEGIN','SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role','ROLLBACK']);
  assert(x.released);
 }
});
test('source revocation blocks all writes',async()=>{
 const x=db({sources:[{...verifiedSources[0],status:'revoked'}],grant:true});
 const r=await adapter.publish({pool:x.pool,user_id:uid,store,now});
 assert.equal(r.reason,'source_verification_required');
 assert(!x.calls.some(c=>c.sql===adapter.INSERT_SQL));
 assert(x.released);
});
test('future RLS-authorized publication is idempotent, scoped, and parameterized',async()=>{
 for(const [writeRows,inserted] of [
  [[{memory_id:'9bcc0653-b82e-4c5f-85a2-908e1fb4ecc6'}],1],[[],0]]){
  const x=db({grant:true,writeRows});
  const r=await adapter.publish({pool:x.pool,user_id:uid,store,now});
  assert.equal(r.status,'committed');
  assert.equal(r.inserted,inserted);
  assert.equal(r.duplicates,1-inserted);
  const op=x.calls.find(c=>c.sql===adapter.INSERT_SQL);
  assert.equal(op.params[0],'grupo_erick');
  assert.equal(op.params[4],uid);
  assert.equal(op.params[5],'financeiro');
  assert.equal(op.params[7],'owner_only');
  assert.equal(op.params[13],verifiedSources[0].reference_digest);
  assert(!/SET ROLE|service_role|request.jwt.claim.sub/i.test(op.sql));
  assert.equal(x.calls.at(-1).sql,'COMMIT');
  assert(x.released);
 }
});
test('failed write transaction rolls back and cannot claim memory persistence',async()=>{
 const x=db({grant:true,fail:true});
 await assert.rejects(adapter.publish({pool:x.pool,user_id:uid,store,now}),/rls_denied/);
 assert.equal(x.calls.at(-1).sql,'ROLLBACK');
 assert(x.released);
});
