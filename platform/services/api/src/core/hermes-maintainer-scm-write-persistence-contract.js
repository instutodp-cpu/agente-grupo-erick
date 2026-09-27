'use strict';

const {isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_scm_write_persistence_contract_v1';

function buildHermesMaintainerScmWritePersistenceRequest(consumption){
 const blockers=[];
 if(!consumption||consumption.contract_version!=='hermes_maintainer_scm_write_authorization_consumption_v1'||consumption.status!=='SCM_WRITE_AUTHORIZATION_CONSUMED'||consumption.consumption_valid!==true)blockers.push('CONSUMPTION_INVALID');
 if(!isCanonicalContentDigest(consumption?.intent_digest))blockers.push('INTENT_DIGEST_INVALID');
 if(typeof consumption?.authorization_reference!=='string'||consumption.authorization_reference.trim()==='')blockers.push('AUTHORIZATION_REFERENCE_INVALID');
 if(typeof consumption?.consumption_reference!=='string'||consumption.consumption_reference.trim()==='')blockers.push('CONSUMPTION_REFERENCE_INVALID');
 if(consumption?.authorization_consumed!==true||consumption?.single_use!==true||consumption?.replay_detected!==false)blockers.push('CONSUMPTION_STATE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_PERSISTENCE_REQUEST_PREPARED':'SCM_WRITE_PERSISTENCE_REQUEST_BLOCKED',
  request_valid:valid,
  persistence_operation:'CREATE_IF_ABSENT',
  persistence_key:valid?`${consumption.intent_digest}::${consumption.authorization_reference}`:null,
  intent_digest:consumption?.intent_digest||null,
  authorization_reference:consumption?.authorization_reference||null,
  consumption_reference:consumption?.consumption_reference||null,
  atomic_create_if_absent_required:true,
  durable_confirmation_required:true,
  persistence_performed:false,
  durable:false,
  execution_authorized:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,buildHermesMaintainerScmWritePersistenceRequest};
