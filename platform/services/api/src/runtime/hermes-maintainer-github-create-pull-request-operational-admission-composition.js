'use strict';
const {consumeHermesMaintainerScmWriteAuthorization}=require('../core/hermes-maintainer-scm-write-authorization-consumption');
const {buildHermesMaintainerScmWritePersistenceRequest}=require('../core/hermes-maintainer-scm-write-persistence-contract');
const {createHermesMaintainerScmWriteDurableReceipt}=require('../core/hermes-maintainer-scm-write-durable-receipt');
const {buildHermesMaintainerScmWriteAttemptOwnershipPersistenceRequest}=require('../core/hermes-maintainer-scm-write-attempt-ownership-persistence-contract');
const {createHermesMaintainerScmWriteDurableAttemptOwnershipReceipt}=require('../core/hermes-maintainer-scm-write-durable-attempt-ownership-receipt');
const {bindHermesMaintainerScmWriteDurableOwnership}=require('../core/hermes-maintainer-scm-write-durable-ownership-binding');
const {prepareHermesMaintainerGithubCreatePullRequestDurableAdmissionHandoff}=require('../core/hermes-maintainer-github-create-pull-request-durable-admission-handoff');
const {grantHermesMaintainerGithubCreatePullRequestCapability,CAPABILITY}=require('../core/hermes-maintainer-github-create-pull-request-capability');
const {prepareHermesMaintainerGithubCreatePullRequestRequest}=require('../core/hermes-maintainer-github-create-pull-request-request');
const {admitHermesMaintainerGithubCreatePullRequestRequest}=require('../core/hermes-maintainer-github-create-pull-request-admission');
const {admitHermesMaintainerGithubCreatePullRequestDurableRequest}=require('../core/hermes-maintainer-github-create-pull-request-durable-admission');
const {createHermesMaintainerScmWritePostgresPersistenceComposition}=require('../core/hermes-maintainer-scm-write-postgres-persistence-composition');
const {createHermesMaintainerScmWritePostgresAttemptOwnershipComposition}=require('../core/hermes-maintainer-scm-write-postgres-attempt-ownership-composition');
const COMPOSITION_VERSION='hermes_maintainer_github_create_pull_request_operational_admission_composition_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick',BASE='main';
function blocked(reason){return Object.freeze({composition_version:COMPOSITION_VERSION,status:'CREATE_PULL_REQUEST_OPERATIONAL_ADMISSION_BLOCKED',admission_valid:false,execution_authorized:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([reason])});}
function validGrant(g,target){return g?.contract_version==='hermes_maintainer_scm_write_authorization_grant_v1'&&g?.status==='SCM_WRITE_AUTHORIZATION_GRANTED'&&g?.authorization_valid===true&&g?.execution_authorized===true&&g?.authorization_consumed===false&&g?.operation==='create_pull_request'&&g?.repository===REPOSITORY&&g?.base===BASE&&g?.head===target?.head&&g?.draft===true;}
function validInput(i){return i&&typeof i==='object'&&['consumption_reference','attempt_reference','capability_reference','admission_reference','title','body'].every(k=>typeof i[k]==='string'&&i[k].length>0);}
function createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition({pool}={}){
 const consumption=createHermesMaintainerScmWritePostgresPersistenceComposition({pool});
 const ownership=createHermesMaintainerScmWritePostgresAttemptOwnershipComposition({pool});
 return Object.freeze({composition_version:COMPOSITION_VERSION,async prepare(grant,target,input){
  if(!target||target.repository!==REPOSITORY||target.operation!=='create_pull_request'||target.base!==BASE||target.draft!==true||typeof target.head!=='string')return blocked('TARGET_INVALID');
  if(!validGrant(grant,target))return blocked('AUTHORIZATION_GRANT_SCOPE_INVALID');
  if(!validInput(input))return blocked('OPERATIONAL_INPUT_INVALID');
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
  const handoff=prepareHermesMaintainerGithubCreatePullRequestDurableAdmissionHandoff(binding,target);
  if(handoff.handoff_valid!==true)return blocked('CREATE_PULL_REQUEST_HANDOFF_INVALID');
  const capability=grantHermesMaintainerGithubCreatePullRequestCapability({decision:'GRANTED',capability:CAPABILITY,capability_reference:input.capability_reference,intent_digest:handoff.intent_digest,attempt_reference:handoff.attempt_reference},{repository:REPOSITORY,base:BASE,head:handoff.head,draft:true});
  const request=prepareHermesMaintainerGithubCreatePullRequestRequest({repository:REPOSITORY,base:BASE,head:handoff.head,draft:true,title:input.title,body:input.body});
  const admission=admitHermesMaintainerGithubCreatePullRequestRequest(capability,request,{decision:'ADMITTED',intent_digest:capability.intent_digest,attempt_reference:capability.attempt_reference,capability_reference:capability.capability_reference,admission_reference:input.admission_reference});
  return admitHermesMaintainerGithubCreatePullRequestDurableRequest(admission,{decision:'OWNED',persistence_key:binding.persistence_key,ownership_key:binding.ownership_key,intent_digest:binding.intent_digest,attempt_reference:binding.attempt_reference});
 }});
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition};
