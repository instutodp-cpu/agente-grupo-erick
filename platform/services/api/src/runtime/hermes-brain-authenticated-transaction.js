'use strict';
// The caller must supply a pool of sessions authenticated by an externally
// verified Supabase JWT. Never accept a role/claims object or token from LLM.
// One pinned DB connection per request: check and query must share a session.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function withAuthenticatedTransaction({pool,user_id,readOnly=true,work}={}){
 if(!UUID.test(user_id)||!pool||typeof pool.connect!=='function'||
  typeof work!=='function'||typeof readOnly!=='boolean')
  throw Error('brain_session_contract_denied');
 const client=await pool.connect();
 if(!client||typeof client.query!=='function'||typeof client.release!=='function')
  throw Error('brain_session_pin_denied');
 let active=false;
 try{
  await client.query(readOnly?'BEGIN READ ONLY':'BEGIN');
  active=true;
  const principal=await client.query(
   'SELECT (SELECT auth.uid())::text AS user_id, current_user AS db_role');
  if(principal?.rows?.length!==1||
   principal.rows[0].db_role!=='authenticated'||
   principal.rows[0].user_id!==user_id)
    throw Error('brain_verified_rls_principal_denied');
  const value=await work(client);
  await client.query('COMMIT');
  active=false;
  return value;
 }catch(error){
  if(active)try{await client.query('ROLLBACK')}catch{}
  throw error;
 }finally{client.release()}
}
module.exports={withAuthenticatedTransaction};
