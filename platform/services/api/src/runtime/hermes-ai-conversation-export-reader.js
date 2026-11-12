'use strict';
// Offline normalization only. NEVER read files, call providers, write memory,
// emit the conversation text to logs, or infer corporate sharing permissions.
const {createHash}=require('node:crypto');
const PROVIDERS=new Set(['chatgpt','claude']);
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const SOURCE_ID=/^[A-Za-z0-9_.:-]{1,160}$/;
const MAX_CONVERSATIONS=1000,MAX_MESSAGES=1000,MAX_CHARS=16000;
const digest=s=>createHash('sha256').update(s).digest('hex');
function deny(code){throw Error('ai_export_'+code);}
function isObj(x){return !!x&&typeof x==='object'&&!Array.isArray(x);}
function strictDate(x){
 if(typeof x==='number'&&Number.isFinite(x)&&x>0&&x<5000000000)
  return new Date(x*1000).toISOString();
 if(typeof x==='string'&&x.length<=40&&!Number.isNaN(Date.parse(x)))
  return new Date(x).toISOString();
 return null;
}
function cleanText(parts){
 if(typeof parts==='string')return parts;
 if(!Array.isArray(parts))return null;
 const tokens=[];
 for(const part of parts){
  if(typeof part==='string')tokens.push(part);
  else if(isObj(part)&&part.type==='text'&&typeof part.text==='string')
   tokens.push(part.text);
 }
 return tokens.length?tokens.join('\n'):null;
}
function textualContent(content){
 if(typeof content==='string')return content;
 if(!isObj(content))return null;
 // ChatGPT exported text parts; Claude content blocks or direct text.
 if(Array.isArray(content.parts))return cleanText(content.parts);
 if(Array.isArray(content))return cleanText(content);
 if(typeof content.text==='string')return content.text;
 return null;
}
function nonTextPartCount(content){
 const parts=Array.isArray(content)?content:
  (isObj(content)&&Array.isArray(content.parts)?content.parts:null);
 if(!parts)return 0;
 return parts.filter(x=>!(typeof x==='string'||
   (isObj(x)&&x.type==='text'&&typeof x.text==='string'))).length;
}
function selectedChatGPTBranch(conversation){
 const map=conversation.mapping;
 if(conversation.current_node===undefined||conversation.current_node===null)
  return null;
 const node=conversation.current_node;
 if(!SOURCE_ID.test(node)||!Object.hasOwn(map,node))
  deny('selected_branch_invalid');
 const selected=new Set();
 let current=node;
 while(current!==null){
  if(selected.has(current)||selected.size>MAX_MESSAGES*3)
   deny('selected_branch_cycle');
  selected.add(current);
  const obj=map[current];
  if(!isObj(obj))deny('selected_branch_shape_invalid');
  const parent=obj.parent??null;
  if(parent!==null&&(!SOURCE_ID.test(parent)||!Object.hasOwn(map,parent)))
   deny('selected_branch_parent_invalid');
  current=parent;
 }
 return selected;
}
function sourceRef(provider,conversation_id,message_id){
 return provider+':'+digest(conversation_id).slice(0,28)+':'+digest(message_id).slice(0,28);
}
function verifyGrant(grant,provider){
 // This is a *shape defense*; NEVER accept a claim sent from the model/user.
 // The enclosing ingress MUST authenticate JWT and obtain the approved grant
 // from its server-side connection registry before invoking this function.
 if(!isObj(grant)||grant.authenticated!==true||
    grant.verified_session_selection!==true||
    grant.source_export_authorized!==true||
    grant.workspace_type!=='personal'||!ID.test(grant.user_id)||
    grant.tenant_id!=='personal::'+grant.user_id||
    grant.approved_provider!==provider||
    !SOURCE_ID.test(grant.authorization_ref))
  deny('personal_grant_required');
}
function asRecords(source,provider){
 if(!Array.isArray(source)||source.length>MAX_CONVERSATIONS)
  deny('batch_shape_or_size_denied');
 return source.map((conversation,index)=>{
  if(!isObj(conversation))deny('conversation_shape_denied');
  if(provider==='chatgpt'&&conversation.id&&conversation.conversation_id&&
     conversation.id!==conversation.conversation_id)
   deny('ambiguous_conversation_identity');
  const original_id=provider==='chatgpt'?
    (conversation.conversation_id||conversation.id):
    (conversation.uuid||conversation.id);
  if(typeof original_id!=='string'||!SOURCE_ID.test(original_id))
   deny('conversation_id_denied');
  const title=typeof conversation.title==='string'?conversation.title:
   (typeof conversation.name==='string'?conversation.name:'');
  if(title.length>240)deny('conversation_title_too_long');
  let messages=[];
  if(provider==='chatgpt'){
   if(!isObj(conversation.mapping))deny('mapping_required');
   const selected=selectedChatGPTBranch(conversation);
   const nodes=Object.entries(conversation.mapping);
   if(nodes.length>MAX_MESSAGES*3)deny('mapping_too_large');
   for(const [node_id,node] of nodes){
    if(!SOURCE_ID.test(node_id)||!isObj(node))deny('mapping_invalid');
    const m=node.message;
    if(!m)continue;
    if(!isObj(m))deny('message_invalid');
    const original_message_id=m.id||node_id;
    if(!SOURCE_ID.test(original_message_id))deny('message_id_denied');
    const role=m.author?.role;
    const parent_node_id=node.parent||null;
    if(parent_node_id!==null&&(!SOURCE_ID.test(parent_node_id)||
        !Object.hasOwn(conversation.mapping,parent_node_id)))
     deny('parent_id_denied');
    const parent=parent_node_id?conversation.mapping[parent_node_id]:null;
    const parent_id=parent&&isObj(parent.message)?
      (parent.message.id||parent_node_id):null;
    if(parent_id!==null&&!SOURCE_ID.test(parent_id))deny('parent_id_denied');
    const text=textualContent(m.content);
    messages.push({original_message_id,role,parent_id,
      timestamp:strictDate(m.create_time),nontext_parts:nonTextPartCount(m.content),
      branch_status:selected===null?'unknown':
       selected.has(node_id)?'selected':'alternate',
      text,kind:m.content?.content_type||'unknown'});
   }
  }else{
   if(!Array.isArray(conversation.chat_messages))deny('chat_messages_required');
   for(let i=0;i<conversation.chat_messages.length;i++){
    const m=conversation.chat_messages[i];
    if(!isObj(m))deny('message_invalid');
    const original_message_id=m.uuid||m.id;
    if(!SOURCE_ID.test(original_message_id))deny('message_id_denied');
    const role=m.sender;
    const text=typeof m.text==='string'?m.text:
      (Array.isArray(m.content)?cleanText(m.content):textualContent(m.content));
    messages.push({original_message_id,role,parent_id:null,
      timestamp:strictDate(m.created_at),nontext_parts:nonTextPartCount(m.content),
      branch_status:'not_applicable',text,kind:'claude_message'});
   }
  }
  if(messages.length>MAX_MESSAGES)deny('too_many_messages');
  return {original_id,title,updated_at:strictDate(
    conversation.update_time||conversation.updated_at),
   messages,index};
 });
}
function normalizeExport({provider,conversations,grant}={}){
 if(!PROVIDERS.has(provider))deny('unsupported_provider');
 verifyGrant(grant,provider);
 const recs=asRecords(conversations,provider);
 const keys=new Set(),items=[],seenConversations=new Set();
 let ignored=0,unsupported=0,nontext=0;
 let selectedMessages=0,alternateMessages=0,unknownBranchMessages=0;
 for(const conv of recs){
  if(seenConversations.has(conv.original_id))deny('duplicate_conversation');
  seenConversations.add(conv.original_id);
  // Original exported message text stays in-process, not in audit receipts.
  const conv_key=provider+':'+digest(conv.original_id).slice(0,32);
  let included=0,unknown=0;
  const seenMessages=new Set();
  for(const m of conv.messages){
   if(seenMessages.has(m.original_message_id))deny('duplicate_message');
   seenMessages.add(m.original_message_id);
   const role=provider==='chatgpt'?m.role==='user'?'user':
    m.role==='assistant'?'assistant':null:
    m.role==='human'?'user':m.role==='assistant'?'assistant':null;
   if(!role){ignored++;continue;} // No system/tool/developer transcription
   nontext+=m.nontext_parts;
   if(typeof m.text!=='string'||!m.text.trim()){
    unsupported++;unknown++;continue; // nontext/media coverage explicitly reported
   }
   if(m.text.length>MAX_CHARS)deny('message_too_large_split_required');
   const key=sourceRef(provider,conv.original_id,m.original_message_id);
   if(keys.has(key))deny('duplicate_normalized_source_ref');
   keys.add(key);
   items.push(Object.freeze({
    provider,tenant_id:grant.tenant_id,workspace_type:'personal',
    owner_user_id:grant.user_id,company_id:null,store_id:null,
    source_ref:key,conversation_ref:conv_key,
    conversation_title:conv.title,conversation_updated_at:conv.updated_at,
    role,created_at:m.timestamp,
    parent_ref:m.parent_id?sourceRef(provider,conv.original_id,m.parent_id):null,
    branch_status:m.branch_status,nontext_parts_omitted:m.nontext_parts,
    content:m.text,
    content_digest:'sha256:'+digest(m.text),
    classification:'confidential',visibility:'owner_only',
    memory_status:'unreviewed',source_authorization_ref:grant.authorization_ref
   }));
   included++;
   if(m.branch_status==='selected')selectedMessages++;
   else if(m.branch_status==='alternate')alternateMessages++;
   else if(m.branch_status==='unknown')unknownBranchMessages++;
  }
  // Empty/system-only/multimodal-only conversations are *not* counted as
  // fully recovered; receipts must not claim full coverage.
  if(included===0)unsupported++;
 }
 return Object.freeze({
  provider,tenant_id:grant.tenant_id,workspace_type:'personal',
  conversation_count:recs.length,message_count:items.length,
  omitted_nonuser_messages:ignored,unsupported_text_messages:unsupported,
  omitted_nontext_parts:nontext,selected_branch_messages:selectedMessages,
  alternate_branch_messages:alternateMessages,
  unknown_branch_messages:unknownBranchMessages,
  coverage:unsupported||nontext?'partial_text_only':'supported_text_only',
  items:Object.freeze(items),status:'normalized_unpersisted',
  raw_export_persisted:false,memory_written:false,
  cross_workspace_shared:false,provider_api_called:false,
  requires_review:true
 });
}
module.exports={normalizeExport,sourceRef,verifyGrant};
