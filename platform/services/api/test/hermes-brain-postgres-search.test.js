'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {retrieve,SEARCH}=require('../src/runtime/hermes-brain-postgres-search');
const USER='11111111-1111-4111-8111-111111111111';
const item={memory_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'Projeto aprovado',content:'Memória com fonte',
 domain:'projetos',provider:'documentos',source_version:'v1'};
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
 const r=await retrieve({pool:adapter,tenant_id:'client::alpha',user_id:USER,search:'memória',limit:3});
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].title,'Projeto aprovado');
 assert.equal(r.read_only,true);
 assert.deepEqual(adapter.calls[2].params,['client::alpha','memória',3]);
 assert.equal(adapter.calls[2].sql,SEARCH);
 assert.match(SEARCH,/hermes_brain[.]memory_items/);
 assert.match(SEARCH,/plainto_tsquery\('simple',\$2\)/);
 assert.match(SEARCH,/LIMIT \$3/);
 assert.doesNotMatch(SEARCH,/\b(?:INSERT|UPDATE|DELETE)\b|service_role|SET ROLE/i);
});
test('privileged roles cannot query through Hermes retrieval port',async()=>{
 for(const role of ['postgres','service_role','anon','brain_admin']){
  const x=db({role});
  await assert.rejects(retrieve({pool:x,tenant_id:'client::alpha',user_id:USER,search:'projeto'}),/rls_principal_denied/);
  assert.deepEqual(x.calls.map(c=>c.sql).slice(0,2),['BEGIN READ ONLY','SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role']);
  assert.equal(x.calls.at(-1).sql,'ROLLBACK');
  assert.equal(x.released,true);
 }
});
test('mismatched verified identity or missing actor fail before content retrieval',async()=>{
 for(const actor of [null,'22222222-2222-4222-8222-222222222222']){
  const x=db({actor});
  await assert.rejects(retrieve({pool:x,tenant_id:'grupo_erick',user_id:USER,search:'projeto'}),/rls_principal_denied/);
  assert.deepEqual(x.calls.map(c=>c.sql).slice(0,2),['BEGIN READ ONLY','SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role']);
  assert.equal(x.calls.at(-1).sql,'ROLLBACK');
  assert.equal(x.released,true);
 }
});
test('SQL injection strings remain values, not query source; unsafe scopes fail closed',async()=>{
 const phrase="project'; DROP TABLE hermes_brain.memory_items;--";
 const x=db();
 await retrieve({pool:x,tenant_id:'client::alpha',user_id:USER,search:phrase});
 assert.equal(x.calls[2].sql,SEARCH);
 assert.equal(x.calls[2].params[1],phrase);
 for(const invalid of [
  {tenant_id:'client::alpha; DROP SCHEMA',user_id:USER,search:'projeto'},
  {tenant_id:'personal::',user_id:USER,search:'projeto'},
  {tenant_id:'grupo_erick',user_id:'admin',search:'projeto'},
  {tenant_id:'grupo_erick',user_id:USER,search:''},
  {tenant_id:'grupo_erick',user_id:USER,search:'\nmalicioso'},
  {tenant_id:'grupo_erick',user_id:USER,search:'projeto',limit:100}]) {
  const bad=db();await assert.rejects(retrieve({pool:bad,...invalid}),/contract_denied/);
  assert.equal(bad.calls.length,0);
 }
});
test('empty results and oversized provider responses handled deterministically',async()=>{
 const empty=await retrieve({pool:db({rows:[]}),tenant_id:'grupo_erick',user_id:USER,search:'projeto'});
 assert.deepEqual(empty.items,[]);
 await assert.rejects(retrieve({pool:db({rows:[item,item]}),tenant_id:'grupo_erick',user_id:USER,search:'projeto',limit:1}),/query_result_denied/);
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
