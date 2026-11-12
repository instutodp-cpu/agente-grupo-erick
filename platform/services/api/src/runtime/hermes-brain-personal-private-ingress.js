'use strict';
// Private, explicitly gated staging ingress for normalized batches of official
// ChatGPT/Claude JSON. No ZIP extraction, secrets, text logs or corporate path.
// JWT authenticity comes from Supabase Auth, never from request body/AI claims.
// Persistence still REQUIRES a DB pool pinned to this principal: its existing
// withAuthenticatedTransaction gate rechecks current_user and auth.uid().
const {storePlannedPersonalArchive}=require('./hermes-brain-personal-archive-batch-plan');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES=2*1024*1024;
const PATH='/internal/personal-archive/batch';
const ORIGIN='https://hermes-staging.grupoerick.tech';
const PROVIDERS=new Set(['chatgpt','claude']);
function fail(code){const e=Error('private_archive_denied');e.status=code;throw e;}
function reply(res,code,value){
 if(res.headersSent||res.writableEnded)return;
 const raw=JSON.stringify(value);
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff',
  'Content-Length':Buffer.byteLength(raw)});
 res.end(raw);
}
async function readLimitedJson(req){
 const declared=Number(req.headers['content-length']);
 if(req.headers['content-length']!==undefined&&
   (!Number.isSafeInteger(declared)||declared<0||declared>MAX_BODY_BYTES))fail(413);
 let size=0;
 const chunks=[];
 for await(const chunk of req){
  size+=chunk.length;
  if(size>MAX_BODY_BYTES)fail(413);
  chunks.push(chunk);
 }
 if(size===0)fail(400);
 try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'))}
 catch{fail(400)}
}
function authorizedReceipt(provider,r){
 if(!r||r.status!=='stored_personal_text_only'||r.provider!==provider||
  r.memory_written!==false||r.corporate_visibility!==false||
  r.history_persisted!==true)return null;
 const keys=['conversations_examined','text_messages','batches_committed',
  'batches_planned','inserted','duplicates','omitted_nonuser_messages',
  'omitted_nontext_parts','unsupported_text_messages'];
 if(keys.some(k=>!Number.isSafeInteger(r[k])||r[k]<0))return null;
 if(r.inserted+r.duplicates!==r.text_messages||
  r.batches_committed!==r.batches_planned)return null;
 return {status:'stored_personal_text_only',provider,
  ...Object.fromEntries(keys.map(k=>[k,r[k]])),
  coverage:['partial_text_only','supported_text_only'].includes(r.coverage)?
   r.coverage:'unverified',
  history_persisted:true,memory_written:false,corporate_visibility:false,
  requires_review:true};
}
// Verify a JWT against the actual Supabase Auth server, not decoded claims.
// The project URL and publishable key must be supplied by trusted config;
// the key is public, but service_role/secret keys MUST never be supplied.
function createSupabaseUserVerifier({url,publishableKey,fetchImpl=fetch}={}){
 let origin;
 try{origin=new URL(url)}
 catch{throw Error('private_archive_invalid_auth_config')}
 if(origin.protocol!=='https:'||
   origin.hostname!=='asceucchdnuoaqgdjbtg.supabase.co'||
   origin.pathname!=='/'||origin.search||origin.hash||
   typeof publishableKey!=='string'||
   !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(publishableKey)||
   typeof fetchImpl!=='function')
  throw Error('private_archive_invalid_auth_config');
 return async token=>{
  let response;
  try{response=await fetchImpl(origin+'auth/v1/user',{
   method:'GET',redirect:'error',cache:'no-store',
   headers:{Authorization:'Bearer '+token,apikey:publishableKey,Accept:'application/json'},
   signal:AbortSignal.timeout(6000)
  })}
  catch{fail(401)}
  if(!response||response.status!==200)fail(401);
  let user;
  try{user=await response.json()}catch{fail(401)}
  if(!user||!UUID.test(user.id)||user.aud!=='authenticated')fail(401);
  return {id:user.id};
 };
}
// Trust boundary: bindUserPool must return a request-scoped DB pool under the
// validated user, NOT a bare privileged pool. Each import transaction checks
// DB current_user='authenticated' and auth.uid()=user_id (fail closed).
function createPersonalPrivateIngress({verifyAccessToken,bindUserPool,
 store=storePlannedPersonalArchive,enabled=false,origin=ORIGIN}={}){
 if(enabled&&(typeof verifyAccessToken!=='function'||
   typeof bindUserPool!=='function'||typeof store!=='function'))
  throw Error('private_archive_missing_security_dependencies');
 return Object.freeze({enabled:()=>enabled===true,async handle(req,res){
  if(!enabled)return reply(res,503,{error:'personal_ingress_disabled'});
  let bound;
  try{
   if(req.url!==PATH||req.method!=='POST')fail(405);
   if(req.headers.origin!==origin||
     !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
       req.headers['content-type']||'')||
     !['same-origin','none',undefined].includes(req.headers['sec-fetch-site']))
    fail(403);
   const match=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
     req.headers.authorization||'');
   if(!match||match[1].length<100||match[1].length>8192)fail(401);
   const user=await verifyAccessToken(match[1]);
   if(!user||!UUID.test(user.id))fail(401);
   // Authenticate BEFORE decoding payload. Never accept owner_user_id,
   // tenant_id, company_id, grant_id or workspace routing from request JSON.
   const payload=await readLimitedJson(req);
   if(!payload||Array.isArray(payload)||typeof payload!=='object'||
     Object.keys(payload).length!==2||
     !Object.hasOwn(payload,'provider')||
     !Object.hasOwn(payload,'conversations')||
     !PROVIDERS.has(payload.provider)||
     !Array.isArray(payload.conversations)||payload.conversations.length<1)
    fail(400);
   bound=await bindUserPool({userId:user.id});
   if(!bound||typeof bound.pool?.connect!=='function'||
      typeof bound.close!=='function')fail(503);
   const receipt=await store({
    pool:bound.pool,user_id:user.id,provider:payload.provider,
    conversations:payload.conversations
   });
   const safe=authorizedReceipt(payload.provider,receipt);
   if(!safe)fail(503);
   return reply(res,200,safe);
  }catch(error){
   const code=[400,401,403,405,413].includes(error?.status)?
     error.status:503;
   return reply(res,code,{error:code===413?'request_too_large':
     code===401?'unauthorized':code===403?'forbidden':
     code===405?'method_not_allowed':code===400?'invalid_batch':
     'personal_ingress_unavailable'});
  }finally{
   if(bound)try{await bound.close()}catch{}
  }
 }});
}
module.exports={createPersonalPrivateIngress,createSupabaseUserVerifier,
 MAX_BODY_BYTES,PATH,ORIGIN};
