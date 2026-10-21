'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {validRequest,validGatewayUrl,MAESTRO_APP_ID,GATEWAY_URL,GATEWAY_FUNCTIONS_VERSION,
 CLI_BIN,CLI_TAG,createHermesMaintainerMaestroCliReadInvoker,
 createHermesMaintainerMaestroProcessReadInvokerFromServerEnv,
 createHermesMaintainerMaestroAuthenticatedInvoker,
 createHermesMaintainerMaestroInvokerFromServerEnv}=require('../src/runtime/hermes-maintainer-maestro-authenticated-invoker');
const URL=GATEWAY_URL;
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
test('only the exact official Maestro app function endpoint may receive a user bearer',()=>{
 assert.equal(MAESTRO_APP_ID,'69f62cbb266971d4deeb4938');
 assert.equal(URL,'https://base44.app/api/apps/'+MAESTRO_APP_ID+'/functions/missionGateway');
 for(const url of [
  'http://base44.app/api/apps/'+MAESTRO_APP_ID+'/functions/missionGateway',
  'https://user:pass@base44.app/api/apps/'+MAESTRO_APP_ID+'/functions/missionGateway',
  'https://malicious.example.org/api/apps/'+MAESTRO_APP_ID+'/functions/missionGateway',
  'https://base44.app.evil.example/api/apps/'+MAESTRO_APP_ID+'/functions/missionGateway',
  'https://base44.app/functions/missionGateway',
  'https://base44.app/api/apps/other-app/functions/missionGateway',
  'https://base44.app/api/apps/'+MAESTRO_APP_ID+'/functions/dispatch',
  'https://base44.app:444/api/apps/'+MAESTRO_APP_ID+'/functions/missionGateway',
  URL+'?token=x',URL+'#x',URL+'?operation=dispatch'
 ])assert.equal(validGatewayUrl(url),false,url);
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
 assert.equal(GATEWAY_FUNCTIONS_VERSION,'preview');
 assert.equal(calls[0].init.headers['Base44-Functions-Version'],'preview');
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
test('external origin or wrong app ID never receives a configured bearer',async()=>{
 let calls=0;
 for(const bad of [
  'https://maestro-svc.example.org/functions/missionGateway',
  'https://base44.app/api/apps/other-app/functions/missionGateway',
  URL+'?external=1'
 ]){
  const x=createHermesMaintainerMaestroAuthenticatedInvoker({
   environment:'staging',gatewayUrl:bad,accessToken:TOKEN,
   fetchImpl:async()=>{calls++;return json({runs:[]});}
  });
  assert.equal(x.configured,false);
  assert.equal(await x.invokeMissionGateway({operation:'list_runs',mission_id:'m-1'}),null);
 }
 assert.equal(calls,0,'no bearer sent to an unpinned endpoint');
});
test('only explicit server staging settings enable transport',async()=>{
 const env={HERMES_DEPLOYMENT_STAGE:'staging',MAESTRO_MISSION_GATEWAY_URL:URL,
  MAESTRO_MISSION_GATEWAY_ACCESS_TOKEN:TOKEN};
 const x=createHermesMaintainerMaestroInvokerFromServerEnv({env,fetchImpl:async()=>json({ok:true})});
 assert.equal(x.configured,true);
 assert.deepEqual(await x.invokeMissionGateway({operation:'verify_integrity',run_id:'run-1'}),{ok:true});
 assert.equal(createHermesMaintainerMaestroInvokerFromServerEnv({env:{...env,HERMES_DEPLOYMENT_STAGE:'production'}}).configured,false);
});

const cliEnv={HERMES_DEPLOYMENT_STAGE:'staging',
 HERMES_A3_CLI_GATEWAY_READ_ENABLED:'true',
 HERMES_A3_ZERO_EFFECT_TEST_ENABLED:'true',
 HERMES_EXECUTION_ENABLED:'false',HERMES_EXECUTION_KILL_SWITCH:'true',
 HERMES_MISSION_INGRESS_ENABLED:'false'};
function fakeCli({payload={runs:[]},code=0,duplicate=false,tooLarge=false}={}){
 const calls=[];
 const spawnImpl=(bin,args,opts)=>{
  calls.push({bin,args,opts});
  const child=new EventEmitter();
  child.stdout=new EventEmitter();
  child.stdin={end:script=>{
   calls[calls.length-1].script=script;
   process.nextTick(()=>{
    child.stdout.emit('data',tooLarge?'X'.repeat(1048600):
     CLI_TAG+JSON.stringify(payload)+'\n'+
      (duplicate?CLI_TAG+JSON.stringify(payload)+'\n':''));
    child.emit('exit',code);
   });
  }};
  child.kill=()=>{};
  return child;
 };
 return {calls,spawnImpl};
}
test('CLI staging reader authenticates with official fixed binary, app and read-only scope',async()=>{
 const {calls,spawnImpl}=fakeCli({payload:{runs:[{id:'run-a'}]}});
 const reader=createHermesMaintainerMaestroCliReadInvoker({env:cliEnv,spawnImpl,timeoutMs:4000});
 assert.equal(reader.configured,true);
 assert.deepEqual(await reader.invokeMissionGateway({operation:'list_runs',mission_id:'mission-a'}),
  {runs:[{id:'run-a'}]});
 assert.equal(calls.length,1);
 assert.equal(calls[0].bin,CLI_BIN);
 assert.deepEqual(calls[0].args,['--app-id',MAESTRO_APP_ID,'exec']);
 assert.equal(calls[0].opts.shell,false);
 assert.deepEqual(Object.keys(calls[0].opts.env).sort(),
  ['BASE44_APP_ID','HOME','PATH']);
 assert.equal(calls[0].opts.env.HOME,'/home/hermesadmin');
 assert.match(calls[0].script,/missionGateway/);
 assert.doesNotMatch(calls[0].script,/dispatch.*idempotency_key/);
});
test('CLI source blocks writes, promotions and disabled/stale staging configuration',async()=>{
 const {calls,spawnImpl}=fakeCli();
 const good=createHermesMaintainerMaestroCliReadInvoker({env:cliEnv,spawnImpl});
 for(const req of [{operation:'dispatch',mission_id:'mission-a'},
  {operation:'list_outbox',workspace_id:'space'},
  proof,{operation:'list_runs',mission_id:'mission-a',excess:1}]){
  assert.equal(await good.invokeMissionGateway(req),null);
 }
 assert.equal(calls.length,0,'blocked operations never start CLI');
 for(const env of [
  {...cliEnv,HERMES_A3_CLI_GATEWAY_READ_ENABLED:'false'},
  {...cliEnv,HERMES_DEPLOYMENT_STAGE:'production'},
  {...cliEnv,HERMES_EXECUTION_ENABLED:'true'},
  {...cliEnv,HERMES_EXECUTION_KILL_SWITCH:'false'},
  {...cliEnv,HERMES_MISSION_INGRESS_ENABLED:'true'}
 ]){
  const x=createHermesMaintainerMaestroCliReadInvoker({env,spawnImpl});
  assert.equal(x.configured,false);
  assert.equal(await x.invokeMissionGateway({operation:'list_runs',mission_id:'m'}),null);
 }
 assert.equal(calls.length,0);
});
test('CLI errors, duplicate output and oversized responses never grant a candidate',async()=>{
 for(const config of [{code:1},{duplicate:true},{tooLarge:true}]){
  const fake=fakeCli(config);
  const reader=createHermesMaintainerMaestroCliReadInvoker({
   env:cliEnv,spawnImpl:fake.spawnImpl,timeoutMs:4000});
  assert.equal(await reader.invokeMissionGateway({operation:'verify_integrity',run_id:'r'}),null);
 }
});
test('explicit process-only adapter prefers the configured bearer, otherwise CLI',async()=>{
 const cli=fakeCli({payload:{runs:[]}});
 const usingCli=createHermesMaintainerMaestroProcessReadInvokerFromServerEnv({
  env:cliEnv,spawnImpl:cli.spawnImpl});
 assert.equal(usingCli.configured,true);
 assert.deepEqual(await usingCli.invokeMissionGateway({operation:'list_runs',mission_id:'m'}),{runs:[]});
 const usingBearer=createHermesMaintainerMaestroProcessReadInvokerFromServerEnv({
  env:{...cliEnv,MAESTRO_MISSION_GATEWAY_URL:URL,
   MAESTRO_MISSION_GATEWAY_ACCESS_TOKEN:TOKEN},
  spawnImpl:()=>{throw Error('CLI must not run when bearer configured')},
  fetchImpl:async()=>json({runs:[]})
 });
 assert.equal(usingBearer.configured,true);
 assert.deepEqual(await usingBearer.invokeMissionGateway({operation:'list_runs',mission_id:'m'}),{runs:[]});
});
