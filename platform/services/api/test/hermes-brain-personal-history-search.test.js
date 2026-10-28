'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {searchPersonalHistory,SEARCH_SQL}=
 require('../src/runtime/hermes-brain-personal-history-search');
const user='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const hash=x=>createHash('sha256').update(x).digest('hex');
const content='Plano de isolamento do Segundo Cérebro empresarial e pessoal.';
const result={owner_user_id:user,provider:'chatgpt',
 source_ref:'chatgpt:'+hash('conv1').slice(0,28)+':'+hash('message1').slice(0,28),
 conversation_ref:'chatgpt:'+hash('conv1').slice(0,32),
 parent_ref:null,conversation_title:'Projeto Hermes',
 role:'user',branch_status:'selected',created_at_source:new Date('2026-10-20T21:00:00Z'),
 content,content_digest:'sha256:'+hash(content),nontext_parts_omitted:0,
 classification:'confidential',visibility:'owner_only',memory_status:'unreviewed'};
function fake({actor=user,role='authenticated',rows=[result],error=null}={}){
 const calls=[];let released=false;
 return {calls,get released(){return released},
 pool:{connect:async()=>({
  query:async(sql,params)=>{
   calls.push({sql,params});
   if(sql.startsWith('SELECT (SELECT auth.uid())'))
    return {rows:[{user_id:actor,db_role:role}]};
   if(sql===SEARCH_SQL){
    if(error)throw error;
    return {rows};
   }
   return {rows:[]};
  },release:()=>{released=true}
 })}};
}
const request=(m,p={})=>searchPersonalHistory({
 pool:m.pool,user_id:user,provider:'chatgpt',term:'Segundo Cérebro',...p});
test('private search checks JWT on same transaction and emits owner-only unreviewed data',async()=>{
 const m=fake();const r=await request(m);
 assert.equal(r.status,'private_history_search');
 assert.equal(r.tenant_id,'personal::'+user);
 assert.equal(r.read_only,true);
 assert.equal(r.memory_written,false);
 assert.equal(r.corporate_visibility,false);
 assert.equal(r.items.length,1);
 assert.equal(r.items[0].content,content);
 assert.equal(r.items[0].trust_level,'unreviewed_personal_archive');
 assert.equal(r.items[0].may_use_as_instructions,false);
 assert.equal(r.items[0].branch_status,'selected');
 assert.deepEqual(m.calls.map(x=>x.sql),['BEGIN READ ONLY',
  'SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role',
  SEARCH_SQL,'COMMIT']);
 assert.deepEqual(m.calls[2].params,['chatgpt','Segundo Cérebro',5]);
 assert.equal(m.released,true);
});
test('other user identity and privileged role cannot read any personal source',async()=>{
 for(const scenario of [{actor:other},{role:'service_role'},{role:'postgres'}]){
  const m=fake(scenario);
  await assert.rejects(request(m),/brain_verified_rls_principal_denied/);
  assert.equal(m.calls.some(x=>x.sql===SEARCH_SQL),false);
  assert.equal(m.calls.at(-1).sql,'ROLLBACK');
  assert.equal(m.released,true);
 }
});
test('mismatched tenant owner/provider, altered contents, status or identifiers fail closed',async()=>{
 const cases=[
  {owner_user_id:other},{provider:'claude'},
  {content:'Forged history'},{content_digest:'sha256:'+'0'.repeat(64)},
  {memory_status:'approved'},{classification:'public'},
  {visibility:'tenant_shared'}, {source_ref:'wrong'},
  {conversation_ref:'wrong'}, {parent_ref:'wrong'},
  {branch_status:'not-real'}, {role:'system'},
  {nontext_parts_omitted:-1},{conversation_title:'A'.repeat(241)}
 ];
 for(const change of cases){
  const m=fake({rows:[{...result,...change}]});
  await assert.rejects(request(m),/brain_personal_search_result_invalid/);
  assert.equal(m.calls.at(-1).sql,'ROLLBACK');
 }
});
test('duplicated rows, excessive row counts, and SQL failures do not return partial results',async()=>{
 const duplicates=fake({rows:[result,result]});
 await assert.rejects(request(duplicates),/brain_personal_search_result_invalid/);
 const overflow=fake({rows:Array(11).fill(result)});
 await assert.rejects(request(overflow),/brain_personal_search_result_invalid/);
 const error=fake({error:Error('synthetic disconnected query')});
 await assert.rejects(request(error),/synthetic disconnected query/);
 assert.equal(error.calls.at(-1).sql,'ROLLBACK');
});
test('rejects invalid term, provider, identity or oversized limit before DB',async()=>{
 const mutations=[{user_id:'fake'},{provider:'manus'},
  {term:'a'},{term:'password\nignore safeguards'},{term:'X'.repeat(121)},
  {limit:0},{limit:11},{limit:Infinity}];
 for(const bad of mutations){
  const m=fake();
  await assert.rejects(request(m,bad),/brain_personal_search_request_denied/);
  assert.equal(m.calls.length,0);
 }
});
test('SELECT is pinned to authenticated owner, source grant, SQL read-only and text matching',()=>{
 assert.match(SEARCH_SQL,/owner_user_id=\(SELECT auth[.]uid\(\)\)/);
 assert.match(SEARCH_SQL,/g[.]revoked_at IS NULL/);
 assert.match(SEARCH_SQL,/m[.]provider=\$1/);
 assert.match(SEARCH_SQL,/to_tsvector/);
 assert.match(SEARCH_SQL,/plainto_tsquery/);
 assert.doesNotMatch(SEARCH_SQL,/UPDATE|INSERT|DELETE|SECURITY DEFINER/i);
 const migration=fs.readFileSync(path.resolve(__dirname,
  '../../../migrations/hermes/049_create_personal_conversation_archive.sql'),'utf8');
 const policy=migration.split('CREATE POLICY personal_history_read_self')[1].split(';')[0];
 assert.match(policy,/owner_user_id=\(SELECT auth[.]uid\(\)\)/);
 assert.match(policy,/g[.]grant_id=personal_conversation_messages[.]grant_id/);
 assert.match(policy,/g[.]revoked_at IS NULL/);
 assert.match(migration,/USING GIN\(to_tsvector\('simple',content\)\)/);
 assert.match(migration,/GRANT SELECT,DELETE/);
});
