'use strict';
const {isNonEmptyString}=require('./read-only-adapter-contract');
const {validateHermesMaintainerScmReadCapabilityConsumption,CONSUMED}=require('./hermes-maintainer-scm-read-capability-consumption');
const CONTRACT_VERSION='hermes_maintainer_scm_read_replay_registry_v1';
function createHermesMaintainerScmReadReplayRegistry(){
 const records=new Map();
 function consume(consumption){
  const v=validateHermesMaintainerScmReadCapabilityConsumption(consumption);
  if(!v.valid||consumption.status!==CONSUMED||consumption.capability_consumed!==true)return Object.freeze({ok:false,status:'INVALID_CONSUMPTION',errors:Object.freeze(v.errors||[])});
  const key=consumption.capability_fingerprint;
  if(!isNonEmptyString(key))return Object.freeze({ok:false,status:'INVALID_CAPABILITY_FINGERPRINT'});
  const prior=records.get(key);
  if(prior){
   const replay=prior.consumption_fingerprint===consumption.consumption_fingerprint&&prior.consumption_id===consumption.consumption_id;
   return Object.freeze({ok:false,status:replay?'REPLAY_BLOCKED':'CONFLICT_BLOCKED',capability_fingerprint:key,original_consumption_id:prior.consumption_id,durable_replay_enforced:false,execution_performed:false,production_effect:'ZERO'});
  }
  const record=Object.freeze({contract_version:CONTRACT_VERSION,capability_fingerprint:key,consumption_fingerprint:consumption.consumption_fingerprint,consumption_id:consumption.consumption_id,mission_id:consumption.mission_id,operation:consumption.operation,repository:consumption.repository,base_ref:consumption.base_ref,executor_id:consumption.executor_id,state:'CONSUMED',sequence:1});
  records.set(key,record);
  return Object.freeze({ok:true,status:'CONSUMED_ONCE',capability_fingerprint:key,consumption_id:record.consumption_id,durable_replay_enforced:false,persistence_mode:'IN_MEMORY_CONTRACT_ONLY',execution_performed:false,production_effect:'ZERO'});
 }
 function get(capabilityFingerprint){return records.get(capabilityFingerprint)||null;}
 return Object.freeze({contract_version:CONTRACT_VERSION,mode:'IN_MEMORY_CONTRACT_ONLY',durable_distributed_atomicity:false,consume,get});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerScmReadReplayRegistry};
