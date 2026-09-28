'use strict';

const {isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_github_write_finalization_persistence_contract_v1';
const FINALIZATION_VERSION='hermes_maintainer_github_write_durable_finalization_contract_v1';

function buildHermesMaintainerGithubWriteFinalizationPersistenceRequest(finalization){
 const blockers=[];
 if(!finalization||finalization.contract_version!==FINALIZATION_VERSION||finalization.status!=='GITHUB_WRITE_DURABLE_FINALIZATION_PREPARED'||finalization.finalization_valid!==true)blockers.push('FINALIZATION_INVALID');
 if(!isCanonicalContentDigest(finalization?.finalization_digest)||!isCanonicalContentDigest(finalization?.outcome_digest)||!isCanonicalContentDigest(finalization?.intent_digest))blockers.push('FINALIZATION_DIGEST_INVALID');
 for(const key of ['attempt_reference','admission_reference','repository','operation','ref','sha'])if(typeof finalization?.[key]!=='string'||finalization[key].trim()==='')blockers.push('FINALIZATION_IDENTITY_INVALID');
 if(finalization?.repository!=='instutodp-cpu/agente-grupo-erick'||finalization?.operation!=='create_branch'||finalization?.provider_status!==201)blockers.push('FINALIZATION_SCOPE_INVALID');
 if(!/^refs\/heads\/hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(finalization?.ref||'')||(finalization?.ref||'').includes('..')||!/^[a-f0-9]{40}$/.test(finalization?.sha||''))blockers.push('FINALIZATION_TARGET_INVALID');
 if(finalization?.durable_outcome_confirmed!==true||finalization?.persistence_performed!==false||finalization?.network_call_performed!==false||finalization?.write_performed!==false||finalization?.production_used!==false)blockers.push('FINALIZATION_STATE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'GITHUB_WRITE_FINALIZATION_PERSISTENCE_REQUEST_PREPARED':'GITHUB_WRITE_FINALIZATION_PERSISTENCE_REQUEST_BLOCKED',
  request_valid:valid,
  persistence_operation:'CREATE_IF_ABSENT',
  finalization_key:valid?finalization.finalization_digest+'::write-finalization':null,
  finalization_digest:valid?finalization.finalization_digest:null,
  outcome_digest:valid?finalization.outcome_digest:null,
  intent_digest:valid?finalization.intent_digest:null,
  attempt_reference:valid?finalization.attempt_reference:null,
  admission_reference:valid?finalization.admission_reference:null,
  repository:valid?finalization.repository:null,
  operation:valid?finalization.operation:null,
  ref:valid?finalization.ref:null,
  sha:valid?finalization.sha:null,
  provider_status:valid?finalization.provider_status:null,
  atomic_create_if_absent_required:true,
  durable_confirmation_required:true,
  persistence_performed:false,
  durable:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}

module.exports={CONTRACT_VERSION,buildHermesMaintainerGithubWriteFinalizationPersistenceRequest};
