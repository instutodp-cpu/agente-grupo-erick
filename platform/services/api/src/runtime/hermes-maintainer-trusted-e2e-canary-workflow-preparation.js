'use strict';

const { bridgeHermesMaintainerOperationalAuthorityEvidence } = require('../core/hermes-maintainer-operational-authority-evidence-bridge');
const { prepareHermesMaintainerScmWriteDurableAdmissionHandoff } = require('../core/hermes-maintainer-scm-write-durable-admission-handoff');
const { prepareHermesMaintainerGithubUpdateFileDurableAdmissionHandoff } = require('../core/hermes-maintainer-github-update-file-durable-admission-handoff');
const { prepareHermesMaintainerGithubCreatePullRequestDurableAdmissionHandoff } = require('../core/hermes-maintainer-github-create-pull-request-durable-admission-handoff');

const CONTRACT_VERSION='hermes_maintainer_trusted_e2e_canary_workflow_preparation_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';

function blocked(stage,value){return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_TRUSTED_E2E_CANARY_WORKFLOW_PREPARATION_BLOCKED',prepared:false,stage,value:value||null,workflow:null,production_used:false,merge_authority:false,human_merge_required:true});}

function prepareMutation(controlledExecution,target,admission,grant,requestInput){
 const bridge=bridgeHermesMaintainerOperationalAuthorityEvidence(admission,grant);
 if(bridge.bridge_valid!==true)return {ok:false,value:bridge};
 let durableHandoff=null;
 if(admission.operation==='create_branch')durableHandoff=prepareHermesMaintainerScmWriteDurableAdmissionHandoff(bridge.ownership,target);
 else if(admission.operation==='update_file')durableHandoff=prepareHermesMaintainerGithubUpdateFileDurableAdmissionHandoff(bridge.ownership,target);
 else if(admission.operation==='create_pull_request')durableHandoff=prepareHermesMaintainerGithubCreatePullRequestDurableAdmissionHandoff(bridge.ownership,target);
 if(durableHandoff?.handoff_valid!==true)return {ok:false,value:durableHandoff};
 const capabilityGrant=Object.freeze({decision:'GRANTED',capability:bridge.authority_evidence.capability,intent_digest:bridge.authority_evidence.intent_digest,attempt_reference:bridge.authority_evidence.attempt_reference,capability_reference:bridge.authority_evidence.capability_reference});
 const mutationInput=Object.freeze({durable_handoff:durableHandoff,grant:capabilityGrant,target,request_input:requestInput||null,admission_reference:admission.admission_reference,ownership:bridge.ownership});
 return {ok:true,value:Object.freeze({controlled_execution:controlledExecution,ownership:bridge.ownership,target,authority_evidence:bridge.authority_evidence,mutation_input:mutationInput})};
}

function prepareHermesMaintainerTrustedE2eCanaryWorkflow(input={}){
 if(!input.repository_read)return blocked('repository_read_missing');
 const branch=prepareMutation(input.branch?.controlled_execution,input.branch?.target,input.branch?.admission,input.branch?.grant,input.branch?.mutation_input);
 if(!branch.ok)return blocked('branch_authority_bridge',branch.value);
 const edit=prepareMutation(input.edit?.controlled_execution,input.edit?.target,input.edit?.admission,input.edit?.grant,input.edit?.mutation_input);
 if(!edit.ok)return blocked('edit_authority_bridge',edit.value);
 const pull=prepareMutation(input.pull_request?.controlled_execution,input.pull_request?.target,input.pull_request?.admission,input.pull_request?.grant,input.pull_request?.mutation_input);
 if(!pull.ok)return blocked('pull_request_authority_bridge',pull.value);

 for(const [name,item,operation] of [['branch',branch.value,'create_branch'],['edit',edit.value,'update_file'],['pull_request',pull.value,'create_pull_request']]){
  if(item.target?.repository!==REPOSITORY || item.target?.operation!==operation) return blocked(name+'_target_invalid',item.target);
 }
 if(branch.value.target?.branch_name!==edit.value.target?.branch || branch.value.target?.branch_name!==pull.value.target?.head || pull.value.target?.base!=='main' || pull.value.target?.draft!==true) return blocked('workflow_target_chain_invalid');

 return Object.freeze({
  contract_version:CONTRACT_VERSION,status:'MAINTAINER_TRUSTED_E2E_CANARY_WORKFLOW_PREPARED',prepared:true,stage:'prepared',
  workflow:Object.freeze({
   repository_read:input.repository_read,
   branch_prepare:Object.freeze({controlled_execution:branch.value.controlled_execution,ownership:branch.value.ownership,target:branch.value.target,authority_evidence:branch.value.authority_evidence,mutation_input:branch.value.mutation_input}),
   code_edit_prepare:Object.freeze({controlled_execution:edit.value.controlled_execution,ownership:edit.value.ownership,target:edit.value.target,authority_evidence:edit.value.authority_evidence,mutation_input:edit.value.mutation_input}),
   pull_request_prepare:Object.freeze({controlled_execution:pull.value.controlled_execution,ownership:pull.value.ownership,target:pull.value.target,authority_evidence:pull.value.authority_evidence,mutation_input:pull.value.mutation_input})
  }),
  production_used:false,merge_authority:false,human_merge_required:true
 });
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerTrustedE2eCanaryWorkflow};