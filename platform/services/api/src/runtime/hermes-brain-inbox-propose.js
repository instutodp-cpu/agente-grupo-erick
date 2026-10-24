'use strict';
// The inbox is not memory, an approval, or authorization to execute.
// JWT authenticated session is established by a separate trusted ingress.
const {withAuthenticatedTransaction}=require('./hermes-brain-authenticated-transaction');
const tenant=/^(grupo_erick|personal::[a-zA-Z0-9_-]{1,128}|client::[a-zA-Z0-9_-]{1,128})$/;
const code=/^[a-z][a-z0-9_]{0,63}$/;
const ref=/^[a-zA-Z0-9._:/-]{1,160}$/;
const scope=/^[a-zA-Z0-9_-]{1,128}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const types=new Set(['user_note','document_summary','meeting_summary','project_context','external_source_summary']);
const classes=new Set(['internal','confidential']);
const sql=`INSERT INTO hermes_brain.inbox_candidates
 (tenant_id,actor_user_id,source_type,source_ref,source_version,
 title,body,domain,classification,company_id,store_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
 RETURNING proposal_id, tenant_id, status, submitted_at`;
function validText(value,min,max){
 return typeof value==='string'&&value.length>=min&&value.length<=max&&
  !/[\u0000-\u0008\u000b-\u001f]/.test(value);
}
async function propose({pool,tenant_id,user_id,source_type='user_note',
 source_ref,source_version='v1',title,body,domain,classification='internal',
 company_id=null,store_id=null}={}){
 if(!tenant.test(tenant_id)||!uuid.test(user_id)||
  !types.has(source_type)||!ref.test(source_ref)||
  !validText(source_version,1,80)||!validText(title,1,160)||
  !validText(body,1,4000)||!code.test(domain)||!classes.has(classification)||
  (company_id!==null&&!scope.test(company_id))||
  (store_id!==null&&!scope.test(store_id)))
  throw Error('brain_inbox_proposal_contract_denied');
 const args=[tenant_id,user_id,source_type,source_ref,source_version,
  title,body,domain,classification,company_id,store_id];
 return withAuthenticatedTransaction({pool,user_id,readOnly:false,work:async(client)=>{
  const response=await client.query(sql,args);
  const row=response?.rows?.[0];
  if(response?.rows?.length!==1||!uuid.test(row?.proposal_id)||
   row.tenant_id!==tenant_id||row.status!=='pending')
    throw Error('brain_inbox_proposal_result_denied');
  return Object.freeze({proposal_id:row.proposal_id,tenant_id,status:'pending',
   approved:false,executed:false,submitted_at:row.submitted_at});
 }});
}
module.exports={propose,SQL:sql};
