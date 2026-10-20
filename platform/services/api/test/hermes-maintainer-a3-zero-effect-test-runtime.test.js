'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHermesMaintainerMaestroMissionRunReader}=
 require('../src/runtime/hermes-maintainer-maestro-missionrun-reader');
const {createHermesMaintainerA3ZeroEffectTestRuntime,
 createHermesMaintainerA3ZeroEffectTestFromServerEnv}=
 require('../src/runtime/hermes-maintainer-a3-zero-effect-test-runtime');
const {createHermesMaintainerTestExecutionRuntimeComposition}=
 require('../src/runtime/hermes-maintainer-test-execution-runtime-composition');
const D='sha256:'+'a'.repeat(64),REPO='instutodp-cpu/agente-grupo-erick';
const query=Object.freeze({
 environment:'staging',mission_id:'official-new-a3-test',
 run_id:'official-new-a3-run',repository:REPO,operation:'update_file'
});
const enabled=Object.freeze({
 HERMES_DEPLOYMENT_STAGE:'staging',
 HERMES_A3_ZERO_EFFECT_TEST_ENABLED:'true',
 HERMES_EXECUTION_ENABLED:'false',
 HERMES_EXECUTION_KILL_SWITCH:'true',
 HERMES_MISSION_INGRESS_ENABLED:'false'
});
function run(override={},contractOverride={}){
 const contract={contract_version:'1.0',mission_id:query.mission_id,
  workspace_id:'official-workspace',idempotency_key:'official-fresh-dispatch-key',
  objective:'Test official code preparation without external effects',
  requested_by:{tipo:'usuario',id:'official-creator'},
  metadata:{tipo:'testar',emitted_by:'official-creator',
   issued_at:'2026-10-20T12:00:00.000Z'},
  allowed_tools:['github_api'],denied_actions:['merge','publish','production'],
  approval_policy:'requer_aprovacao',callback:null,...contractOverride};
 return {id:query.run_id,mission_id:query.mission_id,espaco_id:'official-workspace',
  status:'na_fila',dispatch_simulado:true,
  dispatch_token:'official-queued-dispatch-token',
  idempotency_key:contract.idempotency_key,emitted_by:'official-dispatcher',
  issued_at:'2026-10-20T12:00:20.000Z',
  contract_hash:D,contrato_json:JSON.stringify(contract),...override};
}
function readerWith(overrides={}){
 const calls=[];
 const invokeMissionGateway=async input=>{
  calls.push(input.operation);
  if(input.operation==='list_runs')return {runs:overrides.runs??[run()]};
  if(input.operation==='verify_integrity')
   return overrides.integrity??{ok:true,expected:D,actual:D};
  throw Error('unexpected operation: '+input.operation);
 };
 return {...createHermesMaintainerMaestroMissionRunReader({invokeMissionGateway}),calls};
}
const passed=()=>({status:'MAINTAINER_TEST_EXECUTION_PASSED',
 executed:true,passed:true,test_id:'hermes_core_smoke',receipt:'test_process_passed',
 network_authorized:false,secrets_authorized:false,write_authorized:false,
 production_allowed:false,merge_authority:false,human_merge_required:true});
