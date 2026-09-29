'use strict';
const {buildHermesMaintainerGithubUpdateFileExecutionOutcomeReceipt}=require('../core/hermes-maintainer-github-update-file-execution-outcome-receipt');
const {buildHermesMaintainerGithubUpdateFileExecutionOutcomePersistenceRequest}=require('../core/hermes-maintainer-github-update-file-execution-outcome-persistence-contract');
const {createHermesMaintainerGithubUpdateFileExecutionOutcomePostgresPersistenceComposition}=require('../core/hermes-maintainer-github-update-file-execution-outcome-postgres-persistence-composition');
const {createHermesMaintainerGithubUpdateFileDurableExecutionOutcomeReceipt}=require('../core/hermes-maintainer-github-update-file-durable-execution-outcome-receipt');
const {buildHermesMaintainerGithubUpdateFileDurableFinalization}=require('../core/hermes-maintainer-github-update-file-durable-finalization-contract');
const {buildHermesMaintainerGithubUpdateFileFinalizationPersistenceRequest}=require('../core/hermes-maintainer-github-update-file-finalization-persistence-contract');
const {createHermesMaintainerGithubUpdateFileFinalizationPostgresPersistenceComposition}=require('../core/hermes-maintainer-github-update-file-finalization-postgres-persistence-composition');
const {createHermesMaintainerGithubUpdateFileDurableFinalizationReceipt}=require('../core/hermes-maintainer-github-update-file-durable-finalization-receipt');
const COMPOSITION_VERSION='hermes_maintainer_github_update_file_operational_finalization_composition_v1';
function blocked(reason){return Object.freeze({composition_version:COMPOSITION_VERSION,status:'UPDATE_FILE_OPERATIONAL_FINALIZATION_BLOCKED',finalization_valid:false,durable:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([reason])});}
function createHermesMaintainerGithubUpdateFileOperationalFinalizationComposition({pool}={}){
 const outcomePersistence=createHermesMaintainerGithubUpdateFileExecutionOutcomePostgresPersistenceComposition({pool});
 const finalizationPersistence=createHermesMaintainerGithubUpdateFileFinalizationPostgresPersistenceComposition({pool});
 return Object.freeze({composition_version:COMPOSITION_VERSION,async finalize(admission,execution){
  const outcome=buildHermesMaintainerGithubUpdateFileExecutionOutcomeReceipt(admission,execution);
  if(outcome.receipt_valid!==true)return blocked('EXECUTION_OUTCOME_NOT_CONFIRMED');
  const outcomeRequest=buildHermesMaintainerGithubUpdateFileExecutionOutcomePersistenceRequest(outcome);
  const outcomeResult=await outcomePersistence.adapter.persist(outcomeRequest);
  const durableOutcome=createHermesMaintainerGithubUpdateFileDurableExecutionOutcomeReceipt(outcomeRequest,outcomeResult);
  if(durableOutcome.receipt_valid!==true)return blocked('DURABLE_OUTCOME_NOT_CONFIRMED');
  const finalization=buildHermesMaintainerGithubUpdateFileDurableFinalization(durableOutcome);
  if(finalization.finalization_valid!==true)return blocked('FINALIZATION_NOT_PREPARED');
  const finalizationRequest=buildHermesMaintainerGithubUpdateFileFinalizationPersistenceRequest(finalization);
  const finalizationResult=await finalizationPersistence.adapter.persist(finalizationRequest);
  const receipt=createHermesMaintainerGithubUpdateFileDurableFinalizationReceipt(finalizationRequest,finalizationResult);
  if(receipt.receipt_valid!==true)return blocked('DURABLE_FINALIZATION_NOT_CONFIRMED');
  return Object.freeze({composition_version:COMPOSITION_VERSION,status:'UPDATE_FILE_OPERATIONAL_FINALIZATION_CONFIRMED',finalization_valid:true,durable:true,receipt,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([])});
 }});
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubUpdateFileOperationalFinalizationComposition};
