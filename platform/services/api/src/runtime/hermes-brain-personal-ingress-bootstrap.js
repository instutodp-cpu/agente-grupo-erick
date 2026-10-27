'use strict';
// Opt-in ONLY after JWT/RLS and private-ingress gates. Inert in all existing
// deployments, including the published personal login page.
const {createPersonalPrivateIngress,createSupabaseUserVerifier}
 =require('./hermes-brain-personal-private-ingress');
const {createPersonalJwtBoundPgBinder}
 =require('./hermes-brain-personal-jwt-bound-pg');
function createPersonalArchiveIngressBootstrap({env=process.env,pgPool=null,
 fetchImpl=fetch}={}){
 if(env.HERMES_PERSONAL_INGRESS_ENABLED!=='true')
  return Object.freeze({ingress:null,async close(){}});
 if(env.HERMES_PERSONAL_ENVIRONMENT!=='staging')
  throw Error('personal_ingress_staging_only');
 const url=env.HERMES_PERSONAL_PG_URL;
 let parsed;
 try{parsed=new URL(url)}catch{throw Error('personal_ingress_db_configuration_denied')}
 const direct=parsed.hostname==='db.asceucchdnuoaqgdjbtg.supabase.co';
 const pooler=parsed.hostname.endsWith('.pooler.supabase.com')&&
  decodeURIComponent(parsed.username).endsWith('.asceucchdnuoaqgdjbtg');
 if(parsed.protocol!=='postgresql:'&&parsed.protocol!=='postgres:')
  throw Error('personal_ingress_db_configuration_denied');
 if(!direct&&!pooler||!parsed.password||parsed.search||parsed.hash)
  throw Error('personal_ingress_db_configuration_denied');
 const authUrl=env.HERMES_PERSONAL_SUPABASE_URL;
 const key=env.HERMES_PERSONAL_SUPABASE_PUBLISHABLE_KEY;
 const verifyAccessToken=createSupabaseUserVerifier({url:authUrl,
  publishableKey:key,fetchImpl});
 let pool=pgPool;
 if(!pool){
  const {Pool}=require('pg');
  pool=new Pool({connectionString:url,ssl:{rejectUnauthorized:true},
   max:2,idleTimeoutMillis:10000,connectionTimeoutMillis:6000,
   application_name:'hermes_personal_staging_private'});
 }
 const ingress=createPersonalPrivateIngress({
  enabled:true,verifyAccessToken,
  bindUserPool:createPersonalJwtBoundPgBinder({pgPool:pool})
 });
 return Object.freeze({ingress,async close(){if(typeof pool.end==='function')await pool.end()}});
}
module.exports={createPersonalArchiveIngressBootstrap};
