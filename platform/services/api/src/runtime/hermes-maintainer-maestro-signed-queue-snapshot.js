'use strict';
// Verify a SOURCE-bound official queued MissionRun snapshot emitted by the
// existing authenticated Maestro Mission Gateway. The signing key belongs to
// Maestro only; a valid signature NEVER attests zero external effects, an ACK,
// A3 authority, or any independent receipt.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const VERSION='hermes_a3_authenticated_queued_snapshot_v1';
const KID='maestro-a3-queued-staging-v1';
const REPO='instutodp-cpu/agente-grupo-erick';
const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const ID=/^[^\x00-\x20\x7f]{1,255}$/;
const RAW_KEY=/^[A-Za-z0-9_-]{43}$/;
const RAW_SIG=/^[A-Za-z0-9_-]{86}$/;
const FIELDS=Object.freeze([
 'version','source','environment','mission_run_id','mission_id','workspace_id',
 'operation','repository','revision_sha','contract_hash','test_id','run_status',
 'dispatch_simulado','official_pre_run_approval_id','official_outbox_id',
 'outbox_status','outbox_provider','verified_contract_integrity',
 'simulated_run_queued','simulation_observed','receipt_durable',
 'outbox_acknowledged','issuer_verified','approval_verified',
 'execution_authorized','production_allowed','merge_authority'
]);
const ENVELOPE=Object.freeze(['issued','signature_version','key_id','issued_at',
 'canonical_record_json','ed25519_signature','execution_authorized',
 'simulation_receipt_durable','production_allowed']);
const QUERY=Object.freeze(['environment','mission_id','operation','repository','run_id']);
const sameKeys=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.getPrototypeOf(obj)===Object.prototype&&
 Object.keys(obj).sort().join('|')===[...keys].sort().join('|');
