'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {retrieve,SEARCH}=require('../src/runtime/hermes-brain-postgres-search');
const USER='11111111-1111-4111-8111-111111111111';
const FIXED_NOW=Date.parse('2026-10-24T12:00:00.000Z');
const item={tenant_id:'client::alpha',memory_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 source_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 source_item_digest:'sha256:'+'a'.repeat(64),reference_digest:'sha256:'+'b'.repeat(64),
 title:'Projeto aprovado',content:'Memória com fonte',domain:'projetos',
 classification:'internal',visibility:'owner_only',provider:'documentos',
 source_version:'v1',memory_status:'approved',source_status:'verified',
 expires_at:'2026-12-24T12:00:00.000Z',updated_at:'2026-10-22T12:00:00.000Z',
 source_updated_at:'2026-10-22T12:00:00.000Z'};
function db({role='authenticated',actor=USER,rows=[item]}={}){
 const calls=[];
 let released=false;
 const result={calls,get released(){return released},connect:async()=>({
  query:async(sql,params)=>{
   calls.push({sql,params});
   if(sql==='BEGIN READ ONLY'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
   if(sql.startsWith('SELECT (SELECT auth.uid())'))return {rows:[{user_id:actor,db_role:role}]};
   return {rows};
  },
  release:()=>{released=true}
 })};
 return result;
}
test('bounded full-text retrieval requires verified RLS role and parameterized SQL',async()=>{
 const adapter=db();
 const r=await retrieve({pool:adapter,tenant_id:'client::alpha',user_id:USER,clock:()=>FIXED_NOW,search:'memória',limit:3});
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].title,'Projeto aprovado');
 assert.equal(r.items[0].source_id,item.source_id);
 assert.equal(r.items[0].reference_digest,item.reference_digest);
 assert.equal(r.items[0].source_item_digest,item.source_item_digest);
 assert.equal(r.items[0].trust_level,'verified_source_approved_memory');
 assert.equal(r.read_only,true);
 assert.deepEqual(adapter.calls[2].params,['client::alpha','memória',3]);
 assert.equal(adapter.calls[2].sql,SEARCH);
 assert.match(SEARCH,/hermes_brain[.]memory_items/);
 assert.match(SEARCH,/plainto_tsquery\('simple',\$2\)/);
 assert.match(SEARCH,/LIMIT \$3/);
 assert.doesNotMatch(SEARCH,/\b(?:INSERT|UPDATE|DELETE)\b|service_role|SET ROLE/i);
});
test('source verification, approval and TTL enforced by SQL and result contract',async()=>{
 assert.match(SEARCH,/m[.]status='approved'/);
 assert.match(SEARCH,/m[.]expires_at>now\(\)/);
 assert.match(SEARCH,/s[.]status='verified'/);
 assert.match(SEARCH,/m[.]tenant_id=\$1/);
 assert.match(SEARCH,/s[.]tenant_id=m[.]tenant_id/);
 assert.match(SEARCH,/s[.]source_updated_at<=now\(\)/);
 assert.match(SEARCH,/m[.]updated_at<=now\(\)/);
 assert.match(SEARCH,/s[.]reference_digest/);
 const arg={tenant_id:'client::alpha',user_id:USER,search:'projeto',clock:()=>FIXED_NOW};
 for(const variant of [
  {tenant_id:'client::other'},
  {tenant_id:'grupo_erick'},
  {memory_status:'proposed'},
  {memory_status:'revoked'},
  {source_status:'revoked'},
  {source_status:'unverified'},
  {expires_at:'2026-10-24T11:59:59.000Z'},
  {expires_at:'2026-10-24T12:00:00.000Z'},
  {expires_at:'not-a-date'},
  {source_updated_at:'bad-timestamp'},
  {source_updated_at:'2026-10-25T12:00:00.000Z'},
  {updated_at:'2026-10-25T12:00:00.000Z'},
  {source_id:'not-uuid'},
  {reference_digest:'sha256:invalid'},
  {source_item_digest:'sha256:invalid'},
  {classification:'secret'},
  {visibility:'unrestricted'},
  {title:'x'.repeat(241)},
  {content:'x'.repeat(20001)}
 ]){
  const pool=db({rows:[{...item,...variant}]});
  await assert.rejects(retrieve({pool,...arg}),/brain_memory_result_invalid/);
  assert.equal(pool.calls.at(-1).sql,'ROLLBACK');
  assert.equal(pool.released,true);
 }
 const good=db({rows:[item]});
 const retrieved=await retrieve({pool:good,...arg});
 assert.equal(retrieved.items[0].source_status,'verified');
 assert.equal(retrieved.items[0].tenant_id,'client::alpha');
 assert.equal(retrieved.read_only,true);
});
test('invalid or untrusted retrieval clock cannot bypass expiration',async()=>{
 const a={tenant_id:'client::alpha',user_id:USER,search:'projeto'};
 await assert.rejects(retrieve({...a,pool:db(),clock:()=>NaN}),/brain_search_clock_denied/);
 await assert.rejects(retrieve({...a,pool:db(),clock:'2026-10-24'}),/brain_search_clock_denied/);
});
test('privileged roles cannot query through Hermes retrieval port',async()=>{
 for(const role of ['postgres','service_role','anon','brain_admin']){
  const x=db({role});
  await assert.rejects(retrieve({pool:x,tenant_id:'client::alpha',user_id:USER,clock:()=>FIXED_NOW,search:'projeto'}),/rls_principal_denied/);
  assert.deepEqual(x.calls.map(c=>c.sql).slice(0,2),['BEGIN READ ONLY','SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role']);
  assert.equal(x.calls.at(-1).sql,'ROLLBACK');
  assert.equal(x.released,true);
 }
});
test('mismatched verified identity or missing actor fail before content retrieval',async()=>{
 for(const actor of [null,'22222222-2222-4222-8222-222222222222']){
  const x=db({actor});
  await assert.rejects(retrieve({pool:x,tenant_id:'grupo_erick',user_id:USER,clock:()=>FIXED_NOW,search:'projeto'}),/rls_principal_denied/);
  assert.deepEqual(x.calls.map(c=>c.sql).slice(0,2),['BEGIN READ ONLY','SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role']);
  assert.equal(x.calls.at(-1).sql,'ROLLBACK');
  assert.equal(x.released,true);
 }
});
test('SQL injection strings remain values, not query source; unsafe scopes fail closed',async()=>{
 const phrase="project'; DROP TABLE hermes_brain.memory_items;--";
 const x=db();
 await retrieve({pool:x,tenant_id:'client::alpha',user_id:USER,clock:()=>FIXED_NOW,search:phrase});
 assert.equal(x.calls[2].sql,SEARCH);
 assert.equal(x.calls[2].params[1],phrase);
 for(const invalid of [
  {tenant_id:'client::alpha; DROP SCHEMA',user_id:USER,clock:()=>FIXED_NOW,search:'projeto'},
  {tenant_id:'personal::',user_id:USER,clock:()=>FIXED_NOW,search:'projeto'},
  {tenant_id:'grupo_erick',user_id:'admin',clock:()=>FIXED_NOW,search:'projeto'},
  {tenant_id:'grupo_erick',user_id:USER,clock:()=>FIXED_NOW,search:''},
  {tenant_id:'grupo_erick',user_id:USER,clock:()=>FIXED_NOW,search:'\nmalicioso'},
  {tenant_id:'grupo_erick',user_id:USER,clock:()=>FIXED_NOW,search:'projeto',limit:100}]) {
  const bad=db();await assert.rejects(retrieve({pool:bad,...invalid}),/contract_denied/);
  assert.equal(bad.calls.length,0);
 }
});
test('empty results and oversized provider responses handled deterministically',async()=>{
 const empty=await retrieve({pool:db({rows:[]}),tenant_id:'grupo_erick',user_id:USER,clock:()=>FIXED_NOW,search:'projeto'});
 assert.deepEqual(empty.items,[]);
 await assert.rejects(retrieve({pool:db({rows:[item,item]}),tenant_id:'grupo_erick',user_id:USER,clock:()=>FIXED_NOW,search:'projeto',limit:1}),/query_result_denied/);
});