test('official queued simulation is identified with integrity but WITHOUT any signed attestation',async()=>{
 const r=readerWith(),candidate=await r.readSimulatedRunCandidate(query);
 assert.equal(candidate.source,'MAESTRO_MISSION_GATEWAY_OFFICIAL_QUEUE_CANDIDATE');
 assert.equal(candidate.mission_run_id,query.run_id);
 assert.equal(candidate.workspace_id,'official-workspace');
 assert.equal(candidate.test_id,'hermes_core_smoke');
 assert.equal(candidate.outbox_acknowledged,false);
 assert.equal(candidate.receipt_durable,false);
 assert.equal(candidate.simulation_observed,false);
 assert.equal(candidate.issuer_verified,false);
 assert.equal(candidate.approval_verified,false);
 assert.equal(candidate.execution_authorized,false);
 assert.deepEqual(r.calls,['list_runs','verify_integrity']);
});
test('outdated public-web and ambiguous/incomplete/forged run never enter A3 subprocess',async()=>{
 const invalid=[
  {runs:[]},{runs:[run(),run()]},
  {runs:[run({status:'concluida'})]},
  {runs:[run({status:'despachando'})]},
  {runs:[run({dispatch_simulado:false})]},
  {runs:[run({dispatch_token:null})]},
  {runs:[run({mission_id:'historical-web'})]},
  {runs:[run({id:'historical-canary'})]},
  {runs:[run({issued_at:'2026-10-20T11:59:00.000Z'})]},
  {runs:[run({issued_at:'2026-10-20T12:05:02.000Z'})]},
  {runs:[run({contract_hash:'invalid'})]},
  {runs:[run({emitted_by:null})]},
  {runs:[run({}, {metadata:{tipo:'pesquisar',emitted_by:'official-creator',
    issued_at:'2026-10-20T12:00:00.000Z'},allowed_tools:['public_web_read']})]},
  {runs:[run({}, {allowed_tools:['github_api','public_web_read']})]},
  {runs:[run({}, {denied_actions:['merge','publish']})]},
  {runs:[run({}, {metadata:{tipo:'desenvolver',emitted_by:'official-creator',
    issued_at:'2026-10-20T12:00:00.000Z'}})]},
  {integrity:{ok:false,expected:D,actual:D}},
  {integrity:{ok:true,expected:'sha256:'+'b'.repeat(64),actual:D}}
 ];
 for(const changes of invalid){
  const r=readerWith(changes);
  assert.equal(await r.readSimulatedRunCandidate(query),null,JSON.stringify(changes).slice(0,250));
 }
 let invoked=0;
 const r=createHermesMaintainerMaestroMissionRunReader({
  invokeMissionGateway:async()=>{invoked++;return{runs:[]}}});
 for(const bad of [
  {...query,environment:'production'},{...query,repository:'other/repo'},
  {...query,run_id:'old-run',token:'injected'},{...query,operation:'delete'},
  {...query,mission_id:''}
 ])assert.equal(await r.readSimulatedRunCandidate(bad),null);
 assert.equal(invoked,0);
});
test('A3 official subprocess observation is default disabled without ANY gateway/test call',async()=>{
 let read=0,executed=0;
 for(const env of [{},
  {...enabled,HERMES_A3_ZERO_EFFECT_TEST_ENABLED:'false'},
  {...enabled,HERMES_EXECUTION_ENABLED:'true'},
  {...enabled,HERMES_EXECUTION_KILL_SWITCH:'false'},
  {...enabled,HERMES_MISSION_INGRESS_ENABLED:'true'},
  {...enabled,HERMES_DEPLOYMENT_STAGE:'production'}
 ]){
  const observer=createHermesMaintainerA3ZeroEffectTestRuntime({
   readSimulatedRunCandidate:async()=>{read++;return null},
   executeTrustedTest:async()=>{executed++;return passed()},environment:env});
  const result=await observer.observe(query);
  assert.equal(result.simulation_observed,false);
  assert.equal(result.execution_authorized,false);
 }
 assert.equal(read,0);assert.equal(executed,0);
});
test('unverified reader, attacker payload and failed subprocess deny with zero authorizations',async()=>{
 let tests=0;
 const trusted=readerWith();
 const observer=createHermesMaintainerA3ZeroEffectTestRuntime({
  readSimulatedRunCandidate:trusted.readSimulatedRunCandidate,
  executeTrustedTest:async()=>{tests++;return {...passed(),passed:false,
   status:'MAINTAINER_TEST_EXECUTION_FAILED'}},
  environment:enabled});
 assert.equal((await observer.observe({...query,arbitrary:'yes'})).simulation_observed,false);
 assert.equal(tests,0);
 const failed=await observer.observe(query);
 assert.equal(failed.status,'A3_OFFICIAL_TEST_OBSERVATION_BLOCKED');
 assert.equal(failed.receipt_durable,false);assert.equal(tests,1);
 const falseClaim=createHermesMaintainerA3ZeroEffectTestRuntime({
  readSimulatedRunCandidate:async()=>({
   source:'MAESTRO_MISSION_GATEWAY_OFFICIAL_QUEUE_CANDIDATE',
   mission_id:query.mission_id,mission_run_id:query.run_id,
   workspace_id:'official-workspace',contract_hash:D,
   test_id:'hermes_core_smoke',verified_contract_integrity:true,
   simulated_run_queued:true,outbox_acknowledged:true,
   simulation_observed:false,receipt_durable:false,
   issuer_verified:false,approval_verified:false,
   execution_authorized:false,production_allowed:false,merge_authority:false
  }),
  executeTrustedTest:async()=>{tests++;return passed()},environment:enabled
 });
 assert.equal((await falseClaim.observe(query)).simulation_observed,false);
 assert.equal(tests,1,'forged ACK never launches a test');
});
test('subprocess exit observed but never promoted to independent A3 issuer evidence',async()=>{
 const reader=readerWith();
 let ran=0;
 const observer=createHermesMaintainerA3ZeroEffectTestRuntime({
  readSimulatedRunCandidate:reader.readSimulatedRunCandidate,
  executeTrustedTest:async()=>{ran++;return passed()},environment:enabled});
 const result=await observer.observe(query);
 assert.equal(ran,1);assert.equal(result.simulation_observed,true);
 assert.equal(result.test_process_passed,true);
 assert.equal(result.status,'A3_OFFICIAL_TEST_PROCESS_OBSERVED_NOT_ATTESTED');
 assert.equal(result.reason,'INDEPENDENT_ZERO_EFFECT_RECEIPT_NOT_YET_AVAILABLE');
 for(const k of ['receipt_durable','issuer_verified','approval_verified',
  'outbox_acknowledged','execution_authorized','production_allowed','merge_authority'])
  assert.equal(result[k],false,k);
 for(const k of ['network_call_performed','scm_write_performed'])
  assert.equal(result[k],null,'no independent effects witness: '+k);
});
test('real existing allowlisted Node smoke subprocess can execute as a TEST, not an A3 receipt',async()=>{
 const runtime=createHermesMaintainerTestExecutionRuntimeComposition({timeoutMs:30000});
 const result=await runtime.execute();
 assert.equal(result.test_id,'hermes_core_smoke');
 assert.equal(result.executed,true);
 assert.equal(result.status,'MAINTAINER_TEST_EXECUTION_PASSED');
 assert.equal(result.passed,true);
 assert.equal(result.network_authorized,false);
 assert.equal(result.write_authorized,false);
 assert.equal(result.production_allowed,false);
});
test('server-only entry has no external access or process execution without configured gateway',async()=>{
 let network=0,spawned=0;
 const runtime=createHermesMaintainerA3ZeroEffectTestFromServerEnv({
  environment:enabled,
  fetchImpl:async()=>{network++;throw Error('unexpected')},
  spawnImpl:()=>{spawned++;throw Error('unexpected')}
 });
 assert.equal(runtime.configured,false);
 const output=await runtime.observe(query);
 assert.equal(output.simulation_observed,false);
 assert.equal(output.receipt_durable,false);
 assert.equal(spawned,0);assert.equal(network,0);
});
