'use strict';
// Trusted-auth, RLS-enforced PostgreSQL retrieval port. The caller MUST use
// a verified JWT-backed "authenticated" database session. No service_role,
// no postgres role, no SET ROLE, no request.jwt.claim.sub spoofing, no writes.
const {withAuthenticatedTransaction}=require('./hermes-brain-authenticated-transaction');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tenantPattern=/^(grupo_erick|personal::[a-zA-Z0-9_-]{1,128}|client::[a-zA-Z0-9_-]{1,128})$/;
const SEARCH=`SELECT m.memory_id, m.title, m.content, m.domain,
 m.classification, m.visibility, m.source_version,
 m.updated_at, m.expires_at, s.provider, s.source_updated_at
 FROM hermes_brain.memory_items AS m
 INNER JOIN hermes_brain.sources AS s
 ON s.tenant_id=m.tenant_id AND s.source_id=m.source_id
 WHERE m.tenant_id=$1 AND
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
async function retrieve({pool,tenant_id,user_id,search,limit=5}={}){
 check({tenant_id,user_id,search,limit});
 return withAuthenticatedTransaction({pool,user_id,readOnly:true,work:async(client)=>{
  const result=await client.query(SEARCH,[tenant_id,search,limit]);
  if(!result||!Array.isArray(result.rows)||result.rows.length>limit)
   throw Error('brain_query_result_denied');
  const items=result.rows.map(r=>{
   if(!r||!uuid.test(r.memory_id)||typeof r.title!=='string'||
    typeof r.content!=='string'||typeof r.provider!=='string'||
    typeof r.domain!=='string'||typeof r.source_version!=='string')
    throw Error('brain_memory_result_invalid');
   return Object.freeze({...r});
  });
  return Object.freeze({tenant_id,items:Object.freeze(items),read_only:true});
 }});
}
module.exports={retrieve,SEARCH};
