'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_durable_ownership_binding_v1';
const RECEIPT_VERSION='hermes_maintainer_scm_write_durable_attempt_ownership_receipt_v1';

function bindHermesMaintainerScmWriteDurableOwnership(receipt){
 const blockers=[];
 if(!receipt||receipt.contract_version!==RECEIPT_VERSION||receipt.status!=='SCM_WRITE_DURABLE_ATTEMPT_OWNERSHIP_CONFIRMED'||receipt.receipt_valid!==true)blockers.push('DURABLE_OWNERSHIP_RECEIPT_INVALID');
 if(typeof receipt?.ownership_key!=='string'||receipt.ownership_key!==receipt?.persistence_key+'::attempt-ownership')blockers.push('OWNERSHIP_KEY_INVALID');
 if(typeof receipt?.attempt_reference!=='string'||receipt.attempt_reference.trim()==='')blockers.push('ATTEMPT_REFERENCE_INVALID');
 if(receipt?.durable_replay_protection!==true||receipt?.ownership_exclusive!==true)blockers.push('DURABLE_OWNERSHIP_INVALID');
 if(receipt?.execution_authorized!==false||receipt?.network_call_performed!==false||receipt?.write_performed!==false||receipt?.production_used!==false)blockers.push('RECEIPT_STATE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'SCM_WRITE_DURABLE_OWNERSHIP_BOUND':'SCM_WRITE_DURABLE_OWNERSHIP_BINDING_BLOCKED',binding_valid:valid,ownership_source:valid?'DURABLE_PERSISTENCE_RECEIPT':null,ownership_key:valid?receipt.ownership_key:null,persistence_key:valid?receipt.persistence_key:null,intent_digest:valid?receipt.intent_digest:null,authorization_reference:valid?receipt.authorization_reference:null,consumption_reference:valid?receipt.consumption_reference:null,attempt_reference:valid?receipt.attempt_reference:null,durable_replay_protection:valid,ownership_exclusive:valid,execution_authorized:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
module.exports={CONTRACT_VERSION,bindHermesMaintainerScmWriteDurableOwnership};
