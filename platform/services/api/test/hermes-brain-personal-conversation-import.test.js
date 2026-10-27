'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const archive=require('../src/runtime/hermes-brain-personal-conversation-import');
const user='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const grant='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sample=[{conversation_id:'conv1',current_node:'a',
 title:'Personal notes',mapping:{a:{parent:null,message:{
 id:'item1',author:{role:'user'},create_time:1760000000,
 content:{content_type:'text',parts:['Sensitive personal example.']}}}}}];
function mock({actor=user,role='authenticated',consent=true,preexisting=null,
 overwriteAtRead=false,invalidReceipt=false}={}){
 const calls=[],storage=new Map(preexisting||[]);
 let released=false;
 const client={
  async query(sql,params){
   calls.push({sql,params:sql===archive.INSERT_SQL?
    [params[0],params[1],params[2],'[private JSON redacted]']:params});
   if(sql.startsWith('BEGIN')||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
   if(sql.startsWith('SELECT (SELECT auth.uid())'))
    return {rows:[{user_id:actor,db_role:role}]};
   if(sql===archive.CONSENT_SQL)
    return {rows:consent?[{grant_id:grant}]:[]};
   if(sql===archive.BEFORE_SQL){
    return {rows:[...storage.entries()].filter(([ref])=>params[1].includes(ref))
      .map(([source_ref,content_digest])=>({
        source_ref,content_digest:overwriteAtRead?'sha256:'+'0'.repeat(64):content_digest
      }))};
   }
   if(sql===archive.INSERT_SQL){
    const rows=[];
    for(const item of JSON.parse(params[3])){
     if(!storage.has(item.source_ref)){
      storage.set(item.source_ref,item.content_digest);
      rows.push({source_ref:item.source_ref});
     }
    }
    return {rows:invalidReceipt?[{source_ref:'other'}]:rows};
   }
   throw Error('mock_unknown_query');
  },release(){released=true}
 };
 return {calls,storage,get released(){return released},pool:{connect:async()=>client}};
}
const run=(m,params={})=>archive.storePersonalConversationBatch({
 pool:m.pool,user_id:user,provider:'chatgpt',conversations:sample,...params
});
test('owner authenticated and active source grant archive text without memory promotion',async()=>{
 const m=mock();const result=await run(m);
 assert.equal(result.status,'stored_personal_unreviewed');
 assert.equal(result.tenant_id,'personal::'+user);
 assert.equal(result.inserted,1);assert.equal(result.duplicates,0);
 assert.equal(result.memory_written,false);
 assert.equal(result.corporate_visibility,false);
 assert.equal(result.provider_api_called,false);
 assert.equal(result.requires_review,true);
 assert.deepEqual(m.calls.map(c=>c.sql),['BEGIN',
  'SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role',
  archive.CONSENT_SQL,archive.BEFORE_SQL,archive.INSERT_SQL,
  archive.BEFORE_SQL,'COMMIT']);
 assert(!JSON.stringify(m.calls).includes('Sensitive personal example'));
 assert.equal(m.released,true);
});
test('idempotent reimport keeps historic item identity without rewriting it',async()=>{
 const m=mock();
 const first=await run(m);
 assert.equal(first.inserted,1);
 const second=await run(m);
 assert.equal(second.inserted,0);assert.equal(second.duplicates,1);
 assert.equal(m.storage.size,1);
});
test('revoked/missing consent stops before normalization or inserts',async()=>{
 const m=mock({consent:false});
 await assert.rejects(run(m),/authenticated_consent_required/);
 assert(m.calls.some(c=>c.sql===archive.CONSENT_SQL));
 assert(!m.calls.some(c=>c.sql===archive.INSERT_SQL));
 assert.equal(m.calls.at(-1).sql,'ROLLBACK');
});
test('foreign JWT identity and privileged DB role denied before querying consent',async()=>{
 for(const option of [{actor:other},{role:'service_role'},{role:'postgres'}]){
  const m=mock(option);
  await assert.rejects(run(m),/brain_verified_rls_principal_denied/);
  assert(!m.calls.some(c=>c.sql===archive.CONSENT_SQL));
  assert(!m.calls.some(c=>c.sql===archive.INSERT_SQL));
  assert.equal(m.calls.at(-1).sql,'ROLLBACK');
 }
});
test('changed historic message under same provenance key is never silently overwritten',async()=>{
 const m=mock({overwriteAtRead:true});
 const seeded=mock();await run(seeded);
 const conflicting=mock({preexisting:[...seeded.storage.entries()],overwriteAtRead:true});
 await assert.rejects(run(conflicting),/source_revision_conflict/);
 assert(!conflicting.calls.some(c=>c.sql===archive.INSERT_SQL));
 assert.equal(conflicting.calls.at(-1).sql,'ROLLBACK');
});
test('malformed provider, user and batch fail before database read',async()=>{
 for(const data of [
  {user_id:'other'}, {user_id:other+'X'}, {provider:'deepseek'},
  {conversations:null},{conversations:[]}
 ]){
  const m=mock();
  await assert.rejects(run(m,data),/brain_personal_archive_request_denied/);
  assert.equal(m.calls.length,0);
 }
});
test('invalid insert receipts or post-write changed digest abort entire transaction',async()=>{
 const m=mock({invalidReceipt:true});
 await assert.rejects(run(m),/insert_receipt_invalid/);
 assert.equal(m.calls.at(-1).sql,'ROLLBACK');
 assert(m.released);
});
test('migration is personal-only with owner RLS, source grants and purge cascade',()=>{
 const sql=fs.readFileSync(path.resolve(__dirname,
  '../../../migrations/hermes/049_create_personal_conversation_archive.sql'),'utf8');
 for(const name of ['personal_import_consents','personal_conversation_messages']){
  assert.match(sql,new RegExp('ALTER TABLE hermes_brain[.]'+name+
    ' ENABLE ROW LEVEL SECURITY'));
  assert.match(sql,new RegExp('ALTER TABLE hermes_brain[.]'+name+
    ' FORCE ROW LEVEL SECURITY'));
 }
 assert.match(sql,/owner_user_id=\(SELECT auth[.]uid\(\)\)/);
 assert.match(sql,/personal_history_create_with_active_consent/);
 assert.match(sql,/g[.]revoked_at IS NULL/);
 assert.match(sql,/ON DELETE CASCADE/);
 assert.match(sql,/classification='confidential'/);
 assert.match(sql,/visibility='owner_only'/);
 assert.match(sql,/memory_status='unreviewed'/);
 assert.match(sql,/GRANT DELETE/);
 assert.doesNotMatch(sql,/SECURITY DEFINER|GRANT UPDATE \(content\)|GRANT ALL ON TABLE/i);
});

test('large, circular or non-serializable batches never open database sessions',async()=>{
 const huge=[{...sample[0],title:'X'.repeat(2200000)}];
 const oversized=mock();
 await assert.rejects(run(oversized,{conversations:huge}),/request_size_denied/);
 assert.equal(oversized.calls.length,0);
 const circular=structuredClone(sample);
 circular[0].self=circular[0];
 const bad=mock();
 await assert.rejects(run(bad,{conversations:circular}),/invalid_json/);
 assert.equal(bad.calls.length,0);
});
