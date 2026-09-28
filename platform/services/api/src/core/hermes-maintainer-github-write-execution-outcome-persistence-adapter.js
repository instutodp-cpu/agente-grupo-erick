'use strict';

const CONTRACT_VERSION='hermes_maintainer_github_write_execution_outcome_persistence_adapter_v1';
const REQUEST_VERSION='hermes_maintainer_github_write_execution_outcome_persistence_contract_v1';

function createHermesMaintainerGithubWriteExecutionOutcomePersistenceAdapter({createIfAbsent}={}){
 if(typeof createIfAbsent!=='function')throw new Error('CREATE_IF_ABSENT_BACKEND_REQUIRED');
 async function persist(request){
  const blockers=[];
  if(!request||request.contract_version!==REQUEST_VERSION||request.status!=='GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_REQUEST_PREPARED'||request.request_valid!==true)blockers.push('OUTCOME_PERSISTENCE_REQUEST_INVALID');
  if(request?.persistence_operation!=='CREATE_IF_ABSENT'||request?.atomic_create_if_absent_required!==true||request?.durable_confirmation_required!==true)blockers.push('OUTCOME_PERSISTENCE_SEMANTICS_INVALID');
  if(typeof request?.outcome_key!=='string'||request.outcome_key!==request?.outcome_digest+'::execution-outcome')blockers.push('OUTCOME_KEY_INVALID');
  if(request?.persistence_performed!==false||request?.durable!==false||request?.network_call_performed!==false||request?.write_performed!==false||request?.production_used!==false)blockers.push('PREPERSISTENCE_STATE_INVALID');
  if(blockers.length)return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_BLOCKED',adapter_valid:false,persistence_performed:false,durable:false,created:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
  let result;
  try{result=await createIfAbsent(Object.freeze({key:request.outcome_key,outcome_digest:request.outcome_digest,intent_digest:request.intent_digest,attempt_reference:request.attempt_reference,admission_reference:request.admission_reference,repository:request.repository,operation:request.operation,ref:request.ref,sha:request.sha,provider_status:request.provider_status}));}
  catch{return Object.freeze({contract_version:CONTRACT_VERSION,status:'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_FAILED',adapter_valid:false,persistence_performed:true,durable:false,created:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze(['OUTCOME_PERSISTENCE_BACKEND_FAILED'])});}
  const created=result?.status==='CREATED'&&result?.durable===true;
  return Object.freeze({contract_version:CONTRACT_VERSION,status:created?'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_CREATED':'GITHUB_WRITE_EXECUTION_OUTCOME_PERSISTENCE_EXISTS',adapter_valid:true,persistence_performed:true,durable:created,created,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze(created?[]:['OUTCOME_PERSISTENCE_NOT_CREATED'])});
 }
 return Object.freeze({persist});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerGithubWriteExecutionOutcomePersistenceAdapter};
