'use strict';
// Trusted-auth, RLS-enforced PostgreSQL retrieval port. The caller MUST use
// a verified JWT-backed "authenticated" database session. No service_role,
// no postgres role, no SET ROLE, no request.jwt.claim.sub spoofing, no writes.
const {withAuthenticatedTransaction}=require('./hermes-brain-authenticated-transaction');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tenantPattern=/^(grupo_erick|personal::[a-zA-Z0-9_-]{1,128}|client::[a-zA-Z0-9_-]{1,128})$/;
// Repeat the RLS trust predicates in SQL for defense in depth. If a future
// security policy changes, the read port must still never surface proposals,
// expired memories, revoked sources or rows belonging to a different tenant.
const SEARCH=`SELECT m.tenant_id,m.memory_id, m.title, m.content, m.domain,
 m.classification, m.visibility, m.source_version,
 m.status AS memory_status, s.status AS source_status,
 m.updated_at, m.expires_at, s.provider, s.source_updated_at
 FROM hermes_brain.memory_items AS m
 INNER JOIN hermes_brain.sources AS s
 ON s.tenant_id=m.tenant_id AND s.source_id=m.source_id
 WHERE m.tenant_id=$1 AND m.status='approved'
 AND m.expires_at>now() AND s.status='verified' AND
 to_tsvector('simple', m.title||' '||m.content) @@ plainto_tsquery('simple',$2)
 ORDER BY ts_rank(to_tsvector('simple',m.title||' '||m.content),
 plainto_tsquery('simple',$2)) DESC, m.updated_at DESC, m.memory_id
 LIMIT $3`;
function check({tenant_id,user_id,search,limit}){
 if(!tenantPattern.test(tenant_id)||!uuid.test(user_id)||
 typeof search!=='string'||search.length<2||search.length>160||
 /[\u0000-\u001f]/.test(search)||
 !Number.isSafeInteger(limit)||limit<1||limit>10)
 throw Error('brain_search_contract_denied');
}
const classify=new Set(['public','internal','confidential']);
const visibility=new Set(['owner_only','tenant_shared','scoped']);
function verifiedTime(value){
 const epoch=typeof value==='string'||value instanceof Date?
  Date.parse(value):NaN;
 return Number.isFinite(epoch)?epoch:null;
}
async function retrieve({pool,tenant_id,user_id,search,limit=5,
 clock=()=>Date.now()}={}){
 check({tenant_id,user_id,search,limit});
 if(typeof clock!=='function')throw Error('brain_search_clock_denied');
 return withAuthenticatedTransaction({pool,user_id,readOnly:true,work:async(client)=>{
  const result=await client.query(SEARCH,[tenant_id,search,limit]);
  if(!result||!Array.isArray(result.rows)||result.rows.length>limit)
   throw Error('brain_query_result_denied');
  const now=clock();
  if(!Number.isSafeInteger(now))throw Error('brain_search_clock_denied');
  const items=result.rows.map(r=>{
   if(!r||r.tenant_id!==tenant_id||r.memory_status!=='approved'||
    r.source_status!=='verified'||!uuid.test(r.memory_id)||
    typeof r.title!=='string'||r.title.length<1||r.title.length>240||
    typeof r.content!=='string'||r.content.length<1||r.content.length>20000||
    !classify.has(r.classification)||!visibility.has(r.visibility)||
    typeof r.provider!=='string'||!r.provider||
    typeof r.domain!=='string'||!r.domain||
    typeof r.source_version!=='string'||!r.source_version||
    verifiedTime(r.expires_at)===null||verifiedTime(r.expires_at)<=now||
    verifiedTime(r.source_updated_at)===null||
    verifiedTime(r.updated_at)===null)
    throw Error('brain_memory_result_invalid');
   return Object.freeze({...r});
  });
  return Object.freeze({tenant_id,items:Object.freeze(items),read_only:true});
 }});
}
module.exports={retrieve,SEARCH};
