'use strict';
// Deploy only under a separately administered trust boundary, OUTSIDE Hermes
// and Maestro. No key, credential, default Docker access or operational route.
// This explicit composition never processes a prior "process_observed" run.
const crypto=require('node:crypto');
const {createVerifier}=require('../services/api/src/runtime/hermes-maintainer-maestro-signed-queue-snapshot');
const {verifyIndependentWitnessReceipt,VERSION,PURPOSE}=
 require('../services/api/src/runtime/hermes-maintainer-a3-independent-witness-receipt');
const {computeCanonicalContentDigest}=require('../services/api/src/core/canonical-content-digest');
const {stablePayload}=require('../services/api/src/core/agent-identity-contract');
const REPO='instutodp-cpu/agente-grupo-erick';
const IMG=/^sha256:[0-9a-f]{64}$/,SHA=/^[0-9a-f]{40}$/,C_ID=/^[0-9a-f]{64}$/;
const denial=status=>Object.freeze({
 status,receipt_emitted:false,receipt_durable:false,execution_authorized:false,
 production_allowed:false,merge_authority:false,outbox_acknowledged:false,
 network_call_performed:null,scm_write_performed:null
});
const iso=x=>x instanceof Date?x.toISOString():x;
const observedRow=(o,r,image)=>o&&o.state==='process_observed'&&
 o.mission_run_id===r.mission_run_id&&o.mission_id===r.mission_id&&
 o.workspace_id===r.workspace_id&&o.contract_hash===r.contract_hash&&
 o.revision_sha===r.revision_sha&&o.docker_image_id===image&&
 o.operation==='update_file'&&o.repository===REPO&&
 o.observation_evidence?.observation_type==='isolated_test_process_only'&&
 o.observation_evidence?.subprocess_passed===true&&
 o.observation_evidence?.simulation_receipt_durable===false&&
 o.observation_evidence?.independent_issuer_verified===false&&
 computeCanonicalContentDigest(o.observation_evidence)===o.observation_digest;
