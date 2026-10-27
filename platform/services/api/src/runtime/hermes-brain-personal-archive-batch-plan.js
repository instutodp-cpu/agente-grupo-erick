'use strict';
// Pure in-memory planner for official ChatGPT/Claude JSON. Does not upload,
// print, persist, authenticate or approve historical messages.
// Every batch is reauthenticated by storePersonalConversationBatch at write time.
const {normalizeExport}=require('./hermes-ai-conversation-export-reader');
const {createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_CONVERSATIONS=20000,MAX_ITEMS=500,MAX_BYTES=2*1024*1024;
function deny(code){throw Error('brain_personal_batch_plan_'+code);}
function bytes(value){
 let encoded;
 try{encoded=JSON.stringify(value)}catch{deny('non_serializable_export')}
 if(typeof encoded!=='string')deny('non_serializable_export');
 return Buffer.byteLength(encoded,'utf8');
}
function localGrant(provider,owner){
 // Preview only. Not a credential, login session or persisted consent.
 return {authenticated:true,verified_session_selection:true,
  source_export_authorized:true,workspace_type:'personal',
  user_id:owner,tenant_id:'personal::'+owner,
  approved_provider:provider,authorization_ref:'untrusted_batch_preview'};
}
function idOf(conversation,provider){
 if(!conversation||typeof conversation!=='object'||Array.isArray(conversation))
  deny('invalid_conversation');
 return provider==='chatgpt'?
  (conversation.conversation_id||conversation.id):
  (conversation.uuid||conversation.id);
}
function planPersonalArchiveBatches({provider,user_id,conversations}={}){
 if(!['chatgpt','claude'].includes(provider)||!UUID.test(user_id||'')||
  !Array.isArray(conversations)||conversations.length<1||
  conversations.length>MAX_CONVERSATIONS)
  deny('request_denied');
 const grant=localGrant(provider,user_id);
 const seen=new Set(),batches=[];
 let current=[],selectedCount=0,omitted=0,nontext=0,unsupported=0;
 const check=group=>{
  const normal=normalizeExport({provider,conversations:group,grant});
  const rawBytes=bytes(group),normalizedBytes=bytes(normal.items);
  return {normal,rawBytes,normalizedBytes};
 };
 const fits=result=>
  result.normal.message_count>=1&&result.normal.message_count<=MAX_ITEMS&&
  result.rawBytes<=MAX_BYTES&&result.normalizedBytes<=MAX_BYTES;
 function publish(group,result){
  if(!fits(result))deny('unrepresentable_batch');
  batches.push(Object.freeze({
   // Confidential, in-process only; never include this field in a public
   // receipt, log, telemetry, error or network response.
   conversations:Object.freeze([...group]),
   conversation_count:group.length,
   message_count:result.normal.message_count,
   raw_bytes:result.rawBytes,
   normalized_bytes:result.normalizedBytes
  }));
  selectedCount+=result.normal.message_count;
  omitted+=result.normal.omitted_nonuser_messages;
  nontext+=result.normal.omitted_nontext_parts;
  unsupported+=result.normal.unsupported_text_messages;
 }
 for(const conversation of conversations){
  const id=idOf(conversation,provider);
  if(typeof id!=='string'||!id||id.length>160)deny('invalid_conversation_id');
  const key=createHash('sha256').update(id).digest('hex');
  if(seen.has(key))deny('duplicate_conversation');
  seen.add(key);
  // First confirm each conversation can be handled without skipping messages.
  const individual=check([conversation]);
  if(!fits(individual))deny('conversation_exceeds_batch_limits');
  if(current.length===0){current=[conversation];continue;}
  const next=[...current,conversation];
  const candidate=check(next);
  if(fits(candidate)){current=next;continue;}
  const finished=check(current);
  publish(current,finished);
  current=[conversation];
 }
 if(current.length)publish(current,check(current));
 if(!batches.length||batches.reduce((s,b)=>s+b.conversation_count,0)!==
    conversations.length||selectedCount<1)
  deny('incomplete_plan');
 return Object.freeze({
  status:'private_batches_planned_not_imported',
  provider,tenant_id:'personal::'+user_id,
  conversation_count:conversations.length,
  text_message_count:selectedCount,
  omitted_nonuser_messages:omitted,
  omitted_nontext_parts:nontext,
  unsupported_text_messages:unsupported,
  coverage:unsupported||nontext?'partial_text_only':'supported_text_only',
  batch_count:batches.length,
  batches:Object.freeze(batches),
  memory_written:false,history_persisted:false,requires_authentication:true
 });
}
// Every batch gets its OWN authenticated transaction and a fresh consent
// lookup. A failed later batch leaves earlier batches committed, so repeating
// this same export safely resumes through stable source_ref deduplication.
async function storePlannedPersonalArchive({pool,user_id,provider,conversations}={}){
 const plan=planPersonalArchiveBatches({provider,user_id,conversations});
 const {storePersonalConversationBatch}=require('./hermes-brain-personal-conversation-import');
 let inserted=0,duplicates=0,completed=0;
 for(const batch of plan.batches){
  let receipt;
  try{
   receipt=await storePersonalConversationBatch({
    pool,user_id,provider,conversations:batch.conversations
   });
  }catch{
   // Do not propagate SQL/provider exceptions containing private input data.
   const error=Error('brain_personal_archive_retry_safe_incomplete');
   error.completed_batches=completed;
   error.total_batches=plan.batch_count;
   throw error;
  }
  if(!receipt||receipt.status!=='stored_personal_unreviewed'||
    receipt.provider!==provider||receipt.tenant_id!==plan.tenant_id||
    receipt.memory_written!==false||receipt.corporate_visibility!==false||
    !Number.isSafeInteger(receipt.inserted)||
    !Number.isSafeInteger(receipt.duplicates)||
    receipt.inserted<0||receipt.duplicates<0||
    receipt.inserted+receipt.duplicates!==batch.message_count){
   throw Error('brain_personal_archive_unverified_batch_receipt');
  }
  inserted+=receipt.inserted;duplicates+=receipt.duplicates;completed++;
 }
 if(completed!==plan.batch_count||
   inserted+duplicates!==plan.text_message_count)
  throw Error('brain_personal_archive_unverified_completion');
 return Object.freeze({
  status:'stored_personal_text_only',provider,
  tenant_id:plan.tenant_id,
  conversations_examined:plan.conversation_count,
  text_messages:plan.text_message_count,
  batches_committed:completed,batches_planned:plan.batch_count,
  inserted,duplicates,
  omitted_nonuser_messages:plan.omitted_nonuser_messages,
  unsupported_text_messages:plan.unsupported_text_messages,
  omitted_nontext_parts:plan.omitted_nontext_parts,
  coverage:plan.coverage,
  history_persisted:true,memory_written:false,
  corporate_visibility:false,requires_review:true
 });
}
module.exports={planPersonalArchiveBatches,storePlannedPersonalArchive};
