'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_persistence_adapter_v1';

function createHermesMaintainerScmWritePersistenceAdapter({createIfAbsent}={}){
 if(typeof createIfAbsent!=='function')throw new Error('CREATE_IF_ABSENT_BACKEND_REQUIRED');
 async function persist(request){
  const blockers=[];
  if(!request||request.contract_version!=='hermes_maintainer_scm_write_persistence_contract_v1'||request.status!=='SCM_WRITE_PERSISTENCE_REQUEST_PREPARED'||request.request_valid!==true)blockers.push('PERSISTENCE_REQUEST_INVALID');
  if(request?.persistence_operation!=='CREATE_IF_ABSENT'||request?.atomic_create_if_absent_required!==true||request?.durable_confirmation_required!==true)blockers.push('PERSISTENCE_SEMANTICS_INVALID');
  if(typeof request?.persistence_key!=='string'||request.persistence_key.trim()==='')blockers.push('PERSISTENCE_KEY_INVALID');
  if(blockers.length)return Object.freeze({contract_version:CONTRACT_VERSION,status:'SCM_WRITE_PERSISTENCE_BLOCKED',adapter_valid:false,persistence_performed:false,durable:false,created:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
  let result;
  try{result=await createIfAbsent(Object.freeze({key:request.persistence_key,intent_digest:request.intent_digest,authorization_reference:request.authorization_reference,consumption_reference:request.consumption_reference}));}
  catch(_){return Object.freeze({contract_version:CONTRACT_VERSION,status:'SCM_WRITE_PERSISTENCE_FAILED',adapter_valid:false,persistence_performed:true,durable:false,created:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze(['PERSISTENCE_BACKEND_FAILED'])});}
  const created=result?.status==='CREATED'&&result?.durable===true;
  const exists=result?.status==='EXISTS'&&result?.durable===false;
  if(!created&&!exists){const blocker=result?.status==='UNCONFIRMED'?'PERSISTENCE_BACKEND_UNCONFIRMED':result?.status==='INVALID'?'PERSISTENCE_BACKEND_INVALID':'PERSISTENCE_BACKEND_FAILED';return Object.freeze({contract_version:CONTRACT_VERSION,status:'SCM_WRITE_PERSISTENCE_FAILED',adapter_valid:false,persistence_performed:true,durable:false,created:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([blocker])});}
  return Object.freeze({contract_version:CONTRACT_VERSION,status:created?'SCM_WRITE_PERSISTENCE_CREATED':'SCM_WRITE_PERSISTENCE_EXISTS',adapter_valid:true,persistence_performed:true,durable:created,created,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze(created?[]:['PERSISTENCE_NOT_CREATED'])});
 }
 return Object.freeze({persist});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerScmWritePersistenceAdapter};
