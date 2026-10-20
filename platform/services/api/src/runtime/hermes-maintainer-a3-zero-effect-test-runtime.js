'use strict';

// Narrow existing-test-executor bridge for an OFFICIAL queued Maestro A3
// MissionRun. This intentionally produces NO signed/durable A3 receipt;
// a successful subprocess exit is not independent zero-effect attestation.
// No HTTP handler or external provider transport is installed here.
const {createHermesMaintainerMaestroInvokerFromServerEnv}=
 require('./hermes-maintainer-maestro-authenticated-invoker');
const {createHermesMaintainerMaestroMissionRunReader}=
 require('./hermes-maintainer-maestro-missionrun-reader');
const {createHermesMaintainerTestExecutionRuntimeComposition}=
 require('./hermes-maintainer-test-execution-runtime-composition');
const VERSION='hermes_maintainer_a3_official_test_process_observation_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const ID=/^[^\x00-\x20\x7f]{1,255}$/;
const FIELDS=['environment','mission_id','operation','repository','run_id'];
function blocked(reason){
 return Object.freeze({version:VERSION,status:'A3_OFFICIAL_TEST_OBSERVATION_BLOCKED',
  reason,simulation_observed:false,test_process_passed:false,
  receipt_durable:false,issuer_verified:false,approval_verified:false,
  outbox_acknowledged:false,execution_authorized:false,
  network_call_performed:false,scm_write_performed:false,
  production_allowed:false,merge_authority:false});
}
function createHermesMaintainerA3ZeroEffectTestRuntime({
 readSimulatedRunCandidate,executeTrustedTest,environment=process.env
}={}){
 if(typeof readSimulatedRunCandidate!=='function')
  throw new TypeError('authenticated_maestro_simulation_reader_required');
 if(typeof executeTrustedTest!=='function')
  throw new TypeError('existing_trusted_test_runner_required');
 return Object.freeze({version:VERSION,async observe(query){
  // The observed runtime profile MUST NOT be able to dispatch operational
  // missions, enable provider execution or bypass the safety kill switch.
  if(environment?.HERMES_DEPLOYMENT_STAGE!=='staging'||
     environment?.HERMES_A3_ZERO_EFFECT_TEST_ENABLED!=='true'||
     environment?.HERMES_EXECUTION_ENABLED!=='false'||
     environment?.HERMES_EXECUTION_KILL_SWITCH!=='true'||
     environment?.HERMES_MISSION_INGRESS_ENABLED!=='false')
    return blocked('A3_TEST_ONLY_STAGING_GATES_DISABLED');
  if(!query||typeof query!=='object'||Array.isArray(query)||
     Object.keys(query).sort().join('|')!==[...FIELDS].sort().join('|')||
     query.environment!=='staging'||query.repository!==REPOSITORY||
     !['update_file','create_pull_request'].includes(query.operation)||
     !ID.test(query.mission_id||'')||!ID.test(query.run_id||''))
    return blocked('A3_TEST_OBSERVATION_SCOPE_INVALID');
  let candidate;
  try{candidate=await readSimulatedRunCandidate(Object.freeze({...query}));}
  catch{return blocked('A3_OFFICIAL_MISSION_READER_UNAVAILABLE');}
  if(!candidate||candidate.source!=='MAESTRO_MISSION_GATEWAY_OFFICIAL_QUEUE_CANDIDATE'||
     candidate.mission_id!==query.mission_id||
     candidate.mission_run_id!==query.run_id||
     !ID.test(candidate.workspace_id||'')||
     !/^sha256:[0-9a-f]{64}$/.test(candidate.contract_hash||'')||
     candidate.test_id!=='hermes_core_smoke'||
     candidate.verified_contract_integrity!==true||
     candidate.simulated_run_queued!==true||
     candidate.outbox_acknowledged!==false||
     candidate.simulation_observed!==false||
     candidate.receipt_durable!==false||
     candidate.issuer_verified!==false||
     candidate.approval_verified!==false||
     candidate.execution_authorized!==false||
     candidate.production_allowed!==false||
     candidate.merge_authority!==false)
    return blocked('A3_OFFICIAL_SIMULATION_CANDIDATE_UNVERIFIED');
  let observed;
  try{observed=await executeTrustedTest();}
  catch{return blocked('A3_TRUSTED_TEST_EXECUTOR_UNAVAILABLE');}
  if(!observed||observed.executed!==true||
     observed.status!=='MAINTAINER_TEST_EXECUTION_PASSED'||
     observed.passed!==true||observed.test_id!=='hermes_core_smoke'||
     observed.receipt!=='test_process_passed'||
     observed.network_authorized!==false||
     observed.secrets_authorized!==false||
     observed.write_authorized!==false||
     observed.production_allowed!==false||
     observed.merge_authority!==false||
     observed.human_merge_required!==true)
    return blocked('A3_TRUSTED_TEST_PROCESS_NOT_VERIFIED_PASSED');
  // THIS IS ONLY PROCESS OBSERVATION. It neither ACKs the official outbox
  // nor proves network/effects isolation, persists a receipt or signs an A3
  // provenance record. Downstream approval/admission MUST still fail closed.
  return Object.freeze({
   ...blocked('INDEPENDENT_ZERO_EFFECT_RECEIPT_NOT_YET_AVAILABLE'),
   status:'A3_OFFICIAL_TEST_PROCESS_OBSERVED_NOT_ATTESTED',
   mission_run_id:candidate.mission_run_id,
   mission_id:candidate.mission_id,workspace_id:candidate.workspace_id,
   contract_hash:candidate.contract_hash,test_id:'hermes_core_smoke',
   simulation_observed:true,test_process_passed:true
  });
 }});
}
function createHermesMaintainerA3ZeroEffectTestFromServerEnv({
 environment=process.env,fetchImpl=globalThis.fetch,spawnImpl,timeoutMs
}={}){
 const transport=createHermesMaintainerMaestroInvokerFromServerEnv({
  env:environment,fetchImpl});
 const reader=createHermesMaintainerMaestroMissionRunReader({
  invokeMissionGateway:transport.configured?
    transport.invokeMissionGateway:async()=>null
 });
 const testRuntime=createHermesMaintainerTestExecutionRuntimeComposition({
  spawnImpl,timeoutMs});
 const observer=createHermesMaintainerA3ZeroEffectTestRuntime({
  readSimulatedRunCandidate:reader.readSimulatedRunCandidate,
  executeTrustedTest:()=>testRuntime.execute(),environment
 });
 return Object.freeze({
  version:VERSION,
  configured:transport.configured&&
   environment?.HERMES_A3_ZERO_EFFECT_TEST_ENABLED==='true'&&
   environment?.HERMES_EXECUTION_ENABLED==='false'&&
   environment?.HERMES_EXECUTION_KILL_SWITCH==='true'&&
   environment?.HERMES_MISSION_INGRESS_ENABLED==='false',
  observe:observer.observe
 });
}
module.exports={VERSION,createHermesMaintainerA3ZeroEffectTestRuntime,
 createHermesMaintainerA3ZeroEffectTestFromServerEnv};
