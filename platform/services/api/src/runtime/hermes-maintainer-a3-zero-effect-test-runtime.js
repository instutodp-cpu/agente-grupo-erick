'use strict';

// Narrow existing-test-executor bridge for an OFFICIAL queued Maestro A3
// MissionRun. This intentionally produces NO signed/durable A3 receipt;
// a successful subprocess exit is not independent zero-effect attestation.
// No HTTP handler or external provider transport is installed here.
const {createHermesMaintainerMaestroInvokerFromServerEnv}=
 require('./hermes-maintainer-maestro-authenticated-invoker');
const {createHermesMaintainerMaestroMissionRunReader}=
 require('./hermes-maintainer-maestro-missionrun-reader');
const {spawn,execFileSync}=require('node:child_process');
const path=require('node:path');
const {createHermesMaintainerTestExecutionBoundary}=
 require('../core/hermes-maintainer-test-execution-boundary');
const VERSION='hermes_maintainer_a3_official_test_process_observation_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const ID=/^[^\x00-\x20\x7f]{1,255}$/;
const FIELDS=['environment','mission_id','operation','repository','run_id'];
const SHA=/^[a-f0-9]{40}$/;
const IMAGE_ID=/^sha256:[a-f0-9]{64}$/;
const ROOT=path.resolve(__dirname,'../..');
const TEST_FILES=Object.freeze([
 'test/hermes-maintainer-e2e-workflow-contract.test.js',
 'test/hermes-maintainer-test-execution-boundary.test.js'
]);
// The sandbox is an offline, read-only and unprivileged LOCAL Docker process.
// Never accept command lines, image names, repo paths or Docker flags from
// MissionRun metadata, client requests or HTTP input.
function createHermesMaintainerA3NetworkIsolatedTestRunner({
 imageId,cwd=ROOT,spawnImpl=spawn,
 readRevision=()=>execFileSync('git',['-C',cwd,'rev-parse','HEAD'],
  {encoding:'utf8',timeout:4000,env:{PATH:'/usr/local/bin:/usr/bin:/bin'}}).trim(),
 timeoutMs=120000
}={}){
 if(cwd!==ROOT)throw new TypeError('fixed_a3_test_workspace_required');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)
  throw new TypeError('bounded_timeout_required');
 return async candidate=>{
  if(!IMAGE_ID.test(imageId||'')||!SHA.test(candidate?.revision_sha||''))
   return {test_id:'hermes_core_smoke',passed:false,receipt:'sandbox_not_configured'};
  let actual;
  try{actual=readRevision();}
  catch{return {test_id:'hermes_core_smoke',passed:false,receipt:'checkout_unavailable'};}
  if(actual!==candidate.revision_sha)
   return {test_id:'hermes_core_smoke',passed:false,receipt:'checkout_revision_drift'};
  const args=[
   'run','--rm','--pull=never','--network=none','--read-only',
   '--cap-drop=ALL','--security-opt=no-new-privileges',
   '--pids-limit=64','--memory=384m','--cpus=1','--user=65534:65534',
   '--tmpfs=/tmp:rw,nosuid,nodev,size=32m',
   '--mount','type=bind,source='+ROOT+',target=/a3,readonly',
   '--workdir=/a3','--entrypoint=node',
   imageId,'--test',...TEST_FILES
  ];
  return new Promise(resolve=>{
   let settled=false,child,timer;
   const done=passed=>{
    if(settled)return;
    settled=true;
    clearTimeout(timer);
    resolve(Object.freeze({test_id:'hermes_core_smoke',passed,
     receipt:passed?'test_process_passed':'isolated_test_failed'}));
   };
   try{child=spawnImpl('docker',args,{
    shell:false,stdio:['ignore','ignore','ignore'],
    env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
     HOME:'/tmp',DOCKER_CONFIG:'/nonexistent'}});}
   catch{return done(false);}
   if(!child||typeof child.once!=='function')return done(false);
   timer=setTimeout(()=>{
    try{if(typeof child.kill==='function')child.kill('SIGTERM');}catch{}
    done(false);
   },timeoutMs);
   child.once('error',()=>done(false));
   child.once('exit',code=>done(code===0));
  });
 };
}
function blocked(reason){
 return Object.freeze({version:VERSION,status:'A3_OFFICIAL_TEST_OBSERVATION_BLOCKED',
  reason,simulation_observed:false,test_process_passed:false,
  receipt_durable:false,issuer_verified:false,approval_verified:false,
  outbox_acknowledged:false,execution_authorized:false,
  // Execution effects were NOT independently measured; do not invent zeros.
  network_call_performed:null,scm_write_performed:null,
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
     !SHA.test(candidate.revision_sha||'')||
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
  try{observed=await executeTrustedTest(candidate);}
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
 const runSandboxTest=createHermesMaintainerA3NetworkIsolatedTestRunner({
  imageId:environment?.HERMES_A3_TEST_IMAGE_ID,spawnImpl,timeoutMs
 });
 const observer=createHermesMaintainerA3ZeroEffectTestRuntime({
  readSimulatedRunCandidate:reader.readSimulatedRunCandidate,
  executeTrustedTest:candidate=>{
   const boundary=createHermesMaintainerTestExecutionBoundary({
    runner:{run:async()=>runSandboxTest(candidate)}
   });
   return boundary.execute({
    action:'test_execution',environment:'staging',test_id:'hermes_core_smoke'
   });
  },environment
 });
 return Object.freeze({
  version:VERSION,
  configured:transport.configured&&
   IMAGE_ID.test(environment?.HERMES_A3_TEST_IMAGE_ID||'')&&
   environment?.HERMES_A3_ZERO_EFFECT_TEST_ENABLED==='true'&&
   environment?.HERMES_EXECUTION_ENABLED==='false'&&
   environment?.HERMES_EXECUTION_KILL_SWITCH==='true'&&
   environment?.HERMES_MISSION_INGRESS_ENABLED==='false',
  observe:observer.observe
 });
}
module.exports={VERSION,createHermesMaintainerA3ZeroEffectTestRuntime,
 createHermesMaintainerA3NetworkIsolatedTestRunner,
 createHermesMaintainerA3ZeroEffectTestFromServerEnv};
