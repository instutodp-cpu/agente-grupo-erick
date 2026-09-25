'use strict';
const {validateHermesMaintainerScmReadPersistenceRequest}=require('./hermes-maintainer-scm-read-persistence-contract');
const CONTRACT_VERSION='hermes_maintainer_scm_read_persistence_adapter_v1';
const TRUSTED_OUTCOMES=new Set(['CREATED','ALREADY_EXISTS','UNKNOWN_OUTCOME']);
async function invokeHermesMaintainerScmReadPersistence(request,persistence){
 const v=validateHermesMaintainerScmReadPersistenceRequest(request);
 if(!v.valid)return result('BLOCKED',false,false,'REQUEST_INVALID');
 if(!persistence||typeof persistence.createIfAbsent!=='function')return result('BLOCKED',false,false,'PERSISTENCE_UNAVAILABLE');
 let raw;try{raw=await persistence.createIfAbsent({key:request.capability_fingerprint,record:{capability_fingerprint:request.capability_fingerprint,consumption_fingerprint:request.consumption_fingerprint,consumption_id:request.consumption_id,mission_id:request.mission_id,operation:request.scm_operation,repository:request.repository,base_ref:request.base_ref,executor_id:request.executor_id}});}catch{return result('UNKNOWN_OUTCOME',true,false,'PERSISTENCE_EXCEPTION');}
 const outcome=raw?.outcome;if(!TRUSTED_OUTCOMES.has(outcome))return result('UNKNOWN_OUTCOME',true,false,'PERSISTENCE_OUTCOME_INVALID');
 if(outcome==='CREATED')return result(outcome,true,true,null);
 if(outcome==='ALREADY_EXISTS')return result(outcome,true,false,'CAPABILITY_ALREADY_CONSUMED');
 return result(outcome,true,false,'PERSISTENCE_OUTCOME_UNKNOWN');
}
function result(outcome,invoked,durable,blocker){return Object.freeze({contract_version:CONTRACT_VERSION,outcome,persistence_invoked:invoked,durable_replay_enforced:durable,execution_allowed:false,network_authorized:false,credentials_authorized:false,write_authorized:false,provider_called:false,execution_performed:false,production_allowed:false,blockers:Object.freeze(blocker?[blocker]:[])});}
module.exports={CONTRACT_VERSION,invokeHermesMaintainerScmReadPersistence};
