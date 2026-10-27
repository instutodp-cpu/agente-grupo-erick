'use strict';
// Read-only, user-bound, approved-source personal history search.
// Results are HISTORICALLY EXPORTED TEXT, never authenticated instructions,
// endorsed facts, corporate memory or authority for real-world actions.
const {withAuthenticatedTransaction}=require('./hermes-brain-authenticated-transaction');
const {createHash}=require('node:crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[a-f0-9]{64}$/;
const PROVIDERS=new Set(['chatgpt','claude']);
const ROLES=new Set(['user','assistant']);
const BRANCHES=new Set(['selected','alternate','unknown','not_applicable']);
const REF=/^(chatgpt|claude):[a-f0-9]{28}:[a-f0-9]{28}$/;
const CONV=/^(chatgpt|claude):[a-f0-9]{32}$/;
const SEARCH_SQL=[
 'SELECT m.owner_user_id::text AS owner_user_id,m.provider,m.source_ref,',
 'm.conversation_ref,m.parent_ref,m.conversation_title,',
 'm.role,m.branch_status,m.created_at_source,m.content,',
 'm.content_digest,m.nontext_parts_omitted,m.classification,',
 'm.visibility,m.memory_status',
 'FROM hermes_brain.personal_conversation_messages m',
 'JOIN hermes_brain.personal_import_consents g',
 'ON g.owner_user_id=m.owner_user_id AND g.provider=m.provider',
 'AND g.grant_id=m.grant_id',
 'WHERE m.owner_user_id=(SELECT auth.uid()) AND g.revoked_at IS NULL',
 'AND m.provider=$1',
 'AND to_tsvector(\'simple\',m.content)',
 '@@ plainto_tsquery(\'simple\',$2)',
 'ORDER BY m.created_at_source DESC NULLS LAST,m.source_ref',
 'LIMIT $3'
].join(' ');
function deny(code){throw Error('brain_personal_search_'+code);}
function validTerm(s){
 return typeof s==='string'&&s.trim().length>=2&&s.length<=120&&
 !/[\u0000-\u001f\u007f]/.test(s);
}
function dateOrNull(d){
 if(d===null)return null;
 const x=d instanceof Date?d.toISOString():d;
 if(typeof x!=='string'||!Number.isFinite(Date.parse(x)))deny('result_invalid');
 return x;
}
async function searchPersonalHistory({pool,user_id,provider,term,limit=5}={}){
 if(!UUID.test(user_id||'')||!PROVIDERS.has(provider)||
   !validTerm(term)||!Number.isSafeInteger(limit)||limit<1||limit>10)
  deny('request_denied');
 return withAuthenticatedTransaction({pool,user_id,readOnly:true,work:async client=>{
  const rows=(await client.query(SEARCH_SQL,[provider,term.trim(),limit]))?.rows;
  if(!Array.isArray(rows)||rows.length>limit)deny('result_invalid');
  const items=[];
  const seen=new Set();
  for(const r of rows){
   if(!r||r.owner_user_id!==user_id||r.provider!==provider||
      !REF.test(r.source_ref)||!r.source_ref.startsWith(provider+':')||
      seen.has(r.source_ref)||!CONV.test(r.conversation_ref)||
      !r.conversation_ref.startsWith(provider+':')||
      (r.parent_ref!==null&&(!REF.test(r.parent_ref)||
        !r.parent_ref.startsWith(provider+':')))||
      !ROLES.has(r.role)||!BRANCHES.has(r.branch_status)||
      typeof r.content!=='string'||!r.content||r.content.length>16000||
      !HASH.test(r.content_digest)||
      r.content_digest!=='sha256:'+createHash('sha256').update(r.content).digest('hex')||
      typeof r.conversation_title!=='string'||r.conversation_title.length>240||
      r.classification!=='confidential'||
      r.visibility!=='owner_only'||r.memory_status!=='unreviewed'||
      !Number.isSafeInteger(r.nontext_parts_omitted)||
      r.nontext_parts_omitted<0||r.nontext_parts_omitted>1000)
    deny('result_invalid');
   seen.add(r.source_ref);
   items.push(Object.freeze({
    source_ref:r.source_ref,conversation_ref:r.conversation_ref,
    parent_ref:r.parent_ref,conversation_title:r.conversation_title,
    created_at_source:dateOrNull(r.created_at_source),
    role:r.role,branch_status:r.branch_status,
    content:r.content,content_digest:r.content_digest,
    nontext_parts_omitted:r.nontext_parts_omitted,
    provenance_provider:provider,
    trust_level:'unreviewed_personal_archive',
    may_use_as_instructions:false,
    corporate_visibility:false
   }));
  }
  return Object.freeze({
   status:'private_history_search',tenant_id:'personal::'+user_id,
   provider,items:Object.freeze(items),
   source_access_is_revocable:true,read_only:true,
   memory_written:false,corporate_visibility:false
  });
 }});
}
module.exports={searchPersonalHistory,SEARCH_SQL};
