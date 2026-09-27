'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_durable_attempt_ownership_receipt_v1';
const REQUEST_VERSION='hermes_maintainer_scm_write_attempt_ownership_persistence_contract_v1';
const ADAPTER_VERSION='hermes_maintainer_scm_write_attempt_ownership_persistence_adapter_v1';

function createHermesMaintainerScmWriteDurableAttemptOwnershipReceipt(request,adapterResult){
 const blockers=[];
 if(!request||request.contract_version!==REQUEST_VERSION||request.status!=='SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_REQUEST_PREPARED'||request.request_valid!==true)blockers.push('OWNERSHIP_PERSISTENCE_REQUEST_INVALID');
 if(request?.persistence_operation!=='CREATE_IF_ABSENT'||request?.atomic_create_if_absent_required!==true||request?.durable_confirmation_required!==true)blockers.push('OWNERSHIP_PERSISTENCE_SEMANTICS_INVALID');
 if(typeof request?.ownership_key!=='string'||request.ownership_key!==request?.persistence_key+'::attempt-ownership')blockers.push('OWNERSHIP_KEY_INVALID');
 if(typeof request?.attempt_reference!=='string'||request.attempt_reference.trim()==='')blockers.push('ATTEMPT_REFERENCE_INVALID');
 if(!adapterResult||adapterResult.contract_version!==ADAPTER_VERSION||adapterResult.status!=='SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_CREATED'||adapterResult.adapter_valid!==true)blockers.push('OWNERSHIP_PERSISTENCE_RESULT_INVALID');
 if(adapterResult?.persistence_performed!==true||adapterResult?.created!==true||adapterResult?.durable!==true||adapterResult?.ownership_exclusive!==true)blockers.push('DURABLE_OWNERSHIP_NOT_CONFIRMED');
 if(adapterResult?.execution_authorized!==false||adapterResult?.network_call_performed!==false||adapterResult?.write_performed!==false||adapterResult?.production_used!==false)blockers.push('OWNERSHIP_RESULT_STATE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'SCM_WRITE_DURABLE_ATTEMPT_OWNERSHIP_CONFIRMED':'SCM_WRITE_DURABLE_ATTEMPT_OWNERSHIP_BLOCKED',receipt_valid:valid,ownership_key:valid?request.ownership_key:null,persistence_key:valid?request.persistence_key:null,intent_digest:valid?request.intent_digest:null,authorization_reference:valid?request.authorization_reference:null,consumption_reference:valid?request.consumption_reference:null,attempt_reference:valid?request.attempt_reference:null,durable_replay_protection:valid,ownership_exclusive:valid,execution_authorized:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerScmWriteDurableAttemptOwnershipReceipt};
