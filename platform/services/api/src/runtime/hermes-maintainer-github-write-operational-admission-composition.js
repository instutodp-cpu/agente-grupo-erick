'use strict';

const {consumeHermesMaintainerScmWriteAuthorization}=require('../core/hermes-maintainer-scm-write-authorization-consumption');
const {buildHermesMaintainerScmWritePersistenceRequest}=require('../core/hermes-maintainer-scm-write-persistence-contract');
const {createHermesMaintainerScmWriteDurableReceipt}=require('../core/hermes-maintainer-scm-write-durable-receipt');
const {buildHermesMaintainerScmWriteAttemptOwnershipPersistenceRequest}=require('../core/hermes-maintainer-scm-write-attempt-ownership-persistence-contract');
const {createHermesMaintainerScmWriteDurableAttemptOwnershipReceipt}=require('../core/hermes-maintainer-scm-write-durable-attempt-ownership-receipt');
const {bindHermesMaintainerScmWriteDurableOwnership}=require('../core/hermes-maintainer-scm-write-durable-ownership-binding');
const {prepareHermesMaintainerScmWriteDurableAdmissionHandoff}=require('../core/hermes-maintainer-scm-write-durable-admission-handoff');
const {grantHermesMaintainerScmWriteDurableCapability,CAPABILITY}=require('../core/hermes-maintainer-scm-write-durable-capability');
const {prepareHermesMaintainerGithubDurableCreateBranchRequest}=require('../core/hermes-maintainer-github-durable-create-branch-request');
const {admitHermesMaintainerGithubDurableWriteRequest}=require('../core/hermes-maintainer-github-durable-write-admission');
const {createHermesMaintainerScmWritePostgresPersistenceComposition}=require('../core/hermes-maintainer-scm-write-postgres-persistence-composition');
const {createHermesMaintainerScmWritePostgresAttemptOwnershipComposition}=require('../core/hermes-maintainer-scm-write-postgres-attempt-ownership-composition');

const COMPOSITION_VERSION='hermes_maintainer_github_write_operational_admission_composition_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const INPUT_FIELDS=Object.freeze(['admission_reference','attempt_reference','capability_reference','consumption_reference']);

function exactInput(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const keys=Object.keys(value).sort();
 return keys.length===INPUT_FIELDS.length&&keys.every((key,index)=>key===INPUT_FIELDS[index])&&INPUT_FIELDS.every((key)=>typeof value[key]==='string'&&value[key].trim()!=='');
}
function validGrant(grant,canary){
 const branch=typeof canary?.ref==='string'?canary.ref.replace(/^refs\/heads\//,''):null;
 return grant?.contract_version==='hermes_maintainer_scm_write_authorization_grant_v1'&&grant?.status==='SCM_WRITE_AUTHORIZATION_GRANTED'&&grant?.authorization_valid===true&&grant?.execution_authorized===true&&grant?.authorization_consumed===false&&grant?.operation==='create_branch'&&grant?.repository===REPOSITORY&&grant?.base_ref==='main'&&grant?.branch_name===branch;
}
function validCanary(canary){
 return canary?.contract_version==='hermes_maintainer_github_write_canary_contract_v1'&&canary?.status==='CANARY_PREPARED'&&canary?.canary_valid===true&&canary?.repository===REPOSITORY&&canary?.operation==='create_branch'&&canary?.execution_authorized===false&&canary?.network_call_performed===false&&canary?.write_performed===false&&canary?.production_used===false;
}
function blocked(reason){return Object.freeze({composition_version:COMPOSITION_VERSION,status:'OPERATIONAL_ADMISSION_BLOCKED',admission_valid:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([reason])});}

function createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool}={}){
 const consumption=createHermesMaintainerScmWritePostgresPersistenceComposition({pool});
 const ownership=createHermesMaintainerScmWritePostgresAttemptOwnershipComposition({pool});
 return Object.freeze({composition_version:COMPOSITION_VERSION,async prepare(grant,canary,input){
  if(!validCanary(canary))return blocked('CANARY_INVALID');
  if(!validGrant(grant,canary))return blocked('AUTHORIZATION_GRANT_SCOPE_INVALID');
  if(!exactInput(input))return blocked('OPERATIONAL_INPUT_INVALID');

  const consumed=consumeHermesMaintainerScmWriteAuthorization(grant,{intent_digest:grant.intent_digest,authorization_reference:grant.authorization_reference,consumption_reference:input.consumption_reference,already_consumed:false});
  const persistenceRequest=buildHermesMaintainerScmWritePersistenceRequest(consumed);
  const persistenceResult=await consumption.adapter.persist(persistenceRequest);
  const durableReceipt=createHermesMaintainerScmWriteDurableReceipt(persistenceRequest,persistenceResult);
  if(durableReceipt.receipt_valid!==true)return blocked('DURABLE_CONSUMPTION_NOT_CONFIRMED');

  const ownershipRequest=buildHermesMaintainerScmWriteAttemptOwnershipPersistenceRequest(durableReceipt,{attempt_reference:input.attempt_reference,intent_digest:durableReceipt.intent_digest,persistence_key:durableReceipt.persistence_key});
  const ownershipResult=await ownership.adapter.persist(ownershipRequest);
  const ownershipReceipt=createHermesMaintainerScmWriteDurableAttemptOwnershipReceipt(ownershipRequest,ownershipResult);
  const binding=bindHermesMaintainerScmWriteDurableOwnership(ownershipReceipt);
  if(binding.binding_valid!==true)return blocked('DURABLE_OWNERSHIP_NOT_CONFIRMED');

  const handoff=prepareHermesMaintainerScmWriteDurableAdmissionHandoff(binding,{operation:'create_branch',repository:REPOSITORY,base_ref:'main',base_sha:canary.sha,branch_name:canary.ref.replace(/^refs\/heads\//,'')});
  const capability=grantHermesMaintainerScmWriteDurableCapability(handoff,{decision:'GRANTED',capability:CAPABILITY,intent_digest:handoff.intent_digest,attempt_reference:handoff.attempt_reference,capability_reference:input.capability_reference});
  const request=prepareHermesMaintainerGithubDurableCreateBranchRequest(capability);
  return admitHermesMaintainerGithubDurableWriteRequest(request,{decision:'ADMITTED',intent_digest:request.intent_digest,attempt_reference:request.attempt_reference,capability_reference:request.capability_reference,ownership_key:request.ownership_key,admission_reference:input.admission_reference});
 }});
}
function preflightHermesMaintainerGithubWriteOperationalAdmission(grant,canary,input){if(!validCanary(canary))return blocked('CANARY_INVALID');if(!validGrant(grant,canary))return blocked('AUTHORIZATION_GRANT_SCOPE_INVALID');if(!exactInput(input))return blocked('OPERATIONAL_INPUT_INVALID');return Object.freeze({admission_preflight_valid:true});}
module.exports={COMPOSITION_VERSION,preflightHermesMaintainerGithubWriteOperationalAdmission,createHermesMaintainerGithubWriteOperationalAdmissionComposition};