const strictB64url=(v,re)=>typeof v==='string'&&re.test(v);
function createVerifier({publicKeyB64Url,now=()=>Date.now()}={}){
 let publicKey=null;
 if(strictB64url(publicKeyB64Url,RAW_KEY)){
  try{
   const raw=Buffer.from(publicKeyB64Url,'base64url');
   if(raw.length===32){
    publicKey=crypto.createPublicKey({key:Buffer.concat([
     Buffer.from('302a300506032b6570032100','hex'),raw]),
     format:'der',type:'spki'});
   }
  }catch{}
 }
 function verifySnapshot(envelope,query){
  if(!publicKey||!sameKeys(query,QUERY)||
    query.environment!=='staging'||query.repository!==REPO||
    query.operation!=='update_file'||!ID.test(query.mission_id||'')||
    !ID.test(query.run_id||'')||!sameKeys(envelope,ENVELOPE)||
    envelope.issued!==true||envelope.signature_version!==VERSION||
    envelope.key_id!==KID||envelope.execution_authorized!==false||
    envelope.simulation_receipt_durable!==false||
    envelope.production_allowed!==false||
    typeof envelope.canonical_record_json!=='string'||
    envelope.canonical_record_json.length>8192||
    !strictB64url(envelope.ed25519_signature,RAW_SIG))return null;
  const issued=Date.parse(envelope.issued_at||'');
  if(!Number.isFinite(issued)||new Date(issued).toISOString()!==envelope.issued_at||
     issued>now()+30000||now()-issued>5*60*1000)return null;
  let record;
  try{record=JSON.parse(envelope.canonical_record_json);}
  catch{return null;}
  if(!sameKeys(record,FIELDS)||JSON.stringify(record)!==envelope.canonical_record_json||
    record.version!==VERSION||record.source!=='MAESTRO_MISSION_GATEWAY_AUTHENTICATED'||
    record.environment!=='staging'||record.mission_run_id!==query.run_id||
    record.mission_id!==query.mission_id||!ID.test(record.workspace_id||'')||
    record.operation!==query.operation||record.repository!==REPO||
    !SHA.test(record.revision_sha||'')||!DIGEST.test(record.contract_hash||'')||
    record.test_id!=='hermes_core_smoke'||record.run_status!=='na_fila'||
    record.dispatch_simulado!==true||
    !ID.test(record.official_pre_run_approval_id||'')||
    !ID.test(record.official_outbox_id||'')||
    record.outbox_status!=='pending'||record.outbox_provider!=='mock'||
    record.verified_contract_integrity!==true||record.simulated_run_queued!==true||
    record.simulation_observed!==false||record.receipt_durable!==false||
    record.outbox_acknowledged!==false||record.issuer_verified!==false||
    record.approval_verified!==false||record.execution_authorized!==false||
    record.production_allowed!==false||record.merge_authority!==false)return null;
  try{
   const signature=Buffer.from(envelope.ed25519_signature,'base64url');
   if(signature.length!==64)return null;
   const payload=['HERMES_A3_AUTHENTICATED_QUEUE_SOURCE_V1',
    KID,envelope.issued_at,envelope.canonical_record_json].join('\n');
   if(!crypto.verify(null,Buffer.from(payload),publicKey,signature))return null;
  }catch{return null;}
  return Object.freeze({
   source:'MAESTRO_MISSION_GATEWAY_OFFICIAL_QUEUE_CANDIDATE',
   workspace_id:record.workspace_id,mission_id:record.mission_id,
   mission_run_id:record.mission_run_id,operation:record.operation,
   repository:REPO,contract_hash:record.contract_hash,
   revision_sha:record.revision_sha,test_id:'hermes_core_smoke',
   verified_contract_integrity:true,simulated_run_queued:true,
   outbox_acknowledged:false,simulation_observed:false,receipt_durable:false,
   issuer_verified:false,approval_verified:false,execution_authorized:false,
   production_allowed:false,merge_authority:false
  });
 }
 return Object.freeze({configured:!!publicKey,verifySnapshot});
}
function createVerifierFromServerEnv({env=process.env}={}){
 if(env.HERMES_DEPLOYMENT_STAGE!=='staging')return createVerifier();
 return createVerifier({publicKeyB64Url:env.MAESTRO_A3_QUEUED_PUBLIC_KEY_B64URL});
}
// Staging's local observer consumes only a short-lived, gateway-SIGNED,
// manually delivered, process-owned snapshot file. This avoids copying a
// Base44 user bearer onto VPS; it is not an independent effect receipt.
function createSignedQueueSourceReaderFromServerEnv({env=process.env,fsImpl=fs}={}){
 const v=createVerifierFromServerEnv({env});
 const snapshotPath=env.HERMES_A3_SIGNED_QUEUED_SNAPSHOT_PATH;
 const configured=v.configured&&typeof snapshotPath==='string'&&
  path.isAbsolute(snapshotPath)&&snapshotPath.length<1024;
 async function readSimulatedRunCandidate(query){
  if(!configured)return null;
  let fd,raw;
  try{
   fd=fsImpl.openSync(snapshotPath,fsImpl.constants.O_RDONLY|fsImpl.constants.O_NOFOLLOW);
   const st=fsImpl.fstatSync(fd);
   if(!st.isFile()||st.size<2||st.size>16384||
      (st.mode&0o077)!==0||
      (typeof process.getuid==='function'&&st.uid!==process.getuid()))
     return null;
   raw=fsImpl.readFileSync(fd,{encoding:'utf8'});
  }catch{return null;}finally{if(fd!==undefined){try{fsImpl.closeSync(fd);}catch{}}}
  if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)return null;
  let envelope;
  try{envelope=JSON.parse(raw);}catch{return null;}
  return v.verifySnapshot(envelope,query);
 }
 return Object.freeze({configured,readSimulatedRunCandidate});
}
module.exports={VERSION,KID,FIELDS,createVerifier,createVerifierFromServerEnv,
 createSignedQueueSourceReaderFromServerEnv};
