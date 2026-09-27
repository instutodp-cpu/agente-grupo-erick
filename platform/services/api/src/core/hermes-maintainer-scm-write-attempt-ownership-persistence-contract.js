'use strict';

const {isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_scm_write_attempt_ownership_persistence_contract_v1';
const RECEIPT_VERSION='hermes_maintainer_scm_write_durable_receipt_v1';
const CLAIM_FIELDS=Object.freeze(['attempt_reference','intent_digest','persistence_key']);

function hasExactFields(value,fields){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=Object.keys(value).sort();
 return keys.length===fields.length&&keys.every((key,index)=>key===fields[index]);
}

function buildHermesMaintainerScmWriteAttemptOwnershipPersistenceRequest(receipt,claim){
 const blockers=[];
 if(!receipt||receipt.contract_version!==RECEIPT_VERSION||receipt.status!=='SCM_WRITE_DURABLE_CONSUMPTION_CONFIRMED'||receipt.receipt_valid!==true||receipt.durable_replay_protection!==true||receipt.single_use_confirmed!==true)blockers.push('DURABLE_RECEIPT_INVALID');
 if(typeof receipt?.persistence_key!=='string'||receipt.persistence_key.trim()==='')blockers.push('PERSISTENCE_KEY_INVALID');
 if(!isCanonicalContentDigest(receipt?.intent_digest))blockers.push('INTENT_DIGEST_INVALID');
 if(!hasExactFields(claim,CLAIM_FIELDS))blockers.push('CLAIM_FIELDS_INVALID');
 if(claim?.persistence_key!==receipt?.persistence_key||claim?.intent_digest!==receipt?.intent_digest)blockers.push('CLAIM_SCOPE_MISMATCH');
 if(typeof claim?.attempt_reference!=='string'||claim.attempt_reference.trim()==='')blockers.push('ATTEMPT_REFERENCE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_REQUEST_PREPARED':'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_REQUEST_BLOCKED',
  request_valid:valid,
  persistence_operation:'CREATE_IF_ABSENT',
  ownership_key:valid?`${receipt.persistence_key}::attempt-ownership`:null,
  persistence_key:valid?receipt.persistence_key:null,
  intent_digest:valid?receipt.intent_digest:null,
  authorization_reference:valid?receipt.authorization_reference:null,
  consumption_reference:valid?receipt.consumption_reference:null,
  attempt_reference:valid?claim.attempt_reference:null,
  atomic_create_if_absent_required:true,
  durable_confirmation_required:true,
  ownership_exclusive:false,
  execution_authorized:false,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}

module.exports={CONTRACT_VERSION,buildHermesMaintainerScmWriteAttemptOwnershipPersistenceRequest};
