'use strict';
// Only a verified Supabase Auth user ID may reach this binder. The underlying
// PostgreSQL connection never runs user data access as a privileged identity.
// SET LOCAL is transaction-scoped; a connection is destroyed if a transaction
// is not cleanly completed. No JWTs or database credentials are logged.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function denied(){throw Error('personal_db_principal_denied')}
function createPersonalJwtBoundPgBinder({pgPool}={}){
 if(!pgPool||typeof pgPool.connect!=='function')denied();
 return async function bindUserPool({userId}={}){
  if(!UUID.test(userId||''))denied();
  let open=true,leased=false;
  return Object.freeze({
   pool:Object.freeze({async connect(){
    if(!open||leased)denied();
    leased=true;
    let actual;
    try{actual=await pgPool.connect()}
    catch{leased=false;denied()}
    if(!actual||typeof actual.query!=='function'||typeof actual.release!=='function')
     denied();
    let state='new',released=false;
    return Object.freeze({
     async query(sql,params){
      if(released)denied();
      if(state==='new'){
       if(sql!=='BEGIN')denied();
       try{
        await actual.query('BEGIN');
        state='transaction';
        await actual.query('SET LOCAL ROLE authenticated');
        await actual.query("SELECT pg_catalog.set_config('request.jwt.claim.sub',$1,true)",[userId]);
        const result=await actual.query(
         'SELECT current_user AS db_role,(SELECT auth.uid())::text AS user_id');
        if(result?.rows?.length!==1||
           result.rows[0].db_role!=='authenticated'||
           result.rows[0].user_id!==userId)denied();
        return {rows:[]};
       }catch{
        if(state==='transaction')try{await actual.query('ROLLBACK')}catch{}
        state='failed';
        denied();
       }
      }
      if(state!=='transaction')denied();
      if(sql==='BEGIN'||sql==='BEGIN READ ONLY')denied();
      // All content SQL is still executed by the pre-existing, reviewed
      // transactional archive module, now as the authenticated DB role.
      if(sql==='COMMIT'||sql==='ROLLBACK'){
       try{const result=await actual.query(sql,params);state='complete';return result}
       catch{state='failed';denied()}
      }
      return actual.query(sql,params);
     },
     release(){
      if(released)return;
      released=true;
      try{actual.release(state!=='complete')}
      finally{leased=false}
     }
    });
   }}),
   async close(){open=false}
  });
 };
}
module.exports={createPersonalJwtBoundPgBinder};
