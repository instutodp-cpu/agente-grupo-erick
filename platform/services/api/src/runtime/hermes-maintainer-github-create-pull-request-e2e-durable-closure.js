'use strict';
const {createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition}=require('./hermes-maintainer-github-create-pull-request-operational-admission-composition');
const {createHermesMaintainerGithubCreatePullRequestRuntimeComposition}=require('./hermes-maintainer-github-create-pull-request-runtime-composition');
const {createHermesMaintainerGithubCreatePullRequestOperationalFinalizationComposition}=require('./hermes-maintainer-github-create-pull-request-operational-finalization-composition');
const COMPOSITION_VERSION='hermes_maintainer_github_create_pull_request_e2e_durable_closure_v1';
function blocked(reason,execution,finalization){return Object.freeze({composition_version:COMPOSITION_VERSION,status:'CREATE_PULL_REQUEST_E2E_DURABLE_CLOSURE_BLOCKED',closure_valid:false,durable:false,execution:execution||null,finalization:finalization||null,receipt:null,network_call_performed:execution?.network_call_performed===true,write_performed:execution?.write_performed===true,production_used:false,blockers:Object.freeze([reason])});}
function createHermesMaintainerGithubCreatePullRequestE2eDurableClosure({pool,environment,fetchImpl,createTimeoutSignal,timeoutMs}={}){
 const admission=createHermesMaintainerGithubCreatePullRequestOperationalAdmissionComposition({pool});
 const runtime=createHermesMaintainerGithubCreatePullRequestRuntimeComposition({environment,fetchImpl,createTimeoutSignal,timeoutMs});
 const finalization=createHermesMaintainerGithubCreatePullRequestOperationalFinalizationComposition({pool});
 return Object.freeze({composition_version:COMPOSITION_VERSION,environment:'staging',credential_reference:runtime.credential_reference,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,async execute(grant,target,input){
  const durableAdmission=await admission.prepare(grant,target,input);
  if(durableAdmission?.contract_version!=='hermes_maintainer_github_create_pull_request_durable_admission_v1'||durableAdmission?.status!=='GITHUB_CREATE_PULL_REQUEST_DURABLE_REQUEST_ADMITTED'||durableAdmission?.admission_valid!==true||durableAdmission?.execution_authorized!==true)return blocked('DURABLE_ADMISSION_NOT_CONFIRMED');
  const execution=await runtime.execute(durableAdmission);
  if(execution?.status!=='GITHUB_CREATE_PULL_REQUEST_DURABLE_EXECUTION_SUCCEEDED'||execution?.execution_performed!==true||execution?.network_call_performed!==true||execution?.write_performed!==true||execution?.production_used!==false||execution?.provider_status!==201||!Number.isInteger(execution?.pull_request_number)||execution.pull_request_number<1||execution?.pull_request_url!==`https://github.com/instutodp-cpu/agente-grupo-erick/pull/${execution.pull_request_number}`)return blocked('EXECUTION_NOT_CONFIRMED',execution);
  const closed=await finalization.finalize(durableAdmission,execution);
  if(closed?.status!=='CREATE_PULL_REQUEST_OPERATIONAL_FINALIZATION_CONFIRMED'||closed?.finalization_valid!==true||closed?.durable!==true||closed?.receipt?.receipt_valid!==true)return blocked('DURABLE_FINALIZATION_NOT_CONFIRMED',execution,closed);
  return Object.freeze({composition_version:COMPOSITION_VERSION,status:'CREATE_PULL_REQUEST_E2E_DURABLE_CLOSURE_CONFIRMED',closure_valid:true,durable:true,execution,receipt:closed.receipt,network_call_performed:true,write_performed:true,production_used:false,blockers:Object.freeze([])});
 }});
}
module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubCreatePullRequestE2eDurableClosure};
