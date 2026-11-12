'use strict';
// READ-ONLY, OFF by default: accept only a previously committed independent
// supervisor receipt with its pinned external signing key, current official
// MissionRun identity, and immutable observation 035. Cannot ACK, write SCM,
// complete Maestro runs, or promote. No private issuer key in this process.
const OBS_TABLE='hermes.maintainer_a3_process_observations';
const WIT_TABLE='hermes.maintainer_a3_independent_witness_receipts';
const ATTEMPT_TABLE='hermes.maintainer_a3_witness_attempts';
const READ_OBS='SELECT * FROM '+OBS_TABLE+' WHERE mission_run_id=$1';
const READ_WIT='SELECT * FROM '+WIT_TABLE+' WHERE mission_run_id=$1';
const READ_ATTEMPT='SELECT * FROM '+ATTEMPT_TABLE+' WHERE mission_run_id=$1';
const ID=/^[^\x00-\x20\x7f]{1,255}$/;
const disabled=status=>Object.freeze({status,
 independently_attested:false,receipt_durable:false,
 execution_authorized:false,write_performed:false,production_allowed:false,
 outbox_acknowledged:false,merge_authority:false,network_call_performed:null,
 scm_write_performed:null});
function createHermesMaintainerA3IndependentWitnessReadAdmission({
 pool,readOfficialMissionRun,verifyIndependentWitnessReceipt,
 publicKeyB64Url,issuerId,environment=process.env,now=()=>Date.now()
}={}){
 if(!pool||typeof pool.query!=='function')throw new TypeError('postgres_required');
 if(typeof readOfficialMissionRun!=='function')throw new TypeError('official_maestro_reader_required');
 if(typeof verifyIndependentWitnessReceipt!=='function')throw new TypeError('separate_issuer_verifier_required');
 const gates=()=>environment.HERMES_DEPLOYMENT_STAGE==='staging'&&
  environment.HERMES_A3_INDEPENDENT_WITNESS_READ_ENABLED==='true'&&
  environment.HERMES_EXECUTION_ENABLED==='false'&&
  environment.HERMES_EXECUTION_KILL_SWITCH==='true'&&
  environment.HERMES_MISSION_INGRESS_ENABLED==='false';
 async function readVerified(runId){
  if(!gates())return disabled('A3_WITNESS_READ_DISABLED');
  if(!ID.test(runId||''))return disabled('A3_WITNESS_RUN_ID_INVALID');
  let official;
  try{official=await readOfficialMissionRun(Object.freeze({run_id:runId}));}
  catch{return disabled('A3_WITNESS_OFFICIAL_READ_UNAVAILABLE');}
  if(!official||official.mission_run_id!==runId)
   return disabled('A3_WITNESS_OFFICIAL_SOURCE_UNVERIFIED');
  let obs,wit,attempt;
  try{
   const [o,w,a]=await Promise.all([
    pool.query(READ_OBS,[runId]),pool.query(READ_WIT,[runId]),
    pool.query(READ_ATTEMPT,[runId])
   ]);
   if(o?.rows?.length!==1||w?.rows?.length!==1||a?.rows?.length!==1)
    return disabled('A3_WITNESS_RECEIPT_OBSERVATION_OR_ATTEMPT_ABSENT');
   obs=o.rows[0];wit=w.rows[0];attempt=a.rows[0];
  }catch{return disabled('A3_WITNESS_DB_READ_UNAVAILABLE');}
  // A signed statement and completed observation are insufficient without
  // the independent global single-process reservation (migration 037).
  if(attempt.mission_run_id!==runId||
     attempt.mission_id!==official.mission_id||
     attempt.workspace_id!==official.workspace_id||
     attempt.official_outbox_id!==official.official_outbox_id||
     attempt.contract_hash!==official.contract_hash||
     attempt.revision_sha!==official.revision_sha||
     attempt.docker_image_id!==official.docker_image_id||
     attempt.environment!=='staging')
   return disabled('A3_WITNESS_ATTEMPT_SCOPE_MISMATCH');
  const attemptTime=attempt.reserved_at instanceof Date?
   attempt.reserved_at.getTime():Date.parse(attempt.reserved_at||'');
  const observationTime=obs.reserved_at instanceof Date?
   obs.reserved_at.getTime():Date.parse(obs.reserved_at||'');
  const witnessTime=Date.parse(wit.receipt_envelope?.record?.witness_started_at||'');
  if(![attemptTime,observationTime,witnessTime].every(Number.isFinite)||
     attemptTime<observationTime||attemptTime>witnessTime||
     witnessTime-attemptTime>120000)
   return disabled('A3_WITNESS_ATTEMPT_NOT_CONTEMPORANEOUS');
  if(wit.mission_run_id!==runId||wit.mission_id!==official.mission_id||
     wit.workspace_id!==official.workspace_id||
     wit.official_outbox_id!==official.official_outbox_id||
     wit.issuer_id!==issuerId||
     wit.process_observation_digest!==obs.observation_digest||
     !wit.receipt_envelope||typeof wit.receipt_envelope!=='object')
   return disabled('A3_WITNESS_LEDGER_BINDING_INVALID');
  const normalized={...obs,
   reserved_at:obs.reserved_at instanceof Date?obs.reserved_at.toISOString():obs.reserved_at,
   finished_at:obs.finished_at instanceof Date?obs.finished_at.toISOString():obs.finished_at};
  const verified=verifyIndependentWitnessReceipt({
   envelope:wit.receipt_envelope,observation:normalized,official,
   publicKeyB64Url,issuerId,now
  });
  if(verified.verified!==true||wit.receipt_digest!==verified.receipt_digest)
   return disabled('A3_WITNESS_RECEIPT_SIGNATURE_OR_SCOPE_INVALID');
  if(wit.witnessed_started_at instanceof Date?
      wit.witnessed_started_at.toISOString()!==wit.receipt_envelope.record.witness_started_at:
      wit.witnessed_started_at!==wit.receipt_envelope.record.witness_started_at)
   return disabled('A3_WITNESS_LEDGER_TIME_DRIFT');
  if(wit.witnessed_finished_at instanceof Date?
      wit.witnessed_finished_at.toISOString()!==wit.receipt_envelope.record.witness_finished_at:
      wit.witnessed_finished_at!==wit.receipt_envelope.record.witness_finished_at)
   return disabled('A3_WITNESS_LEDGER_TIME_DRIFT');
  if(wit.issued_at instanceof Date?
      wit.issued_at.toISOString()!==wit.receipt_envelope.record.issued_at:
      wit.issued_at!==wit.receipt_envelope.record.issued_at)
   return disabled('A3_WITNESS_LEDGER_TIME_DRIFT');
  const commit=wit.committed_at instanceof Date?wit.committed_at.getTime():
   Date.parse(wit.committed_at||'');
  const issued=Date.parse(wit.receipt_envelope.record.issued_at);
  if(!Number.isFinite(commit)||!Number.isFinite(issued)||
     Math.abs(commit-issued)>30000)
   return disabled('A3_WITNESS_LEDGER_NOT_CONTEMPORANEOUS');
  return Object.freeze({...disabled('A3_WITNESS_RECEIPT_DURABLE_VERIFIED_NO_AUTHORITY'),
   independently_attested:true,receipt_durable:true,issuer_id:issuerId,
   mission_run_id:runId,receipt_digest:verified.receipt_digest,
   process_observation_digest:verified.process_observation_digest});
 }
 return Object.freeze({readVerified});
}
module.exports={OBS_TABLE,WIT_TABLE,ATTEMPT_TABLE,READ_OBS,READ_WIT,READ_ATTEMPT,
 createHermesMaintainerA3IndependentWitnessReadAdmission};
