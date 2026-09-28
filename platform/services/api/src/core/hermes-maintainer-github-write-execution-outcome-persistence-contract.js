'use strict';

const {isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_github_write_execution_outcome_persistence_contract_v1';
const RECEIPT_VERSION='hermes_maintainer_github_write_execution_outcome_receipt_v1';

function buildHermesMaintainerGithubWriteExecutionOutcomePersistenceRequest(receipt){
 const blockers=[];
 if(!receipt||receipt.contract_version!==RECEIPT_VERSION||receipt.status!=='GITHUB_WRITE_EXECUTION_OUTCOME_RECEIPT_PREPARED'||receipt.receipt_valid!==true)blockers.push('OUTCOME_RECEIPT_INVALID');
 if(!isCanonicalContentDigest(receipt?.outcome_digest))blockers.push('OUTCOME_DIGEST_INVALID');
 if(!isCanonicalContentDigest(receipt?.intent_digest))blockers.push('INTENT_DIGEST_INVALID');
 for(const key of ['attempt_reference','capability_reference','admission_reference','persistence_key','ownership_key','repository','operation','ref','sha'])if(typeof receipt?.[key]!=='string'||receipt[key].trim()==='')blockers.push('OUTCOME_IDENTITY_INVALID');
 if(receipt?.execution_performed!==true||receipt?.network_call_performed!==true||receipt?.write_performed!==true||receipt?.production_used!==false||receipt?.provider_status!==201||receipt?.durable!==false)blockers.push('OUTCOME_STATE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_REQUEST_PREPARED':'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_REQUEST_BLOCKED',
  request_valid:valid,
  persistence_operation:'CREATE_IF_ABSENT',
  outcome_key:valid?`${receipt.outcome_digest}::execution-outcome`:null,
  outcome_digest:valid?receipt.outcome_digest:null,
  intent_digest:valid?receipt.intent_digest:null,
  attempt_reference:valid?receipt.attempt_reference:null,
  admission_reference:valid?receipt.admission_reference:null,
  repository:valid?receipt.repository:null,
  operation:valid?receipt.operation:null,
  ref:valid?receipt.ref:null,
  sha:valid?receipt.sha:null,
  provider_status:valid?receipt.provider_status:null,
  atomic_create_if_absent_required:true,
  durable_confirmation_required:true,
  persistence_performed:false,
  durable:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,buildHermesMaintainerGithubWriteExecutionOutcomePersistenceRequest};
