'use strict';
// Central memory publication adapter. Pure planning only, NEVER database writes.
// The caller MUST derive principal/membership/source attestations from an
// authenticated Supabase session, not Telegram IDs, prompts or LLM outputs.
const crypto=require('node:crypto');
const curator=require('./hermes-automemory-curator');
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const TENANT='grupo_erick';
const sha=x=>'sha256:'+crypto.createHash('sha256').update(x).digest('hex');
const SCHEMA='hermes_brain';
function sourceFor(m){
 if(m.kind==='confirmed_decision'&&/^owner_confirmed_telegram:[a-f0-9]{12}$/.test(m.source))
  return 'telegram_owner_confirmed';
 if(m.kind==='verified_aggregate'&&
  ['hermes_history.monthly_commercial_2025_2026_v1',
   'hermes_history.monthly_product_activity_v1'].includes(m.source))
  return 'supabase_history';
 throw Error('brain_source_not_authorized');
}
function deny(reason){return {status:'blocked',reason,count:0,rows:[]};}
function prepare({store,principal,membership,verifiedSources,now=Date.now()}={}){
 if(!Number.isSafeInteger(now))throw Error('brain_time_invalid');
 const items=curator.check(store,now).items.filter(x=>Date.parse(x.expires_at)>now);
 if(!items.length)return deny('no_active_memories');
 // Unlike telegram_owner_id, principal.user_id must come from a trusted
 // Supabase auth.getUser()/RLS session and match this exact membership.
 if(!principal||principal.tenant_id!==TENANT||!ID.test(principal.user_id||'')||
  principal.authenticated!==true)return deny('supabase_user_identity_required');
 if(!membership||membership.tenant_id!==TENANT||membership.user_id!==principal.user_id||
  membership.status!=='active')return deny('authenticated_membership_required');
 if(!Array.isArray(membership.allowed_domains)||
  !Array.isArray(membership.allowed_classifications)||
  !Array.isArray(membership.allowed_visibilities)||
  !membership.allowed_classifications.includes('internal')||
  !membership.allowed_visibilities.includes('owner_only')||
  items.some(m=>!membership.allowed_domains.includes(m.domain)))
  return deny('membership_domain_scope_denied');
 if(!Array.isArray(verifiedSources)||verifiedSources.length>40)return deny('verified_source_catalog_required');
 const rows=[];
 const refs=new Set();
 for(const m of items){
  const provider=sourceFor(m);
  const referenceDigest=sha(TENANT+':source:'+m.source);
  const matches=verifiedSources.filter(s=>s?.tenant_id===TENANT&&
   s?.status==='verified'&&s?.provider===provider&&
   s?.reference_digest===referenceDigest&&ID.test(s?.source_id||''));
  if(matches.length!==1)return deny('source_verification_required');
  const sourceId=matches[0].source_id;
  const idempotency=sha(TENANT+':'+sourceId+':'+m.id+':'+m.at);
  if(refs.has(idempotency))return deny('memory_duplicate_denied');
  refs.add(idempotency);
  const title=m.kind==='confirmed_decision'?
   'Decisão confirmada — '+m.domain:'Histórico verificado — '+m.domain;
  rows.push({
   tenant_id:TENANT,source_id:sourceId,source_item_digest:idempotency,
   source_version:m.at,owner_user_id:principal.user_id,
   domain:m.domain,classification:'internal',visibility:'owner_only',
   company_id:null,store_id:null,title,content:m.text,
   expires_at:m.expires_at
  });
 }
 // This is a deterministic preview for a future transactional, verified
 // source/admission write port; no approved status and no SQL execute here.
 return {status:'prepared_uncommitted',reason:null,count:rows.length,rows};
}
module.exports={SCHEMA,TENANT,prepare,sourceFor,sourceDigest:source=>sha(TENANT+':source:'+source)};
