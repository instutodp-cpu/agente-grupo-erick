'use strict';

const {buildHermesMaintainerGithubWriteExecutionOutcomeReceipt}=require('../core/hermes-maintainer-github-write-execution-outcome-receipt');
const {buildHermesMaintainerGithubWriteExecutionOutcomePersistenceRequest}=require('../core/hermes-maintainer-github-write-execution-outcome-persistence-contract');
const {createHermesMaintainerGithubWriteExecutionOutcomePostgresPersistenceComposition}=require('../core/hermes-maintainer-github-write-execution-outcome-postgres-persistence-composition');
const {createHermesMaintainerGithubWriteDurableExecutionOutcomeReceipt}=require('../core/hermes-maintainer-github-write-durable-execution-outcome-receipt');
const {buildHermesMaintainerGithubWriteDurableFinalization}=require('../core/hermes-maintainer-github-write-durable-finalization-contract');
const {buildHermesMaintainerGithubWriteFinalizationPersistenceRequest}=require('../core/hermes-maintainer-github-write-finalization-persistence-contract');
const {createHermesMaintainerGithubWriteFinalizationPostgresPersistenceComposition}=require('../core/hermes-maintainer-github-write-finalization-postgres-persistence-composition');
const {createHermesMaintainerGithubWriteDurableFinalizationReceipt}=require('../core/hermes-maintainer-github-write-durable-finalization-receipt');

const COMPOSITION_VERSION='hermes_maintainer_github_write_operational_finalization_composition_v1';

function blocked(reason){return Object.freeze({composition_version:COMPOSITION_VERSION,status:'OPERATIONAL_WRITE_FINALIZATION_BLOCKED',finalization_valid:false,durable:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([reason])});}

function createHermesMaintainerGithubWriteOperationalFinalizationComposition({pool}={}){
 const outcomePersistence=createHermesMaintainerGithubWriteExecutionOutcomePostgresPersistenceComposition({pool});
 const finalizationPersistence=createHermesMaintainerGithubWriteFinalizationPostgresPersistenceComposition({pool});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  async finalize(admission,execution){
   const outcome=buildHermesMaintainerGithubWriteExecutionOutcomeReceipt(admission,execution);
   if(outcome.receipt_valid!==true)return blocked('EXECUTION_OUTCOME_NOT_CONFIRMED');
   const outcomeRequest=buildHermesMaintainerGithubWriteExecutionOutcomePersistenceRequest(outcome);
   const outcomeResult=await outcomePersistence.adapter.persist(outcomeRequest);
   const durableOutcome=createHermesMaintainerGithubWriteDurableExecutionOutcomeReceipt(outcomeRequest,outcomeResult);
   if(durableOutcome.receipt_valid!==true)return blocked('DURABLE_OUTCOME_NOT_CONFIRMED');
   const finalization=buildHermesMaintainerGithubWriteDurableFinalization(durableOutcome);
   if(finalization.finalization_valid!==true)return blocked('FINALIZATION_NOT_PREPARED');
   const finalizationRequest=buildHermesMaintainerGithubWriteFinalizationPersistenceRequest(finalization);
   const finalizationResult=await finalizationPersistence.adapter.persist(finalizationRequest);
   const receipt=createHermesMaintainerGithubWriteDurableFinalizationReceipt(finalizationRequest,finalizationResult);
   if(receipt.receipt_valid!==true)return blocked('DURABLE_FINALIZATION_NOT_CONFIRMED');
   return Object.freeze({composition_version:COMPOSITION_VERSION,status:'OPERATIONAL_WRITE_FINALIZATION_CONFIRMED',finalization_valid:true,durable:true,receipt,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([])});
  }
 });
}

module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubWriteOperationalFinalizationComposition};
