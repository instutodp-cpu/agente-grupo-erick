'use strict';
// Bounded staging bridge: atomically reserve an OFFICIAL pending MissionRun,
// run the existing network-isolated test ONCE, durably record only that
// PROCESS observation. Never create, sign or imply an independent A3 receipt.
const {createHermesMaintainerA3ProcessObservationPersistence}=
 require('../core/hermes-maintainer-a3-process-observation-persistence');
const {createHermesMaintainerMaestroProcessReadInvokerFromServerEnv}=
 require('./hermes-maintainer-maestro-authenticated-invoker');
const {createHermesMaintainerMaestroMissionRunReader}=
 require('./hermes-maintainer-maestro-missionrun-reader');
const {createHermesMaintainerA3ZeroEffectTestFromServerEnv}=
 require('./hermes-maintainer-a3-zero-effect-test-runtime');
const {createSignedQueueSourceReaderFromServerEnv}=
 require('./hermes-maintainer-maestro-signed-queue-snapshot');
const denied=reason=>Object.freeze({
 status:reason,process_observation_durable:false,
 simulation_receipt_durable:false,issuer_verified:false,
 human_approval_verified:false,execution_authorized:false,
 network_call_performed:null,scm_write_performed:null,
 production_allowed:false,merge_authority:false
});
function createHermesMaintainerA3DurableProcessObservation({
 readSimulatedRunCandidate,observeIsolatedProcess,persistence
}={}){
 if(typeof readSimulatedRunCandidate!=='function'||
    typeof observeIsolatedProcess!=='function'||
    !persistence||typeof persistence.reserve!=='function'||
    typeof persistence.finish!=='function'||
    typeof persistence.failSafe!=='function')
  throw new TypeError('official_run_isolated_runner_and_postgres_required');
 async function observeOnce(query){
  // This call never uses a caller-provided proof or an unauthenticated mock.
  // The reader MUST be a privileged Mission Gateway adapter in production.
  let candidate;
  try{candidate=await readSimulatedRunCandidate(query);}
  catch{return denied('A3_DURABLE_OBSERVATION_OFFICIAL_READER_UNAVAILABLE');}
  if(!candidate)return denied('A3_DURABLE_OBSERVATION_OFFICIAL_RUN_MISSING');
  let reservation;
  try{reservation=await persistence.reserve(candidate);}
  catch{return denied('A3_DURABLE_OBSERVATION_RESERVATION_UNAVAILABLE');}
  if(reservation?.attempt_reserved!==true)
   return denied(reservation?.status||'A3_DURABLE_OBSERVATION_ALREADY_RESERVED');
  // The database INSERT precedes every process. If it was ambiguous,
  // a replay is refused without starting another process.
  let observed;
  try{observed=await observeIsolatedProcess(query);}
  catch{observed=null;}
  if(!observed||observed.simulation_observed!==true||
     observed.test_process_passed!==true||
     observed.status!=='A3_OFFICIAL_TEST_PROCESS_OBSERVED_NOT_ATTESTED'){
    try{await persistence.failSafe(candidate,'isolated_process_unconfirmed');}catch{}
    return denied('A3_DURABLE_OBSERVATION_PROCESS_FAILED_SAFE');
  }
  let final;
  try{final=await persistence.finish(candidate,observed);}
  catch{return denied('A3_DURABLE_OBSERVATION_COMMIT_UNCERTAIN');}
  if(final?.process_observation_durable!==true)
   return denied(final?.status||'A3_DURABLE_OBSERVATION_COMMIT_UNCERTAIN');
  return Object.freeze({
   ...denied('A3_PROCESS_OBSERVATION_DURABLE_NOT_ATTESTED'),
   process_observation_durable:true,
   mission_run_id:candidate.mission_run_id,
   workspace_id:candidate.workspace_id,
   observation_digest:final.observation_digest
  });
 }
 return Object.freeze({observeOnce});
}
function createHermesMaintainerA3DurableProcessObservationFromServerEnv({
 pool,environment=process.env,fetchImpl=globalThis.fetch,spawnImpl,timeoutMs
}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')
  throw new TypeError('official_a3_postgres_pool_required');
 const gateway=createHermesMaintainerMaestroProcessReadInvokerFromServerEnv({
  env:environment,fetchImpl});
 const signedSource=createSignedQueueSourceReaderFromServerEnv({env:environment});
 const reader=createHermesMaintainerMaestroMissionRunReader({
  invokeMissionGateway:gateway.configured?
   gateway.invokeMissionGateway:async()=>null
 });
 // Prefer the exact issuer-sealed queued source. Never fall back to unsigned
 // information if the configured snapshot expires or fails signature checks.
 const verifiedRead=signedSource.configured?
  signedSource.readSimulatedRunCandidate:reader.readSimulatedRunCandidate;
 const process=createHermesMaintainerA3ZeroEffectTestFromServerEnv({
  environment,fetchImpl,spawnImpl,timeoutMs,
  serverOwnedSignedQueueSourceReader:signedSource.configured?verifiedRead:undefined
 });
 const persistence=createHermesMaintainerA3ProcessObservationPersistence({
  pool,imageId:environment?.HERMES_A3_TEST_IMAGE_ID,environment
 });
 const composition=createHermesMaintainerA3DurableProcessObservation({
  readSimulatedRunCandidate:verifiedRead,
  observeIsolatedProcess:process.observe,
  persistence
 });
 return Object.freeze({
  configured:(signedSource.configured||gateway.configured)&&process.configured,
  observeOnce:composition.observeOnce
 });
}
module.exports={createHermesMaintainerA3DurableProcessObservation,
 createHermesMaintainerA3DurableProcessObservationFromServerEnv};
