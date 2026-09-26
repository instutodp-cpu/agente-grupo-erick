'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_replay_registry_v1';

function createHermesMaintainerScmWriteReplayRegistry(){
 const consumed=new Map();
 function key(v){return `${v.intent_digest}::${v.authorization_reference}`;}
 function register(consumption){
  const blockers=[];
  if(!consumption||consumption.contract_version!=='hermes_maintainer_scm_write_authorization_consumption_v1'||consumption.status!=='SCM_WRITE_AUTHORIZATION_CONSUMED'||consumption.consumption_valid!==true||consumption.authorization_consumed!==true||consumption.single_use!==true)blockers.push('CONSUMPTION_INVALID');
  if(typeof consumption?.intent_digest!=='string'||!consumption.intent_digest.startsWith('sha256:'))blockers.push('INTENT_DIGEST_INVALID');
  if(typeof consumption?.authorization_reference!=='string'||consumption.authorization_reference.trim()==='')blockers.push('AUTHORIZATION_REFERENCE_INVALID');
  if(typeof consumption?.consumption_reference!=='string'||consumption.consumption_reference.trim()==='')blockers.push('CONSUMPTION_REFERENCE_INVALID');
  const k=blockers.length?null:key(consumption);
  if(k&&consumed.has(k))blockers.push('REPLAY_DETECTED');
  const valid=blockers.length===0;
  if(valid)consumed.set(k,consumption.consumption_reference);
  return Object.freeze({
   contract_version:CONTRACT_VERSION,
   status:valid?'SCM_WRITE_CONSUMPTION_REGISTERED':'SCM_WRITE_CONSUMPTION_REPLAY_BLOCKED',
   registry_valid:valid,
   intent_digest:consumption?.intent_digest||null,
   authorization_reference:consumption?.authorization_reference||null,
   consumption_reference:valid?consumption.consumption_reference:null,
   replay_detected:blockers.includes('REPLAY_DETECTED'),
   durable:false,
   execution_authorized:false,
   network_call_performed:false,
   write_performed:false,
   production_used:false,
   blockers:Object.freeze([...new Set(blockers)].sort())
  });
 }
 return Object.freeze({register});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerScmWriteReplayRegistry};
