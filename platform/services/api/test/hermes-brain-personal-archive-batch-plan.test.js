'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planPersonalArchiveBatches,storePlannedPersonalArchive}
 =require('../src/runtime/hermes-brain-personal-archive-batch-plan');
const archived=require('../src/runtime/hermes-brain-personal-conversation-import');
const USER='11111111-1111-4111-8111-111111111111';
const GRANT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function makeConversations(total){
 return Array.from({length:total},(_,i)=>({
  conversation_id:'conv_'+i,current_node:'end',
  title:'Synthetic conversation '+i,
  mapping:{end:{parent:null,message:{id:'msg_'+i,
   author:{role:'user'},create_time:1760000000+i,
   content:{content_type:'text',parts:['Synthetic planning fact '+i]}}}}
 }));
}
function db(){
 const map=new Map(),calls=[];let blockAt=-1;let insertCalls=0;
 const pool={connect:async()=>({
  async query(sql,params){
   calls.push(sql);
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
   if(sql.startsWith('SELECT (SELECT auth.uid())'))
    return {rows:[{user_id:USER,db_role:'authenticated'}]};
   if(sql===archived.CONSENT_SQL)return {rows:[{grant_id:GRANT}]};
   if(sql===archived.BEFORE_SQL)
    return {rows:[...map.entries()].filter(([key])=>params[1].includes(key))
      .map(([source_ref,content_digest])=>({source_ref,content_digest}))};
   if(sql===archived.INSERT_SQL){
    insertCalls++;
    if(blockAt===insertCalls)throw Error('Synthetic temporary SQL failure');
    const rows=[];
    for(const x of JSON.parse(params[3])){
     if(map.has(x.source_ref))continue;
     map.set(x.source_ref,x.content_digest);
     rows.push({source_ref:x.source_ref});
    }
    return {rows};
   }
   throw Error('Unexpected mock query');
  },
  release(){}
 })};
 return {pool,map,calls,blockAfterOneImport(){blockAt=insertCalls+2},unblock(){blockAt=-1}};
}
test('multiple batches preserve every supported conversation and never exceed size/message limits',()=>{
 const plan=planPersonalArchiveBatches({provider:'chatgpt',user_id:USER,
  conversations:makeConversations(620)});
 assert.equal(plan.conversation_count,620);
 assert.equal(plan.text_message_count,620);
 assert.equal(plan.batch_count,2);
 assert.equal(plan.history_persisted,false);
 assert.equal(plan.memory_written,false);
 assert.equal(plan.tenant_id,'personal::'+USER);
 assert.equal(plan.coverage,'supported_text_only');
 assert.deepEqual(plan.batches.map(x=>x.message_count),[500,120]);
 assert(plan.batches.every(x=>x.raw_bytes<=2*1024*1024&&
  x.normalized_bytes<=2*1024*1024));
 assert.equal(plan.batches.reduce((a,x)=>a+x.conversation_count,0),620);
});
test('single oversized conversation, unsupported-only, duplicate and invalid namespace are denied without truncation',()=>{
 const conversations=makeConversations(620);
 const combined={conversation_id:'large',current_node:null,mapping:{}};
 for(let i=0;i<501;i++){
  combined.mapping['node'+i]={parent:null,message:{id:'msg'+i,
   author:{role:'user'},content:{parts:['Synthetic #'+i]}}};
 }
 for(const bad of [[combined],[{...conversations[0],
   mapping:{root:{parent:null,message:null}}}],
   [conversations[0],conversations[0]]]){
  assert.throws(()=>planPersonalArchiveBatches({
   provider:'chatgpt',user_id:USER,conversations:bad
  }),/brain_personal_batch_plan_/);
 }
 assert.throws(()=>planPersonalArchiveBatches({
  provider:'claude',user_id:'not-uuid',conversations:[{}]
 }),/request_denied/);
 assert.throws(()=>planPersonalArchiveBatches({
  provider:'manus',user_id:USER,conversations:[{}]
 }),/request_denied/);
});
test('constrained import commits idempotently in multiple authenticated transactions',async()=>{
 const client=db(),conversations=makeConversations(520);
 const first=await storePlannedPersonalArchive({
  pool:client.pool,provider:'chatgpt',user_id:USER,conversations
 });
 assert.equal(first.status,'stored_personal_text_only');
 assert.equal(first.inserted,520);
 assert.equal(first.duplicates,0);
 assert.equal(first.batches_committed,2);
 assert.equal(first.text_messages,520);
 assert.equal(first.memory_written,false);
 assert.equal(first.corporate_visibility,false);
 assert.equal(client.map.size,520);
 const retry=await storePlannedPersonalArchive({
  pool:client.pool,provider:'chatgpt',user_id:USER,conversations
 });
 assert.equal(retry.inserted,0);
 assert.equal(retry.duplicates,520);
 assert.equal(client.map.size,520);
 assert.equal(client.calls.filter(x=>x==='COMMIT').length,4);
});
test('partial network/database failure is retryable without text in error or duplicate writes',async()=>{
 const client=db(),conversations=makeConversations(515);
 // Prepopulate first batch and force failure on second, to simulate a
 // previously committed chunk and an interrupted import.
 const first=conversations.slice(0,500);
 await storePlannedPersonalArchive({
  pool:client.pool,provider:'chatgpt',user_id:USER,conversations:first
 });
 assert.equal(client.map.size,500);
 // One idempotent batch succeeds, the following batch fails.\n client.blockAfterOneImport();
 await assert.rejects(storePlannedPersonalArchive({
  pool:client.pool,provider:'chatgpt',user_id:USER,conversations
 }),e=>{
  assert.equal(e.message,'brain_personal_archive_retry_safe_incomplete');
  assert.equal(e.completed_batches,1);
  assert.equal(e.total_batches,2);
  assert(!JSON.stringify(e).includes('Synthetic planning fact'));
  return true;
 });
 client.unblock();
 const resumed=await storePlannedPersonalArchive({
  pool:client.pool,provider:'chatgpt',user_id:USER,conversations
 });
 assert.equal(resumed.inserted,15);
 assert.equal(resumed.duplicates,500);
 assert.equal(client.map.size,515);
});
test('media omitted is reported, never marked as complete',()=>{
 const conversations=makeConversations(1);
 conversations[0].mapping.end.message.content.parts.push({
  content_type:'image_asset_pointer',asset_pointer:'synthetic'
 });
 const plan=planPersonalArchiveBatches({
  provider:'chatgpt',user_id:USER,conversations
 });
 assert.equal(plan.omitted_nontext_parts,1);
 assert.equal(plan.coverage,'partial_text_only');
 assert.equal(plan.text_message_count,1);
});
