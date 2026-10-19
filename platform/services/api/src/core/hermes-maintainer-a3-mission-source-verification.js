'use strict';

const {computeCanonicalContentDigest}=require('./canonical-content-digest');
const {stablePayload}=require('./agent-identity-contract');
const {validateHermesMaintainerSingleUseAuthorization}=require('./hermes-maintainer-single-use-execution-authorization');

// The reader is a privileged, independently authenticated MissionRun storage
// adapter. Do NOT build this evidence from a caller's staging gate or a locally
// assembled controlled-execution object. There is intentionally no fallback.
const CONTRACT_VERSION='hermes_maintainer_a3_mission_source_verification_v1';
const RECORD_VERSION='hermes_maintainer_a3_mission_origin_record_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const OPERATIONS=Object.freeze({update_file:'code_edit_prepare',create_pull_request:'pull_request_prepare'});
const FIELDS=Object.freeze([
 'contract_version','source','status','mission_run_id','mission_id','environment',
 'workflow_operation','operation','repository','base_ref','branch_name','target_digest',
 'intent_digest','approval_reference','authorization_reference','single_use_authorization_id',
 'single_use_fingerprint','simulation_receipt_digest','workflow_digest','authorization_binding_digest',
 'staging_gate_fingerprint','simulation_effect','durably_confirmed','executed','production_used',
 'merge_authority','human_merge_required','blockers','record_digest'
]);
const DIGEST=/^sha256:[a-f0-9]{64}$/;
const IDENTIFIER=/^[^\s\x00-\x1f\x7f]{1,255}$/;
const expectedDigest=record=>{
 const {record_digest:ignored,...material}=record;
 return computeCanonicalContentDigest(JSON.parse(stablePayload(material)));
};
function blocked(reason){return Object.freeze({contract_version:CONTRACT_VERSION,verified:false,status:'A3_MISSION_SOURCE_UNVERIFIED',mission_run_id:null,blockers:Object.freeze([reason])});}
function createHermesMaintainerA3MissionSourceVerifier({readMissionRun}={}){
 return Object.freeze({contract_version:CONTRACT_VERSION,async verify(input){
  const a=input?.source_evidence?.single_use_authorization,g=input?.source_evidence?.authorization_grant,t=input?.target_reference;
  if(!OPERATIONS[input?.operation]||!a||!g||!t||input.environment!=='staging'||!validateHermesMaintainerSingleUseAuthorization(a).valid)return blocked('MISSION_SOURCE_INPUT_INVALID');
  if(typeof readMissionRun!=='function')return blocked('INDEPENDENT_MISSION_READER_REQUIRED');
  let record;try{
   record=await readMissionRun(Object.freeze({mission_id:a.mission_id,operation:input.operation,repository:REPOSITORY,environment:'staging'}));
  }catch{return blocked('MISSION_SOURCE_READ_FAILED');}
  if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).sort().join('|')!==[...FIELDS].sort().join('|'))return blocked('MISSION_SOURCE_RECORD_INVALID');
  if(record.contract_version!==RECORD_VERSION||record.source!=='MISSION_GATEWAY_DURABLE'||
     record.status!=='STAGING_SIMULATION_RECONCILED'||!IDENTIFIER.test(record.mission_run_id||'')||
     record.mission_id!==a.mission_id||record.environment!=='staging'||
     record.workflow_operation!==OPERATIONS[input.operation]||record.operation!==input.operation||
     record.repository!==REPOSITORY||record.base_ref!=='main'||record.branch_name!==t.branch_name||
     record.target_digest!==t.target_digest||record.intent_digest!==input.action_intent_digest||
     record.approval_reference!==input.source_evidence.approval_binding?.approval_reference||
     record.authorization_reference!==g.authorization_reference||
     record.single_use_authorization_id!==a.authorization_id||record.single_use_fingerprint!==a.authorization_fingerprint||
     ![record.simulation_receipt_digest,record.workflow_digest,record.authorization_binding_digest,record.staging_gate_fingerprint,record.record_digest].every(x=>typeof x==='string'&&DIGEST.test(x))||
     record.simulation_effect!=='ZERO'||record.durably_confirmed!==true||
     record.executed!==false||record.production_used!==false||record.merge_authority!==false||
     record.human_merge_required!==true||!Array.isArray(record.blockers)||record.blockers.length!==0)
    return blocked('MISSION_SOURCE_SCOPE_OR_RECEIPT_INVALID');
  try{if(expectedDigest(record)!==record.record_digest)return blocked('MISSION_SOURCE_RECORD_DIGEST_MISMATCH');}
  catch{return blocked('MISSION_SOURCE_RECORD_NONCANONICAL');}
  return Object.freeze({contract_version:CONTRACT_VERSION,status:'A3_MISSION_SOURCE_VERIFIED',verified:true,
   mission_run_id:record.mission_run_id,source_record_digest:record.record_digest,blockers:Object.freeze([])});
 }});
}
module.exports={CONTRACT_VERSION,RECORD_VERSION,FIELDS,expectedDigest,createHermesMaintainerA3MissionSourceVerifier};
