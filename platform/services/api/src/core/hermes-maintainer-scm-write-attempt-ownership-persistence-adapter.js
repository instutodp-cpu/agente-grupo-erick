'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_attempt_ownership_persistence_adapter_v1';
const REQUEST_VERSION='hermes_maintainer_scm_write_attempt_ownership_persistence_contract_v1';

function createHermesMaintainerScmWriteAttemptOwnershipPersistenceAdapter({createIfAbsent}={}){
 if(typeof createIfAbsent!=='function')throw new Error('CREATE_IF_ABSENT_BACKEND_REQUIRED');
 async function persist(request){
  const blockers=[];
  if(!request||request.contract_version!==REQUEST_VERSION||request.status!=='SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_REQUEST_PREPARED'||request.request_valid!==true)blockers.push('OWNERSHIP_PERSISTENCE_REQUEST_INVALID');
  if(request?.persistence_operation!=='CREATE_IF_ABSENT'||request?.atomic_create_if_absent_required!==true||request?.durable_confirmation_required!==true)blockers.push('OWNERSHIP_PERSISTENCE_SEMANTICS_INVALID');
  if(typeof request?.ownership_key!=='string'||request.ownership_key!==request?.persistence_key+'::attempt-ownership')blockers.push('OWNERSHIP_KEY_INVALID');
  if(typeof request?.attempt_reference!=='string'||request.attempt_reference.trim()==='')blockers.push('ATTEMPT_REFERENCE_INVALID');
  if(request?.ownership_exclusive!==false||request?.execution_authorized!==false||request?.network_call_performed!==false||request?.write_performed!==false||request?.production_used!==false)blockers.push('PREPERSISTENCE_STATE_INVALID');
  if(blockers.length)return Object.freeze({contract_version:CONTRACT_VERSION,status:'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_BLOCKED',adapter_valid:false,persistence_performed:false,durable:false,created:false,ownership_exclusive:false,execution_authorized:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
  let result;
  try{result=await createIfAbsent(Object.freeze({key:request.ownership_key,persistence_key:request.persistence_key,intent_digest:request.intent_digest,authorization_reference:request.authorization_reference,consumption_reference:request.consumption_reference,attempt_reference:request.attempt_reference}));}
  catch{return Object.freeze({contract_version:CONTRACT_VERSION,status:'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_FAILED',adapter_valid:false,persistence_performed:true,durable:false,created:false,ownership_exclusive:false,execution_authorized:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze(['OWNERSHIP_PERSISTENCE_BACKEND_FAILED'])});}
  const created=result?.status==='CREATED'&&result?.durable===true;
  return Object.freeze({contract_version:CONTRACT_VERSION,status:created?'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_CREATED':'SCM_WRITE_ATTEMPT_OWNERSHIP_PERSISTENCE_EXISTS',adapter_valid:true,persistence_performed:true,durable:created,created,ownership_exclusive:created,execution_authorized:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze(created?[]:['OWNERSHIP_PERSISTENCE_NOT_CREATED'])});
 }
 return Object.freeze({persist});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerScmWriteAttemptOwnershipPersistenceAdapter};
