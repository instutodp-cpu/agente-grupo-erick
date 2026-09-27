'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_durable_receipt_v1';

function createHermesMaintainerScmWriteDurableReceipt(request,adapterResult){
 const blockers=[];
 if(!request||request.contract_version!=='hermes_maintainer_scm_write_persistence_contract_v1'||request.status!=='SCM_WRITE_PERSISTENCE_REQUEST_PREPARED'||request.request_valid!==true)blockers.push('PERSISTENCE_REQUEST_INVALID');
 if(!adapterResult||adapterResult.contract_version!=='hermes_maintainer_scm_write_persistence_adapter_v1'||adapterResult.status!=='SCM_WRITE_PERSISTENCE_CREATED'||adapterResult.adapter_valid!==true)blockers.push('PERSISTENCE_RESULT_INVALID');
 if(adapterResult?.persistence_performed!==true||adapterResult?.created!==true||adapterResult?.durable!==true)blockers.push('DURABLE_CREATION_NOT_CONFIRMED');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_DURABLE_CONSUMPTION_CONFIRMED':'SCM_WRITE_DURABLE_CONSUMPTION_BLOCKED',
  receipt_valid:valid,
  persistence_key:valid?request.persistence_key:null,
  intent_digest:valid?request.intent_digest:null,
  authorization_reference:valid?request.authorization_reference:null,
  consumption_reference:valid?request.consumption_reference:null,
  durable_replay_protection:valid,
  single_use_confirmed:valid,
  execution_authorized:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,createHermesMaintainerScmWriteDurableReceipt};
