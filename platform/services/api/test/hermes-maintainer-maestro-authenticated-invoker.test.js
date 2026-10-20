'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validRequest,validGatewayUrl,createHermesMaintainerMaestroAuthenticatedInvoker,
 createHermesMaintainerMaestroInvokerFromServerEnv}=require('../src/runtime/hermes-maintainer-maestro-authenticated-invoker');
const URL='https://maestro-svc.example.org/functions/missionGateway';
const TOKEN='synthetic-staging-identity-token-placeholder';
const D='sha256:'+'a'.repeat(64);
const proof={operation:'verify_a3_provenance',run_id:'run-1',mission_id:'mission-1',
 a3_operation:'update_file',repository:'instutodp-cpu/agente-grupo-erick',environment:'staging',
 target_digest:D,intent_digest:D,approval_reference:'approval-1',authorization_reference:'grant-1',
 single_use_authorization_id:'single-1'};
const json=(data,status=200)=>({ok:status===200,status,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(data)});
test('missing staging config never performs a network call',async()=>{
 for(const opt of [{},{environment:'production',gatewayUrl:URL,accessToken:TOKEN},
  {environment:'staging',gatewayUrl:'http://127.0.0.1/functions/missionGateway',accessToken:TOKEN},
  {environment:'staging',gatewayUrl:URL,accessToken:'short'}]){
  let calls=0;
  const x=createHermesMaintainerMaestroAuthenticatedInvoker({...opt,fetchImpl:async()=>{calls++;return json({runs:[]});}});
  assert.equal(x.configured,false);assert.equal(await x.invokeMissionGateway({operation:'list_runs',mission_id:'m-1'}),null);
  assert.equal(calls,0);
 }
});
test('reject unsafe URL with credentials, query, fragment, or alternative function',()=>{
 for(const url of ['http://maestro.example.org/functions/missionGateway',
  'https://user:pass@maestro.example.org/functions/missionGateway',URL+'?token=x',URL+'#x',
  URL.replace('missionGateway','arbitrary')])assert.equal(validGatewayUrl(url),false,url);
 assert.equal(validGatewayUrl(URL),true);
});
test('strict operation allowlist and exact body fields',async()=>{
 for(const input of [{operation:'dispatch'}, {...proof,environment:'production'},
  {...proof,repository:'other/repo'},{...proof,unknown:true},
  {operation:'list_runs',mission_id:'m-1',untrusted:1}])assert.equal(validRequest(input),false);
 assert.equal(validRequest(proof),true);
 assert.equal(validRequest({operation:'list_runs',mission_id:'m-1'}),true);
 assert.equal(validRequest({operation:'verify_integrity',run_id:'run-1'}),true);
 let calls=0;
 const x=createHermesMaintainerMaestroAuthenticatedInvoker({environment:'staging',gatewayUrl:URL,accessToken:TOKEN,
  fetchImpl:async()=>{calls++;return json({});}});
 assert.equal(await x.invokeMissionGateway({operation:'dispatch'}),null);assert.equal(calls,0);
});
test('authenticated POST with no cookie and fixed HTTPS endpoint',async()=>{
 const calls=[];
 const x=createHermesMaintainerMaestroAuthenticatedInvoker({environment:'staging',gatewayUrl:URL,accessToken:TOKEN,
  fetchImpl:async(url,init)=>{calls.push({url,init});return json({verified:false,error:'A3_SOURCE_ATTESTATION_NOT_CONFIGURED'});}});
 assert.equal(x.configured,true);
 assert.deepEqual(await x.invokeMissionGateway(proof),{verified:false,error:'A3_SOURCE_ATTESTATION_NOT_CONFIGURED'});
 assert.equal(calls.length,1);assert.equal(calls[0].url,URL);assert.equal(calls[0].init.method,'POST');
 assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.credentials,'omit');
 assert.equal(calls[0].init.headers.authorization,'Bearer '+TOKEN);
 assert.deepEqual(JSON.parse(calls[0].init.body),proof);
});
test('non-200, malformed JSON, oversized responses and failures always block',async()=>{
 const responses=[json({},401),json({verified:true},403),
  {...json({verified:true}),headers:{get:()=> 'text/html'}},
  {...json({verified:true}),text:async()=>'{broken'},
  {...json({verified:true}),text:async()=> 'x'.repeat(1048577)},
  {...json({verified:true}),headers:{get:k=>k==='content-length'?'1050000':'application/json'}},
  json([]),new Error('network failure')];
 for(const res of responses){
  const x=createHermesMaintainerMaestroAuthenticatedInvoker({environment:'staging',gatewayUrl:URL,accessToken:TOKEN,
   fetchImpl:async()=>{if(res instanceof Error)throw res;return res;}});
  assert.equal(await x.invokeMissionGateway(proof),null);
 }
});
test('only explicit server staging settings enable transport',async()=>{
 const env={HERMES_DEPLOYMENT_STAGE:'staging',MAESTRO_MISSION_GATEWAY_URL:URL,
  MAESTRO_MISSION_GATEWAY_ACCESS_TOKEN:TOKEN};
 const x=createHermesMaintainerMaestroInvokerFromServerEnv({env,fetchImpl:async()=>json({ok:true})});
 assert.equal(x.configured,true);
 assert.deepEqual(await x.invokeMissionGateway({operation:'verify_integrity',run_id:'run-1'}),{ok:true});
 assert.equal(createHermesMaintainerMaestroInvokerFromServerEnv({env:{...env,HERMES_DEPLOYMENT_STAGE:'production'}}).configured,false);
});
