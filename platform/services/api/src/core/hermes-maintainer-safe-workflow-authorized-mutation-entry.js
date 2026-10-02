'use strict';
const {bindHermesMaintainerSafeWorkflowAuthorityEvidence}=require('./hermes-maintainer-safe-workflow-authority-evidence-binding');
const {requireHermesMaintainerSafeWorkflowAuthorizedComposition}=require('./hermes-maintainer-safe-workflow-authorized-composition-requirement');
const {prepareHermesMaintainerSafeWorkflowAuthorizedCompositionHandoff}=require('./hermes-maintainer-safe-workflow-authorized-composition-handoff');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_authorized_mutation_entry_v1';
function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_BLOCKED',completed:false,stage,value:value||null,receipt:null,merge_authority:false,human_merge_required:true});}
function createHermesMaintainerSafeWorkflowAuthorizedMutationEntry({mutationOrchestration}={}){
 if(typeof mutationOrchestration?.execute!=='function')throw new TypeError('mutationOrchestration_required');
 return Object.freeze({contract_version:CONTRACT_VERSION,async execute(authorityRequirement,authorityEvidence,mutationInput){
  const evidence=bindHermesMaintainerSafeWorkflowAuthorityEvidence(authorityRequirement,authorityEvidence);if(!evidence.authority_evidence_bound)return blocked('authority_evidence',evidence);
  const requirement=requireHermesMaintainerSafeWorkflowAuthorizedComposition(evidence);if(!requirement.authorized_composition_prepared)return blocked('authorized_composition_requirement',requirement);
  const handoff=prepareHermesMaintainerSafeWorkflowAuthorizedCompositionHandoff(requirement);if(!handoff.authorized_composition_handoff_prepared)return blocked('authorized_composition_handoff',handoff);
  const mutation=await mutationOrchestration.execute(handoff,mutationInput);if(mutation.status!=='MAINTAINER_SAFE_WORKFLOW_MUTATION_COMPLETED')return blocked('mutation',mutation);
  return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_COMPLETED',completed:true,stage:'completed',operation:mutation.operation,receipt:mutation.receipt,production_used:false,merge_authority:false,human_merge_required:true});
 }});
}
module.exports={CONTRACT_VERSION,createHermesMaintainerSafeWorkflowAuthorizedMutationEntry};
