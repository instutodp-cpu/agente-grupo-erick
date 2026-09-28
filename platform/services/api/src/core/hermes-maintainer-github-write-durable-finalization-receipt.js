'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_write_durable_finalization_receipt_v1';
const REQUEST_VERSION='hermes_maintainer_github_write_finalization_persistence_contract_v1';
const ADAPTER_VERSION='hermes_maintainer_github_write_finalization_persistence_adapter_v1';

function createHermesMaintainerGithubWriteDurableFinalizationReceipt(request,adapterResult){
 const blockers=[];
 if(!request||request.contract_version!==REQUEST_VERSION||request.status!=='GITHUB_WRITE_FINALIZATION_PERSISTENCE_REQUEST_PREPARED'||request.request_valid!==true)blockers.push('FINALIZATION_PERSISTENCE_REQUEST_INVALID');
 if(request?.persistence_operation!=='CREATE_IF_ABSENT'||request?.atomic_create_if_absent_required!==true||request?.durable_confirmation_required!==true)blockers.push('FINALIZATION_PERSISTENCE_SEMANTICS_INVALID');
 if(typeof request?.finalization_key!=='string'||request.finalization_key!==request?.finalization_digest+'::write-finalization')blockers.push('FINALIZATION_KEY_INVALID');
 if(!adapterResult||adapterResult.contract_version!==ADAPTER_VERSION||adapterResult.status!=='GITHUB_WRITE_FINALIZATION_PERSISTENCE_CREATED'||adapterResult.adapter_valid!==true)blockers.push('FINALIZATION_PERSISTENCE_RESULT_INVALID');
 if(adapterResult?.persistence_performed!==true||adapterResult?.created!==true||adapterResult?.durable!==true)blockers.push('DURABLE_FINALIZATION_NOT_CONFIRMED');
 if(adapterResult?.network_call_performed!==false||adapterResult?.write_performed!==false||adapterResult?.production_used!==false)blockers.push('FINALIZATION_PERSISTENCE_RESULT_STATE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED':'GITHUB_WRITE_DURABLE_FINALIZATION_BLOCKED',
  receipt_valid:valid,
  finalization_key:valid?request.finalization_key:null,
  finalization_digest:valid?request.finalization_digest:null,
  outcome_digest:valid?request.outcome_digest:null,
  intent_digest:valid?request.intent_digest:null,
  attempt_reference:valid?request.attempt_reference:null,
  admission_reference:valid?request.admission_reference:null,
  repository:valid?request.repository:null,
  operation:valid?request.operation:null,
  ref:valid?request.ref:null,
  sha:valid?request.sha:null,
  provider_status:valid?request.provider_status:null,
  persistence_performed:valid,
  durable:valid,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}

module.exports={CONTRACT_VERSION,createHermesMaintainerGithubWriteDurableFinalizationReceipt};