test('Postgres memory schema forces RLS for every tenant-owned table',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const sql=fs.readFileSync(path.resolve(__dirname,
  '../../../migrations/hermes/038_create_second_brain_multi_tenant_read_model.sql'),'utf8');
 for(const table of ['tenants','memberships','sources','memory_items']){
  assert.match(sql,new RegExp('ALTER TABLE hermes_brain[.]'+table+' ENABLE ROW LEVEL SECURITY'));
  assert.match(sql,new RegExp('ALTER TABLE hermes_brain[.]'+table+' FORCE ROW LEVEL SECURITY'));
 }
 assert.match(sql,/FOR SELECT TO authenticated/);
 assert.match(sql,/user_id=\(SELECT auth[.]uid\(\)\)/);
 assert.match(sql,/expires_at>now\(\)/);
 assert.match(sql,/source_id=memory_items[.]source_id/);
 assert.match(sql,/m[.]status='active'/);
 assert.match(sql,/s[.]status='verified'/);
 assert.match(sql,/memory_items[.]company_id=ANY\(m[.]company_ids\)/);
 assert.match(sql,/memory_items[.]store_id=ANY\(m[.]store_ids\)/);
 assert.doesNotMatch(sql,/SECURITY DEFINER|GRANT (?:INSERT|UPDATE|DELETE|ALL) ON hermes_brain/i);
 assert.doesNotMatch(sql,/CREATE POLICY[^;]+TO anon/i);
});
