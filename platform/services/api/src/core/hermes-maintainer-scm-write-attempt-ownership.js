'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_attempt_ownership_v1';

function claimHermesMaintainerScmWriteAttempt(receipt,claim){
 const blockers=[];
 if(!receipt||receipt.contract_version!=='hermes_maintainer_scm_write_durable_receipt_v1'||receipt.status!=='SCM_WRITE_DURABLE_CONSUMPTION_CONFIRMED'||receipt.receipt_valid!==true||receipt.durable_replay_protection!==true||receipt.single_use_confirmed!==true)blockers.push('DURABLE_RECEIPT_INVALID');
 if(typeof receipt?.persistence_key!=='string'||receipt.persistence_key.trim()==='')blockers.push('PERSISTENCE_KEY_INVALID');
 if(typeof receipt?.intent_digest!=='string'||!receipt.intent_digest.startsWith('sha256:'))blockers.push('INTENT_DIGEST_INVALID');
 if(!claim||claim.persistence_key!==receipt?.persistence_key||claim.intent_digest!==receipt?.intent_digest)blockers.push('CLAIM_SCOPE_MISMATCH');
 if(typeof claim?.attempt_reference!=='string'||claim.attempt_reference.trim()==='')blockers.push('ATTEMPT_REFERENCE_INVALID');
 if(claim?.already_claimed===true)blockers.push('ATTEMPT_ALREADY_CLAIMED');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_ATTEMPT_CLAIMED':'SCM_WRITE_ATTEMPT_CLAIM_BLOCKED',
  claim_valid:valid,
  persistence_key:valid?receipt.persistence_key:null,
  intent_digest:valid?receipt.intent_digest:null,
  authorization_reference:valid?receipt.authorization_reference:null,
  consumption_reference:valid?receipt.consumption_reference:null,
  attempt_reference:valid?claim.attempt_reference:null,
  ownership_exclusive:valid,
  durable_replay_protection:valid,
  execution_authorized:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,claimHermesMaintainerScmWriteAttempt};
