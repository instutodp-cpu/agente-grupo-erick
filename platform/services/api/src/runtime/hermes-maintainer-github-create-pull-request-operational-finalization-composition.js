'use strict';
const {captureHermesMaintainerGithubCreatePullRequestExecutionOutcome}=require('../core/hermes-maintainer-github-create-pull-request-execution-outcome');
const {buildHermesMaintainerGithubCreatePullRequestExecutionOutcomePersistenceRequest}=require('../core/hermes-maintainer-github-create-pull-request-execution-outcome-persistence-contract');
const {createHermesMaintainerGithubCreatePullRequestExecutionOutcomePostgresPersistenceComposition}=require('../core/hermes-maintainer-github-create-pull-request-execution-outcome-postgres-persistence-composition');
const {createHermesMaintainerGithubCreatePullRequestDurableExecutionOutcomeReceipt}=require('../core/hermes-maintainer-github-create-pull-request-durable-execution-outcome-receipt');
const {buildHermesMaintainerGithubCreatePullRequestDurableFinalization}=require('../core/hermes-maintainer-github-create-pull-request-durable-finalization-contract');
const {buildHermesMaintainerGithubCreatePullRequestFinalizationPersistenceRequest}=require('../core/hermes-maintainer-github-create-pull-request-finalization-persistence-contract');
const {createHermesMaintainerGithubCreatePullRequestFinalizationPostgresPersistenceComposition}=require('../core/hermes-maintainer-github-create-pull-request-finalization-postgres-persistence-composition');
const {createHermesMaintainerGithubCreatePullRequestDurableFinalizationReceipt}=require('../core/hermes-maintainer-github-create-pull-request-durable-finalization-receipt');

const COMPOSITION_VERSION='hermes_maintainer_github_create_pull_request_operational_finalization_composition_v1';
function blocked(reason){return Object.freeze({composition_version:COMPOSITION_VERSION,status:'CREATE_PULL_REQUEST_OPERATIONAL_FINALIZATION_BLOCKED',finalization_valid:false,durable:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([reason])});}

function createHermesMaintainerGithubCreatePullRequestOperationalFinalizationComposition({pool}={}){
 const outcomePersistence=createHermesMaintainerGithubCreatePullRequestExecutionOutcomePostgresPersistenceComposition({pool});
 const finalizationPersistence=createHermesMaintainerGithubCreatePullRequestFinalizationPostgresPersistenceComposition({pool});
 return Object.freeze({composition_version:COMPOSITION_VERSION,async finalize(admission,execution){
  const outcome=captureHermesMaintainerGithubCreatePullRequestExecutionOutcome(execution,{repository:admission?.repository,base:admission?.base,head:admission?.head,draft:admission?.draft,intent_digest:admission?.intent_digest,attempt_reference:admission?.attempt_reference,admission_reference:admission?.admission_reference});
  if(outcome.outcome_valid!==true)return blocked('EXECUTION_OUTCOME_NOT_CONFIRMED');
  const outcomeRequest=buildHermesMaintainerGithubCreatePullRequestExecutionOutcomePersistenceRequest(outcome);
  const outcomeResult=await outcomePersistence.adapter.persist(outcomeRequest);
  const durableOutcome=createHermesMaintainerGithubCreatePullRequestDurableExecutionOutcomeReceipt(outcomeRequest,outcomeResult);
  if(durableOutcome.receipt_valid!==true)return blocked('DURABLE_OUTCOME_NOT_CONFIRMED');
  const finalization=buildHermesMaintainerGithubCreatePullRequestDurableFinalization(durableOutcome);
  if(finalization.finalization_valid!==true)return blocked('FINALIZATION_NOT_PREPARED');
  const finalizationRequest=buildHermesMaintainerGithubCreatePullRequestFinalizationPersistenceRequest(finalization);
  const finalizationResult=await finalizationPersistence.adapter.persist(finalizationRequest);
  const receipt=createHermesMaintainerGithubCreatePullRequestDurableFinalizationReceipt(finalizationRequest,finalizationResult);
  if(receipt.receipt_valid!==true)return blocked('DURABLE_FINALIZATION_NOT_CONFIRMED');
  return Object.freeze({composition_version:COMPOSITION_VERSION,status:'CREATE_PULL_REQUEST_OPERATIONAL_FINALIZATION_CONFIRMED',finalization_valid:true,durable:true,receipt,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([])});
 }});
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubCreatePullRequestOperationalFinalizationComposition};
