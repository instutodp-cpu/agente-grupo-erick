'use strict';
// Independent witness RECEIPT ADMISSION only. The signer MUST be a separately
// controlled supervisor that observes/controls Docker during execution.
// A Maestro queue snapshot, Hermes process exit, or backfilled observation
// can never substitute for its Ed25519 attestation. No SCM authority.
const crypto=require('node:crypto');
const {computeCanonicalContentDigest}=require('./canonical-content-digest');
const VERSION='hermes_a3_independent_supervisor_receipt_v1';
const PURPOSE='HERMES_A3_INDEPENDENT_SUPERVISOR_RECEIPT_V1';
const REPO='instutodp-cpu/agente-grupo-erick';
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^sha256:[a-f0-9]{64}$/;
const ID=/^[^\x00-\x20\x7f]{1,255}$/,B64=/^[A-Za-z0-9_-]{43}$/;
const RECORD_FIELDS=Object.freeze([
 'version','issuer_id','environment','workspace_id','mission_id','mission_run_id',
 'official_outbox_id','operation','repository','test_id','contract_hash',
 'revision_sha','docker_image_id','process_observation_digest',
 'container_id','witness_started_at','witness_finished_at','issued_at',
 'test_exit_code','scope','controls'
]);
const OFFICIAL_FIELDS=Object.freeze([
 'workspace_id','mission_id','mission_run_id','official_outbox_id',
 'contract_hash','revision_sha','docker_image_id','operation','repository',
 'source','verified_contract_integrity','run_status','dispatch_simulado',
 'outbox_status','outbox_provider','execution_authorized'
]);
const CONTROLS=Object.freeze([
 'network_mode','read_only_rootfs','read_only_source','cap_drop_all',
 'no_new_privileges','privileged','docker_socket_mounted','secrets_mounted',
 'host_network','host_pid','unprivileged_user'
]);
const denied=reason=>Object.freeze({verified:false,status:reason,
 simulation_receipt_durable:false,independent_issuer_verified:false,
 execution_authorized:false,network_call_performed:null,scm_write_performed:null,
 outbox_acknowledged:false,production_allowed:false,merge_authority:false});
