'use strict';
// Staging-only OBSERVATION of an official isolated test process.
// Never an independently issuer-signed simulation receipt, human approval,
// outbox ACK, execution grant, or SCM consumption.
const {createHash}=require('node:crypto');
const TABLE='hermes.maintainer_a3_process_observations';
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^sha256:[a-f0-9]{64}$/;
const ID=/^[^\x00-\x20\x7f]{1,255}$/;
const REPO='instutodp-cpu/agente-grupo-erick';
const COLS=Object.freeze(['mission_run_id','mission_id','workspace_id','environment',
 'operation','repository','contract_hash','revision_sha','docker_image_id','test_id']);
const SELECT='SELECT '+[...COLS,'state','observation_digest','observation_evidence','failure_code'].join(',')+
 ' FROM '+TABLE+' WHERE mission_run_id=$1';
const INSERT='INSERT INTO '+TABLE+' ('+COLS.join(',')+') VALUES ('+
 COLS.map((_,i)=>'$'+(i+1)).join(',')+
 ') ON CONFLICT DO NOTHING RETURNING mission_run_id';
const FINALIZE='UPDATE '+TABLE+
 ' SET state=$1,observation_digest=$2,observation_evidence=$3::jsonb,'+
 'failure_code=$4,finished_at=CURRENT_TIMESTAMP WHERE state=\'reserved\''+
 ' AND '+COLS.map((c,i)=>c+'=$'+(i+5)).join(' AND ')+
 ' RETURNING mission_run_id';
const flags=()=>Object.freeze({
 execution_authorized:false,provider_invoked:false,write_performed:false,
 production_allowed:false,merge_authority:false,issuer_verified:false,
 human_approval_verified:false,simulation_receipt_durable:false,
 outbox_acknowledged:false,network_call_performed:null,
 scm_write_performed:null
});
const denied=status=>Object.freeze({...flags(),status,
 process_observation_durable:false,attempt_reserved:false});
