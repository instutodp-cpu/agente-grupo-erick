'use strict';
// Private ChatGPT/Claude archive write port. Authenticated Postgres JWT pool
// must be constructed by trusted ingress; never accept service_role or caller
// claims as a replacement for withAuthenticatedTransaction.
const {withAuthenticatedTransaction}=require('./hermes-brain-authenticated-transaction');
const {normalizeExport}=require('./hermes-ai-conversation-export-reader');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[a-f0-9]{64}$/;
const MAX_BATCH=500,MAX_JSON_BYTES=2*1024*1024;
function deny(reason){throw Error('brain_personal_archive_'+reason);}
const CONSENT_SQL=[
 'SELECT grant_id::text AS grant_id',
 'FROM hermes_brain.personal_import_consents',
 'WHERE owner_user_id=(SELECT auth.uid()) AND provider=$1 AND revoked_at IS NULL',
 'LIMIT 2'].join(' ');
const BEFORE_SQL=[
 'SELECT source_ref,content_digest',
 'FROM hermes_brain.personal_conversation_messages',
 'WHERE owner_user_id=(SELECT auth.uid()) AND provider=$1 AND source_ref=ANY($2::text[])',
 'LIMIT 501'].join(' ');
const INSERT_SQL=[
 'INSERT INTO hermes_brain.personal_conversation_messages',
 '(owner_user_id,provider,grant_id,source_ref,conversation_ref,parent_ref,',
 'conversation_title,conversation_updated_at,role,branch_status,',
 'created_at_source,content,content_digest,nontext_parts_omitted)',
 'SELECT $1::uuid,$2::text,$3::uuid,m.source_ref,m.conversation_ref,m.parent_ref,',
 'm.conversation_title,m.conversation_updated_at::timestamptz,m.role,',
 'm.branch_status,m.created_at_source::timestamptz,m.content,m.content_digest,',
 'm.nontext_parts_omitted',
 'FROM jsonb_to_recordset($4::jsonb) AS m',
 '(source_ref text,conversation_ref text,parent_ref text,conversation_title text,',
 'conversation_updated_at text,role text,branch_status text,',
 'created_at_source text,content text,content_digest text,',
 'nontext_parts_omitted integer)',
 'WHERE EXISTS (SELECT 1 FROM hermes_brain.personal_import_consents c',
 'WHERE c.owner_user_id=$1::uuid AND c.provider=$2 AND c.grant_id=$3::uuid',
 'AND c.revoked_at IS NULL)',
 'ON CONFLICT (owner_user_id,provider,source_ref) DO NOTHING',
 'RETURNING source_ref'].join(' ');
async function storePersonalConversationBatch({pool,user_id,provider,conversations}={}){
 if(!UUID.test(user_id||'')||!['chatgpt','claude'].includes(provider)||
    !Array.isArray(conversations)||conversations.length<1)
   deny('request_denied');
 // Preflight before acquiring a database connection. The authenticated
 // ingress must ALSO reject HTTP bodies larger than this limit.
 let preview;
 try{preview=JSON.stringify(conversations)}
 catch{deny('invalid_json')}
 if(typeof preview!=='string'||Buffer.byteLength(preview,'utf8')>MAX_JSON_BYTES)
  deny('request_size_denied');
 preview=null;
 return withAuthenticatedTransaction({pool,user_id,readOnly:false,work:async client=>{
  const consents=await client.query(CONSENT_SQL,[provider]);
  if(consents?.rows?.length!==1||!UUID.test(consents.rows[0]?.grant_id||''))
   deny('authenticated_consent_required');
  const ref=consents.rows[0].grant_id;
  const grant={authenticated:true,verified_session_selection:true,
   source_export_authorized:true,workspace_type:'personal',
   user_id,tenant_id:'personal::'+user_id,approved_provider:provider,
   authorization_ref:ref};
  const normalized=normalizeExport({provider,conversations,grant});
  if(normalized.message_count===0)deny('no_text_messages');
  if(normalized.message_count>MAX_BATCH)deny('batch_limit');
  const records=normalized.items.map(x=>({
   source_ref:x.source_ref,conversation_ref:x.conversation_ref,
   parent_ref:x.parent_ref,conversation_title:x.conversation_title,
   conversation_updated_at:x.conversation_updated_at,
   role:x.role,branch_status:x.branch_status,
   created_at_source:x.created_at,content:x.content,
   content_digest:x.content_digest,
   nontext_parts_omitted:x.nontext_parts_omitted
  }));
  if(records.some(x=>!SHA256.test(x.content_digest)))deny('digest_denied');
  const payload=JSON.stringify(records);
  if(Buffer.byteLength(payload,'utf8')>MAX_JSON_BYTES)deny('payload_too_large');
  const refs=records.map(x=>x.source_ref);
  const verify=async()=>{
   const result=await client.query(BEFORE_SQL,[provider,refs]);
   const rows=result?.rows;
   if(!Array.isArray(rows)||rows.length>MAX_BATCH)deny('readback_invalid');
   const byRef=new Map(records.map(x=>[x.source_ref,x.content_digest]));
   const seen=new Set();
   for(const x of rows){
    if(typeof x?.source_ref!=='string'||seen.has(x.source_ref)||
       !byRef.has(x.source_ref)||x.content_digest!==byRef.get(x.source_ref))
     deny('source_revision_conflict');
    seen.add(x.source_ref);
   }
   return seen.size;
  };
  const existing=await verify();
  const inserted=await client.query(INSERT_SQL,[user_id,provider,ref,payload]);
  if(!Array.isArray(inserted?.rows)||inserted.rows.length>MAX_BATCH)
   deny('insert_receipt_invalid');
  const after=await verify();
  if(after!==records.length||inserted.rows.length+existing!==records.length)
   deny('post_write_completeness_unverified');
  const insertedRefs=new Set(inserted.rows.map(x=>x.source_ref));
  if(insertedRefs.size!==inserted.rows.length||
     [...insertedRefs].some(x=>!refs.includes(x)))deny('insert_receipt_invalid');
  return Object.freeze({
   status:'stored_personal_unreviewed',provider,
   tenant_id:'personal::'+user_id,
   conversations_examined:normalized.conversation_count,
   text_messages:normalized.message_count,
   inserted:inserted.rows.length,duplicates:existing,
   omitted_nontext_parts:normalized.omitted_nontext_parts,
   unsupported_text_messages:normalized.unsupported_text_messages,
   memory_written:false,corporate_visibility:false,
   provider_api_called:false,requires_review:true
  });
 }});
}
module.exports={storePersonalConversationBatch,CONSENT_SQL,BEFORE_SQL,INSERT_SQL};
