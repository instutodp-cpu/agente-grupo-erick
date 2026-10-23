'use strict';
// Central memory publication adapter. Pure planning only, NEVER database writes.
// The caller MUST derive principal/membership/source attestations from an
// authenticated Supabase session, not Telegram IDs, prompts or LLM outputs.
const crypto=require('node:crypto');
const curator=require('./hermes-automemory-curator');
const {withAuthenticatedTransaction}=require('./hermes-brain-authenticated-transaction');
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

// Pinned SQL. The caller supplies a JWT-bound authenticated Postgres pool,
// never a role claim, Telegram ID, model output or service_role credential.
const MEMBERSHIP_SQL="SELECT tenant_id,user_id::text AS user_id,status,allowed_domains,allowed_classifications,allowed_visibilities FROM hermes_brain.memberships WHERE tenant_id=$1 AND user_id=(SELECT auth.uid()) AND status='active' LIMIT 2";
const SOURCES_SQL="SELECT tenant_id,source_id::text AS source_id,provider,reference_digest,status FROM hermes_brain.sources WHERE tenant_id=$1 AND status='verified' AND reference_digest=ANY($2::text[]) LIMIT 40";
// Column-scoped INSERT prevents authenticated sessions from overriding generated
// IDs/timestamps; a blanket table grant must NOT pass admission.
const PRIVILEGE_SQL="SELECT (SELECT bool_and(has_column_privilege(current_user,'hermes_brain.memory_items',col,'INSERT')) FROM unnest(ARRAY['tenant_id','source_id','source_item_digest','source_version','owner_user_id','domain','classification','visibility','company_id','store_id','title','content','expires_at','status']) AS c(col)) AND NOT has_column_privilege(current_user,'hermes_brain.memory_items','memory_id','INSERT') AS allowed";
const INSERT_SQL="INSERT INTO hermes_brain.memory_items (tenant_id,source_id,source_item_digest,source_version,owner_user_id,domain,classification,visibility,company_id,store_id,title,content,expires_at,status) SELECT $1,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,'approved' FROM hermes_brain.sources s WHERE s.tenant_id=$1 AND s.source_id=$2::uuid AND s.status='verified' AND s.reference_digest=$14 AND $13::timestamptz>now() ON CONFLICT (tenant_id,source_id,source_item_digest,source_version) DO NOTHING RETURNING memory_id";

async function publish({pool,user_id,store,now=Date.now()}={}){
 if(!ID.test(user_id||'')||!Number.isSafeInteger(now))
  throw Error('brain_publish_request_denied');
 curator.check(store,now);
 return withAuthenticatedTransaction({pool,user_id,readOnly:false,work:async client=>{
  const memberships=await client.query(MEMBERSHIP_SQL,[TENANT]);
  if(!Array.isArray(memberships?.rows)||memberships.rows.length!==1)
   return deny('authenticated_membership_required');
  const principal={tenant_id:TENANT,user_id,authenticated:true};
  const membership=memberships.rows[0];
  const initial=prepare({store,principal,membership,verifiedSources:[],now});
  if(initial.status==='blocked'&&initial.reason!=='source_verification_required')
   return initial;
  const items=curator.check(store,now).items.filter(x=>Date.parse(x.expires_at)>now);
  const digests=[...new Set(items.map(x=>sha(TENANT+':source:'+x.source)))];
  const sources=await client.query(SOURCES_SQL,[TENANT,digests]);
  if(!Array.isArray(sources?.rows)||sources.rows.length>40)
   throw Error('brain_source_catalog_invalid');
  const prepared=prepare({store,principal,membership,
   verifiedSources:sources.rows,now});
  if(prepared.status!=='prepared_uncommitted')return prepared;
  const grant=await client.query(PRIVILEGE_SQL);
  if(grant?.rows?.length!==1||grant.rows[0].allowed!==true)
   return deny('memory_write_role_denied');
  let inserted=0,duplicates=0;
  for(const r of prepared.rows){
   const source=sources.rows.find(x=>x.source_id===r.source_id);
   if(!source)throw Error('brain_source_identity_lost');
   const values=[r.tenant_id,r.source_id,r.source_item_digest,
    r.source_version,r.owner_user_id,r.domain,r.classification,
    r.visibility,r.company_id,r.store_id,r.title,r.content,
    r.expires_at,source.reference_digest];
   const receipt=await client.query(INSERT_SQL,values);
   if(!Array.isArray(receipt?.rows)||receipt.rows.length>1)
    throw Error('brain_write_receipt_invalid');
   if(receipt.rows.length){
    if(!ID.test(receipt.rows[0]?.memory_id||''))
     throw Error('brain_write_receipt_invalid');
    inserted++;
   }else duplicates++;
  }
  return {status:'committed',tenant_id:TENANT,count:prepared.count,inserted,duplicates};
 }});
}
module.exports={SCHEMA,TENANT,prepare,publish,MEMBERSHIP_SQL,SOURCES_SQL,PRIVILEGE_SQL,INSERT_SQL,sourceFor,sourceDigest:source=>sha(TENANT+':source:'+source)};