function observationScope(candidate,imageId){
 if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||
  candidate.source!=='MAESTRO_MISSION_GATEWAY_OFFICIAL_QUEUE_CANDIDATE'||
  ![candidate.workspace_id,candidate.mission_id,candidate.mission_run_id].every(v=>ID.test(v||''))||
  !DIGEST.test(candidate.contract_hash||'')||
  !SHA.test(candidate.revision_sha||'')||!DIGEST.test(imageId||'')||
  candidate.test_id!=='hermes_core_smoke'||
  candidate.verified_contract_integrity!==true||
  candidate.simulated_run_queued!==true||
  candidate.simulation_observed!==false||
  candidate.receipt_durable!==false||
  candidate.outbox_acknowledged!==false||
  candidate.issuer_verified!==false||
  candidate.approval_verified!==false||
  candidate.execution_authorized!==false||
  candidate.production_allowed!==false||
  candidate.merge_authority!==false)
  return null;
 return Object.freeze({
  mission_run_id:candidate.mission_run_id,mission_id:candidate.mission_id,
  workspace_id:candidate.workspace_id,environment:'staging',
  operation:candidate.operation,repository:REPO,
  contract_hash:candidate.contract_hash,revision_sha:candidate.revision_sha,
  docker_image_id:imageId,test_id:'hermes_core_smoke'
 });
}
function createHermesMaintainerA3ProcessObservationPersistence({
 pool,imageId,environment=process.env
}={}){
 if(!pool||typeof pool.connect!=='function'||typeof pool.query!=='function')
  throw new TypeError('a3_postgres_pool_required');
 const ready=()=>environment.HERMES_DEPLOYMENT_STAGE==='staging'&&
  environment.HERMES_A3_ZERO_EFFECT_TEST_ENABLED==='true'&&
  environment.HERMES_EXECUTION_ENABLED==='false'&&
  environment.HERMES_EXECUTION_KILL_SWITCH==='true'&&
  environment.HERMES_MISSION_INGRESS_ENABLED==='false'&&DIGEST.test(imageId||'');
 function makeRow(c){
  const row=observationScope(c,imageId);
  if(!row||!['update_file','create_pull_request'].includes(row.operation)||
    c.repository!==REPO)return null;
  return row;
 }
 async function transaction(sql,args,row,expectState){
  let conn,open=false;
  try{
   conn=await pool.connect();await conn.query('BEGIN');open=true;
   const inserted=await conn.query(sql,args);
   if(!inserted||!Array.isArray(inserted.rows)||inserted.rows.length!==1||
      inserted.rows[0]?.mission_run_id!==row.mission_run_id){
    await conn.query('ROLLBACK');open=false;return false;
   }
   await conn.query('COMMIT');open=false;
   // A commit acknowledgement alone is not proof of a durable row.
   const checked=await pool.query(SELECT,[row.mission_run_id]);
   const item=checked?.rows;
   return Array.isArray(item)&&item.length===1&&
    COLS.every(k=>item[0][k]===row[k])&&item[0].state===expectState;
  }catch{
   if(conn&&open){try{await conn.query('ROLLBACK');}catch{}}
   return false;
  }finally{if(conn){try{conn.release();}catch{}}}
 }
 async function reserve(candidate){
  if(!ready())return denied('A3_OBSERVATION_STAGING_DISABLED');
  const row=makeRow(candidate);
  if(!row)return denied('A3_OBSERVATION_OFFICIAL_RUN_INVALID');
  const ok=await transaction(INSERT,COLS.map(k=>row[k]),row,'reserved');
  if(!ok)return denied('A3_OBSERVATION_RESERVED_OR_DB_UNCERTAIN');
  return Object.freeze({...denied('A3_OBSERVATION_ATTEMPT_RESERVED'),
   attempt_reserved:true});
 }
 async function finish(candidate,observation){
  if(!ready())return denied('A3_OBSERVATION_STAGING_DISABLED');
  const row=makeRow(candidate);
  if(!row)return denied('A3_OBSERVATION_OFFICIAL_RUN_INVALID');
  if(!observation||observation.status!=='A3_OFFICIAL_TEST_PROCESS_OBSERVED_NOT_ATTESTED'||
   observation.simulation_observed!==true||observation.test_process_passed!==true||
   observation.mission_run_id!==row.mission_run_id||
   observation.mission_id!==row.mission_id||
   observation.workspace_id!==row.workspace_id||
   observation.contract_hash!==row.contract_hash||
   observation.receipt_durable!==false||
   observation.issuer_verified!==false||
   observation.approval_verified!==false||
   observation.outbox_acknowledged!==false||
   observation.execution_authorized!==false||
   observation.production_allowed!==false||
   observation.merge_authority!==false||
   observation.network_call_performed!==null||
   observation.scm_write_performed!==null)
   return denied('A3_OBSERVATION_RESULT_NOT_WITNESSED');
  const evidence=Object.freeze({
   observation_type:'isolated_test_process_only',
   mission_run_id:row.mission_run_id,mission_id:row.mission_id,
   workspace_id:row.workspace_id,operation:row.operation,repository:row.repository,
   contract_hash:row.contract_hash,revision_sha:row.revision_sha,
   docker_image_id:row.docker_image_id,test_id:row.test_id,
   runner_profile:'docker_sha_pinned_readonly_network_none',
   subprocess_passed:true,simulation_receipt_durable:false,
   independent_issuer_verified:false,execution_authorized:false,
   outbox_acknowledged:false,network_call_performed:null,
   scm_write_performed:null
  });
  const digest='sha256:'+createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  const ok=await transaction(FINALIZE,
   ['process_observed',digest,JSON.stringify(evidence),null,...COLS.map(k=>row[k])],
   row,'process_observed');
  if(!ok)return denied('A3_OBSERVATION_FINISH_UNCERTAIN');
  const record=await pool.query(SELECT,[row.mission_run_id]).catch(()=>null);
  const stored=record?.rows?.[0];
  if(!stored||stored.observation_digest!==digest||
   JSON.stringify(Object.entries(stored.observation_evidence||{}).sort(([a],[b])=>a.localeCompare(b)))!==JSON.stringify(Object.entries(evidence).sort(([a],[b])=>a.localeCompare(b))))
    return denied('A3_OBSERVATION_READBACK_MISMATCH');
  return Object.freeze({...denied('A3_PROCESS_OBSERVATION_DURABLE_NOT_ATTESTED'),
   process_observation_durable:true,observation_digest:digest});
 }
 async function failSafe(candidate,reason='process_unconfirmed'){
  if(!ready())return denied('A3_OBSERVATION_STAGING_DISABLED');
  const row=makeRow(candidate);
  if(!row)return denied('A3_OBSERVATION_OFFICIAL_RUN_INVALID');
  const code=/^[a-z0-9_]{1,100}$/.test(reason)?reason:'process_unconfirmed';
  const ok=await transaction(FINALIZE,
   ['failed_safe',null,null,code,...COLS.map(k=>row[k])],row,'failed_safe');
  return denied(ok?'A3_PROCESS_OBSERVATION_FAILED_SAFE_LOCKED':
   'A3_PROCESS_OBSERVATION_FAILURE_UNCONFIRMED');
 }
 return Object.freeze({reserve,finish,failSafe});
}
module.exports={TABLE,COLS,INSERT,SELECT,FINALIZE,observationScope,
 createHermesMaintainerA3ProcessObservationPersistence};
