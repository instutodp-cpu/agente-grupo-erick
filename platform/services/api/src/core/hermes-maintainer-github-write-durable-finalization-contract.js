'use strict';

const {computeCanonicalContentDigest,isCanonicalContentDigest}=require('./canonical-content-digest');

const CONTRACT_VERSION='hermes_maintainer_github_write_durable_finalization_contract_v1';
const RECEIPT_VERSION='hermes_maintainer_github_write_durable_execution_outcome_receipt_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';

function buildHermesMaintainerGithubWriteDurableFinalization(receipt){
 const blockers=[];
 if(!receipt||receipt.contract_version!==RECEIPT_VERSION||receipt.status!=='GITHUB_WRITE_DURABLE_EXECUTION_OUTCOME_CONFIRMED'||receipt.receipt_valid!==true)blockers.push('DURABLE_OUTCOME_RECEIPT_INVALID');
 if(typeof receipt?.outcome_key!=='string'||receipt.outcome_key!==receipt?.outcome_digest+'::execution-outcome')blockers.push('OUTCOME_KEY_INVALID');
 if(!isCanonicalContentDigest(receipt?.outcome_digest)||!isCanonicalContentDigest(receipt?.intent_digest))blockers.push('OUTCOME_DIGEST_INVALID');
 for(const key of ['attempt_reference','admission_reference','ref','sha'])if(typeof receipt?.[key]!=='string'||receipt[key].trim()==='')blockers.push('OUTCOME_IDENTITY_INVALID');
 if(receipt?.repository!==REPOSITORY||receipt?.operation!=='create_branch'||receipt?.provider_status!==201)blockers.push('OUTCOME_SCOPE_INVALID');
 if(!/^refs\/heads\/hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(receipt?.ref||'')||(receipt?.ref||'').includes('..')||!/^[a-f0-9]{40}$/.test(receipt?.sha||''))blockers.push('OUTCOME_TARGET_INVALID');
 if(receipt?.persistence_performed!==true||receipt?.durable!==true||receipt?.network_call_performed!==false||receipt?.write_performed!==false||receipt?.production_used!==false)blockers.push('DURABLE_OUTCOME_STATE_INVALID');
 const valid=blockers.length===0;
 const material=valid?{outcome_digest:receipt.outcome_digest,intent_digest:receipt.intent_digest,attempt_reference:receipt.attempt_reference,admission_reference:receipt.admission_reference,repository:receipt.repository,operation:receipt.operation,ref:receipt.ref,sha:receipt.sha,provider_status:receipt.provider_status}:null;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'GITHUB_WRITE_DURABLE_FINALIZATION_PREPARED':'GITHUB_WRITE_DURABLE_FINALIZATION_BLOCKED',
  finalization_valid:valid,
  finalization_digest:valid?computeCanonicalContentDigest(material):null,
  ...(material||{}),
  durable_outcome_confirmed:valid,
  persistence_performed:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}

module.exports={CONTRACT_VERSION,buildHermesMaintainerGithubWriteDurableFinalization};