const exact=(value,keys)=>value&&typeof value==='object'&&
 !Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&
 Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const date=v=>{
 if(typeof v!=='string')return NaN;
 const n=Date.parse(v);
 return Number.isFinite(n)&&new Date(n).toISOString()===v?n:NaN;
};
const denyUnless=(b,reason)=>b?null:denied(reason);
function publicKey(raw){
 if(typeof raw!=='string'||!B64.test(raw))return null;
 try{
  const b=Buffer.from(raw,'base64url');
  if(b.length!==32||b.toString('base64url')!==raw)return null;
  return crypto.createPublicKey({key:Buffer.concat([
   Buffer.from('302a300506032b6570032100','hex'),b]),format:'der',type:'spki'});
 }catch{return null;}
}
function verifyIndependentWitnessReceipt({envelope,observation,official,
 publicKeyB64Url,issuerId,now=()=>Date.now()}={}){
 const key=publicKey(publicKeyB64Url);
 if(!key||!ID.test(issuerId||'')||!exact(envelope,['record','signature'])||
    !exact(envelope.record,RECORD_FIELDS)||
    !exact(envelope.record.controls,CONTROLS)||
    typeof envelope.signature!=='string'||
    !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature))
  return denied('A3_INDEPENDENT_RECEIPT_MALFORMED_OR_UNTRUSTED');
 const r=envelope.record,c=r.controls;
 if(r.version!==VERSION||r.issuer_id!==issuerId||
    r.environment!=='staging'||r.scope!=='isolated_test_container_only'||
    r.repository!==REPO||r.operation!=='update_file'||
    r.test_id!=='hermes_core_smoke'||r.test_exit_code!==0||
    !ID.test(r.workspace_id||'')||!ID.test(r.mission_id||'')||
    !ID.test(r.mission_run_id||'')||!ID.test(r.official_outbox_id||'')||
    !DIGEST.test(r.contract_hash||'')||!DIGEST.test(r.docker_image_id||'')||
    !DIGEST.test(r.process_observation_digest||'')||
    !SHA.test(r.revision_sha||'')||!/^[a-f0-9]{64}$/.test(r.container_id||'')||
    c.network_mode!=='none'||c.read_only_rootfs!==true||
    c.read_only_source!==true||c.cap_drop_all!==true||
    c.no_new_privileges!==true||c.privileged!==false||
    c.docker_socket_mounted!==false||c.secrets_mounted!==false||
    c.host_network!==false||c.host_pid!==false||
    c.unprivileged_user!=='65534:65534')
  return denied('A3_INDEPENDENT_RECEIPT_SCOPE_OR_ISOLATION_INVALID');
 if(!exact(official,OFFICIAL_FIELDS)||
    official.source!=='MAESTRO_MISSION_GATEWAY_AUTHENTICATED'||
    official.verified_contract_integrity!==true||
    official.run_status!=='na_fila'||
    official.dispatch_simulado!==true||
    official.outbox_status!=='pending'||
    official.outbox_provider!=='mock'||
    official.execution_authorized!==false||
    ['workspace_id','mission_id','mission_run_id','official_outbox_id',
     'contract_hash','revision_sha','docker_image_id','operation','repository']
     .some(k=>official[k]!==r[k]))
  return denied('A3_INDEPENDENT_RECEIPT_OFFICIAL_BINDING_MISMATCH');
 // DB observation was reserved BEFORE any subprocess and is immutable once
 // process_observed. No absent/reserved/failed_safe record is acceptable.
 if(!observation||observation.state!=='process_observed'||
    observation.mission_id!==r.mission_id||
    observation.mission_run_id!==r.mission_run_id||
    observation.workspace_id!==r.workspace_id||
    observation.contract_hash!==r.contract_hash||
    observation.revision_sha!==r.revision_sha||
    observation.docker_image_id!==r.docker_image_id||
    observation.repository!==REPO||
    observation.operation!==r.operation||
    !DIGEST.test(observation.observation_digest||'')||
    observation.observation_digest!==r.process_observation_digest||
    !observation.observation_evidence||
    observation.observation_evidence.observation_type!=='isolated_test_process_only'||
    observation.observation_evidence.subprocess_passed!==true||
    observation.observation_evidence.simulation_receipt_durable!==false||
    observation.observation_evidence.independent_issuer_verified!==false)
  return denied('A3_INDEPENDENT_RECEIPT_PROCESS_OBSERVATION_MISMATCH');
 try{
  if(computeCanonicalContentDigest(observation.observation_evidence)!==
     observation.observation_digest)
   return denied('A3_INDEPENDENT_RECEIPT_OBSERVATION_DIGEST_MISMATCH');
 }catch{return denied('A3_INDEPENDENT_RECEIPT_OBSERVATION_INVALID');}
 const start=date(r.witness_started_at),end=date(r.witness_finished_at),
  signed=date(r.issued_at),reserved=date(observation.reserved_at),
  stored=date(observation.finished_at),current=now();
 // Short bounded chronology FORBIDS post-hoc signing of an old observation.
 // Independent issuer is trusted only after OS principal/key segregation.
 if([start,end,signed,reserved,stored,current].some(v=>!Number.isFinite(v))||
    start<reserved||end<start||end-start>120000||
    end>stored+2000||signed<end||signed>stored+10000||
    signed>current+30000||stored<reserved)
  return denied('A3_INDEPENDENT_RECEIPT_NOT_CONTEMPORANEOUS');
 try{
  const signature=Buffer.from(envelope.signature,'base64url');
  if(signature.length!==64||
     signature.toString('base64url')!==envelope.signature||
     !crypto.verify(null,Buffer.from(PURPOSE+'\n'+JSON.stringify(r)),
       key,signature))
   return denied('A3_INDEPENDENT_RECEIPT_SIGNATURE_INVALID');
 }catch{return denied('A3_INDEPENDENT_RECEIPT_SIGNATURE_INVALID');}
 return Object.freeze({
  ...denied('A3_INDEPENDENT_RECEIPT_VERIFIED_NOT_ADMITTED'),
  verified:true,independent_issuer_verified:true,
  receipt_digest:computeCanonicalContentDigest(r),
  mission_run_id:r.mission_run_id,
  process_observation_digest:r.process_observation_digest,
  issuer_id:r.issuer_id,
  // A valid cryptographic proof is NOT durable until the independent
  // issuer-owned append-only record is committed and read back.
  simulation_receipt_durable:false
 });
}
module.exports={VERSION,PURPOSE,RECORD_FIELDS,CONTROLS,
 verifyIndependentWitnessReceipt};
