'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createPersonalPrivateIngress,createSupabaseUserVerifier,
 MAX_BODY_BYTES,PATH,ORIGIN}=require('../src/runtime/hermes-brain-personal-private-ingress');
const owner='11111111-1111-4111-8111-111111111111';
const TOKEN=['a'.repeat(41),'b'.repeat(41),'c'.repeat(41)].join('.');
const body={provider:'chatgpt',conversations:[{conversation_id:'a',
 title:'PRIVATE_SENTINEL',mapping:{}}]};
const goodReceipt={status:'stored_personal_text_only',provider:'chatgpt',
 conversations_examined:1,text_messages:1,batches_committed:1,batches_planned:1,
 inserted:1,duplicates:0,omitted_nonuser_messages:0,
 omitted_nontext_parts:0,unsupported_text_messages:0,
 coverage:'supported_text_only',history_persisted:true,memory_written:false,
 corporate_visibility:false,requires_review:true};
function run(ingress,{value=body,headers={},method='POST',raw=null}={}){
 const data=raw??JSON.stringify(value);
 const req=Readable.from([Buffer.from(data)]);
 req.method=method;req.url=PATH;
 req.headers={origin:ORIGIN,'content-type':'application/json',
  'sec-fetch-site':'same-origin',authorization:'Bearer '+TOKEN,...headers};
 const result={code:null,headers:null,text:null};
 const res={headersSent:false,writableEnded:false,writeHead(code,h){
  this.headersSent=true;result.code=code;result.headers=h;
 },end(text){this.writableEnded=true;result.text=text}};
 return ingress.handle(req,res).then(()=>({...result,body:JSON.parse(result.text)}));
}
function fixture({enabled=true,valid=true,receipt=goodReceipt,throwStore=false}={}){
 const calls=[];
 const ingress=createPersonalPrivateIngress({enabled,
  verifyAccessToken:async token=>{
   calls.push(['auth',token===TOKEN]);
   if(!valid)throw Error('PRIVATE_AUTH_ERROR_SENTINEL');
   return {id:owner};
  },
  bindUserPool:async ({userId})=>{
   calls.push(['bind',userId]);
   return {pool:{connect:async()=>{}},close:async()=>{calls.push(['close'])}};
  },
  store:async args=>{
   calls.push(['store',args.user_id,args.provider,args.conversations.length]);
   if(throwStore)throw Error('PRIVATE_TEXT_LOG_SENTINEL');
   return receipt;
  }
 });return {ingress,calls};
}
test('disabled by default: no private endpoint, no request parsing or storage',async()=>{
 const ingress=createPersonalPrivateIngress();
 const r=await run(ingress);
 assert.equal(r.code,503);
 assert.deepEqual(r.body,{error:'personal_ingress_disabled'});
});
test('authenticated owner may ingest a bounded batch, response is metadata only',async()=>{
 const {ingress,calls}=fixture();
 const r=await run(ingress);
 assert.equal(r.code,200);
 assert.equal(r.body.status,'stored_personal_text_only');
 assert.equal(r.body.inserted,1);
 assert.equal(r.body.memory_written,false);
 assert.equal(r.body.corporate_visibility,false);
 assert.equal(r.headers['Cache-Control'],'no-store');
 assert.equal(calls.find(x=>x[0]==='bind')[1],owner);
 assert.deepEqual(calls.at(-1),['close']);
 assert(!r.text.includes('PRIVATE_SENTINEL'));
 assert(!r.text.includes(owner));
 assert(!r.text.includes(TOKEN));
});
test('invalid or missing JWT and Auth rejection never open a DB session',async()=>{
 for(const headers of [{authorization:''},{authorization:'Bearer invalid'},
  {authorization:'Basic '+TOKEN}]){
  const {ingress,calls}=fixture();
  const r=await run(ingress,{headers});
  assert.equal(r.code,401);assert.equal(calls.length,0);
 }
 const {ingress,calls}=fixture({valid:false});
 const r=await run(ingress);
 assert.equal(r.code,503);
 assert(!calls.some(x=>x[0]==='bind'));
 assert(!r.text.includes('SENTINEL'));
});
test('cross-origin, content type, method and caller ownership overrides are rejected',async()=>{
 for(const config of [
  {headers:{origin:'https://evil.example'}},
  {headers:{'content-type':'text/plain'}},
  {headers:{'sec-fetch-site':'cross-site'}},
  {method:'GET'},
  {value:{...body,owner_user_id:owner}},
  {value:{...body,tenant_id:'personal::'+owner}},
  {value:{...body,company_id:'grupo_erick'}},
  {value:{...body,grant_id:'caller_decides'}},
  {value:{...body,provider:'deepseek'}},
  {value:{provider:'chatgpt',conversations:[]}}
 ]){
  const {ingress,calls}=fixture();
  const r=await run(ingress,config);
  assert([400,403,405].includes(r.code));
  assert(!calls.some(x=>x[0]==='store'));
 }
});
test('large payload rejected before storage, and provider cannot be switched',async()=>{
 const {ingress,calls}=fixture();
 const big=JSON.stringify({provider:'chatgpt',
  conversations:[{conversation_id:'x',title:'x'.repeat(MAX_BODY_BYTES)}]});
 const r=await run(ingress,{raw:big,
  headers:{'content-length':String(Buffer.byteLength(big))}});
 assert.equal(r.code,413);
 assert(!calls.some(x=>x[0]==='bind'));
 const invalid=await run(ingress,{raw:'{invalid'});
 assert.equal(invalid.code,400);
});
test('database denial, bad receipts and closure remain fail-closed with no leaks',async()=>{
 for(const options of [{throwStore:true},{receipt:{...goodReceipt,inserted:9}}]){
  const {ingress,calls}=fixture(options);
  const r=await run(ingress);
  assert.equal(r.code,503);
  assert.deepEqual(r.body,{error:'personal_ingress_unavailable'});
  assert(!r.text.includes('PRIVATE_'));
  assert.deepEqual(calls.at(-1),['close']);
 }
});
test('verifier asks the pinned Supabase Auth endpoint, not decoded JWT claims',async()=>{
 let target,options;
 const verify=createSupabaseUserVerifier({
  url:'https://asceucchdnuoaqgdjbtg.supabase.co/',
  publishableKey:'sb_publishable_testfixture',
  fetchImpl:async (url,request)=>{
   target=String(url);options=request;
   return {status:200,json:async()=>({id:owner,aud:'authenticated'})};
  }
 });
 assert.deepEqual(await verify(TOKEN),{id:owner});
 assert.equal(target,'https://asceucchdnuoaqgdjbtg.supabase.co/auth/v1/user');
 assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
 assert.equal(options.redirect,'error');
 assert.throws(()=>createSupabaseUserVerifier({
  url:'https://evil.example/',publishableKey:'sb_publishable_testfixture'
 }),/invalid_auth_config/);
 const denied=createSupabaseUserVerifier({
  url:'https://asceucchdnuoaqgdjbtg.supabase.co/',
  publishableKey:'sb_publishable_testfixture',
  fetchImpl:async()=>({status:401})
 });
 await assert.rejects(denied(TOKEN),/private_archive_denied/);
});