function inspectIsolation(info,{containerId,imageId,sourceRoot}){
 if(!info||info.Id!==containerId||info.Image!==imageId)return null;
 const h=info.HostConfig||{},c=info.Config||{},mounts=info.Mounts;
 if(h.NetworkMode!=='none'||h.ReadonlyRootfs!==true||
   h.Privileged!==false||!Array.isArray(h.CapDrop)||
   !h.CapDrop.includes('ALL')||
   (Array.isArray(h.CapAdd)&&h.CapAdd.length!==0)||
   !Array.isArray(h.SecurityOpt)||
   !h.SecurityOpt.includes('no-new-privileges')||
   c.User!=='65534:65534'||h.PidMode==='host'||h.IpcMode==='host'||
   h.UsernsMode==='host'||h.PortBindings&&Object.keys(h.PortBindings).length>0||
   !Array.isArray(mounts)||mounts.filter(m=>m.Type==='bind').length!==1||
   !mounts.some(m=>m.Type==='bind'&&m.Source===sourceRoot&&
     m.Destination==='/a3'&&m.RW===false)||
   !mounts.every(m=>(m.Type==='bind'&&m.Source===sourceRoot&&
     m.Destination==='/a3'&&m.RW===false)||
     (m.Type==='tmpfs'&&m.Destination==='/tmp'))||
   (h.Binds||[]).length>0||(h.VolumesFrom||[]).length>0||
   (h.Devices||[]).length>0||(h.DeviceRequests||[]).length>0||
   c.WorkingDir!=='/a3'||c.Entrypoint?.join('|')!=='node'||
   (c.Cmd||[]).join('|')!=='--test|test/hermes-maintainer-e2e-workflow-contract.test.js|test/hermes-maintainer-test-execution-boundary.test.js'||
   h.Tmpfs?.['/tmp']===undefined||
   (c.Env||[]).some(v=>/(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)=/i.test(v)))
  return null;
 return Object.freeze({
  network_mode:'none',read_only_rootfs:true,read_only_source:true,
  cap_drop_all:true,no_new_privileges:true,privileged:false,
  docker_socket_mounted:false,secrets_mounted:false,
  host_network:false,host_pid:false,unprivileged_user:'65534:65534'
 });
}
function createIndependentA3Supervisor({
 environment={},maestroPublicKey,issuerId,issuerPublicKey,
 imageId,sourceRoot,readRevision,readClean,
 readSnapshot,readObservation,reserveWitnessAttempt,finalizeObservation,
 persistAndReadReceipt,docker,sign,now=()=>Date.now()
}={}){
 const ready=()=>environment.A3_INDEPENDENT_WITNESS_EXECUTION_ENABLED==='true'&&
  environment.HERMES_DEPLOYMENT_STAGE==='staging'&&
  environment.HERMES_EXECUTION_ENABLED==='false'&&
  environment.HERMES_EXECUTION_KILL_SWITCH==='true'&&
  environment.HERMES_MISSION_INGRESS_ENABLED==='false'&&
  IMG.test(imageId||'')&&typeof issuerId==='string'&&
  typeof sourceRoot==='string'&&sourceRoot.startsWith('/')&&sourceRoot.endsWith('/platform/services/api')&&
  !sourceRoot.includes('..')&&
  [readRevision,readClean,readSnapshot,readObservation,
   reserveWitnessAttempt,finalizeObservation,persistAndReadReceipt,sign]
    .every(f=>typeof f==='function')&&
  docker&&['create','inspect','start','wait','remove'].every(k=>typeof docker[k]==='function');
 // No retry per MissionRun even on uncertain Docker create / timeout / commit.
 const consumed=new Set();
 async function superviseOnce(query){
  if(!ready())return denial('A3_INDEPENDENT_SUPERVISOR_DISABLED');
  if(!query||Object.keys(query).sort().join('|')!==
   ['environment','mission_id','operation','repository','run_id'].sort().join('|')||
   query.environment!=='staging'||query.operation!=='update_file'||
   query.repository!==REPO||typeof query.run_id!=='string')
   return denial('A3_INDEPENDENT_SUPERVISOR_QUERY_INVALID');
  if(consumed.has(query.run_id))return denial('A3_INDEPENDENT_SUPERVISOR_REPLAY');
  // Mark in-flight synchronously, before ANY await, including source reading.
  consumed.add(query.run_id);
  // Only Maestro's short-lived Ed25519 signed queue source may be admitted.
  let envelope,candidate,r;
  try{
   envelope=await readSnapshot(query);
   candidate=createVerifier({publicKeyB64Url:maestroPublicKey,now})
     .verifySnapshot(envelope,query);
   r=JSON.parse(envelope?.canonical_record_json||'');
  }catch{return denial('A3_INDEPENDENT_SUPERVISOR_ORIGIN_UNAVAILABLE');}
  if(!candidate||candidate.mission_run_id!==query.run_id||
    r?.official_outbox_id===undefined)
   return denial('A3_INDEPENDENT_SUPERVISOR_ORIGIN_INVALID');
  let reserved;
  try{reserved=await readObservation(query.run_id);}catch{
   return denial('A3_INDEPENDENT_SUPERVISOR_DB_UNAVAILABLE');}
  if(!reserved||reserved.state!=='reserved'||
    reserved.mission_id!==r.mission_id||
    reserved.workspace_id!==r.workspace_id||
    reserved.contract_hash!==r.contract_hash||
    reserved.revision_sha!==r.revision_sha||
    reserved.docker_image_id!==imageId||
    !Number.isFinite(Date.parse(iso(reserved.reserved_at)||''))||
    now()<Date.parse(iso(reserved.reserved_at))||
    now()-Date.parse(iso(reserved.reserved_at))>120000)
   return denial('A3_INDEPENDENT_SUPERVISOR_NOT_FRESHLY_RESERVED');
  try{if(await readRevision()!==r.revision_sha||
    await readClean()!==true) return denial('A3_INDEPENDENT_SUPERVISOR_SOURCE_NOT_PINNED');}
  catch{return denial('A3_INDEPENDENT_SUPERVISOR_SOURCE_UNAVAILABLE');}
  // Global DB reservation + per-process memory guard BEFORE any Docker create.
  // A failed/uncertain commit never permits retry. Cross-host uniqueness is
  // enforced by PostgreSQL PK/UNIQUE of migration 037.
  let claim;
  try{
   claim=await reserveWitnessAttempt(Object.freeze({
    mission_run_id:r.mission_run_id,mission_id:r.mission_id,
    workspace_id:r.workspace_id,official_outbox_id:r.official_outbox_id,
    contract_hash:r.contract_hash,revision_sha:r.revision_sha,
    docker_image_id:imageId
   }));
  }catch{return denial('A3_INDEPENDENT_SUPERVISOR_ATTEMPT_UNCONFIRMED');}
  if(!claim||claim.mission_run_id!==r.mission_run_id||
    claim.mission_id!==r.mission_id||
    claim.workspace_id!==r.workspace_id||
    claim.official_outbox_id!==r.official_outbox_id||
    claim.contract_hash!==r.contract_hash||
    claim.revision_sha!==r.revision_sha||
    claim.docker_image_id!==imageId||
    claim.environment!=='staging')
   return denial('A3_INDEPENDENT_SUPERVISOR_ATTEMPT_ALREADY_CLAIMED');
  const createdAt=new Date(now()).toISOString();
  let containerId=null,controls=null,finishedAt=null,exitCode=null;
  let removed=false,executionVerified=false;
  try{
   containerId=await docker.create(Object.freeze({imageId,sourceRoot,
    revisionSha:r.revision_sha,runId:r.mission_run_id}));
   if(!C_ID.test(containerId||''))throw Error('docker_create_unconfirmed');
   const before=await docker.inspect(containerId);
   controls=inspectIsolation(before,{containerId,imageId,sourceRoot});
   if(!controls||before.State?.Status!=='created')throw Error('docker_isolation_unverified');
   await docker.start(containerId);
   exitCode=await docker.wait(containerId);
   finishedAt=new Date(now()).toISOString();
   const after=await docker.inspect(containerId);
   if(exitCode!==0||!controls||after?.Id!==containerId||
      after?.State?.Status!=='exited'||after.State.ExitCode!==0||
      !inspectIsolation(after,{containerId,imageId,sourceRoot}))
    throw Error('docker_process_or_postflight_unconfirmed');
   if(await readRevision()!==r.revision_sha||await readClean()!==true)
    throw Error('docker_source_changed_during_execution');
   executionVerified=true;
  }catch{/* A failed or ambiguous Docker operation must never authorize a receipt. */}
  finally{
   if(containerId&&C_ID.test(containerId)){
    try{await docker.remove(containerId);removed=true;}catch{}
   }
  }
  if(!executionVerified||!removed)
   return denial('A3_INDEPENDENT_SUPERVISOR_DOCKER_UNCONFIRMED');
  // Hermes must finalize precisely this single witnessed subprocess before
  // signing; no pre-existing historical process can be retroactively signed.
  let observation;
  try{
   await finalizeObservation(Object.freeze({candidate,containerId,
    passed:true,startedAt:createdAt,finishedAt,exitCode}));
   observation=await readObservation(query.run_id);
  }catch{return denial('A3_INDEPENDENT_SUPERVISOR_OBSERVATION_UNAVAILABLE');}
  if(!observedRow(observation,r,imageId)||
     Date.parse(iso(observation.reserved_at))>Date.parse(createdAt)||
     Date.parse(iso(observation.finished_at))<Date.parse(finishedAt)||
     now()-Date.parse(iso(observation.finished_at))>10000)
   return denial('A3_INDEPENDENT_SUPERVISOR_OBSERVATION_NOT_LINKED');
  const record=Object.freeze({
   version:VERSION,issuer_id:issuerId,environment:'staging',
   workspace_id:r.workspace_id,mission_id:r.mission_id,
   mission_run_id:r.mission_run_id,official_outbox_id:r.official_outbox_id,
   operation:'update_file',repository:REPO,test_id:'hermes_core_smoke',
   contract_hash:r.contract_hash,revision_sha:r.revision_sha,
   docker_image_id:imageId,process_observation_digest:observation.observation_digest,
   container_id:containerId,witness_started_at:createdAt,
   witness_finished_at:finishedAt,issued_at:new Date(now()).toISOString(),
   test_exit_code:0,scope:'isolated_test_container_only',controls
  });
  let signature,proof;
  try{
   signature=await sign(Buffer.from(PURPOSE+'\n'+stablePayload(record)));
   proof={record,signature};
  }catch{return denial('A3_INDEPENDENT_SUPERVISOR_EXTERNAL_SIGNER_UNAVAILABLE');}
  const official=Object.freeze({
   workspace_id:r.workspace_id,mission_id:r.mission_id,
   mission_run_id:r.mission_run_id,official_outbox_id:r.official_outbox_id,
   contract_hash:r.contract_hash,revision_sha:r.revision_sha,
   docker_image_id:imageId,operation:'update_file',repository:REPO,
   source:r.source,verified_contract_integrity:r.verified_contract_integrity,
   run_status:r.run_status,dispatch_simulado:r.dispatch_simulado,
   outbox_status:r.outbox_status,outbox_provider:r.outbox_provider,
   execution_authorized:false
  });
  const verified=verifyIndependentWitnessReceipt({envelope:proof,
   observation:{...observation,reserved_at:iso(observation.reserved_at),
    finished_at:iso(observation.finished_at)},official,
   publicKeyB64Url:issuerPublicKey,issuerId,now});
  if(!verified.verified)return denial('A3_INDEPENDENT_SUPERVISOR_SIGNATURE_INVALID');
  let stored;
  try{stored=await persistAndReadReceipt(Object.freeze({
   mission_run_id:r.mission_run_id,mission_id:r.mission_id,
   workspace_id:r.workspace_id,official_outbox_id:r.official_outbox_id,
   issuer_id:issuerId,process_observation_digest:observation.observation_digest,
   receipt_digest:computeCanonicalContentDigest(record),receipt_envelope:proof,
   witnessed_started_at:createdAt,witnessed_finished_at:finishedAt,issued_at:record.issued_at
  }));}catch{return denial('A3_INDEPENDENT_SUPERVISOR_COMMIT_UNCERTAIN');}
  if(!stored||stored.mission_run_id!==r.mission_run_id||
     stored.receipt_digest!==verified.receipt_digest||
     stored.process_observation_digest!==observation.observation_digest)
   return denial('A3_INDEPENDENT_SUPERVISOR_READBACK_INVALID');
  return Object.freeze({...denial('A3_INDEPENDENT_WITNESS_DURABLE_NO_AUTHORITY'),
   receipt_emitted:true,receipt_durable:true,mission_run_id:r.mission_run_id,
   receipt_digest:verified.receipt_digest});
 }
 return Object.freeze({configured:ready(),superviseOnce});
}
module.exports={inspectIsolation,createIndependentA3Supervisor};
