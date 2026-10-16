'use strict';

const {createHermesMaintainerGithubWriteProcessRuntimeBinding}=require('./hermes-maintainer-github-write-process-runtime-binding');
const {createHermesMaintainerGithubWriteCanaryExecutionGuard}=require('../core/hermes-maintainer-github-write-canary-execution-guard');
const {
 ELIGIBLE:A3_ELIGIBLE,
 evaluateA3ScopedExternalActionEligibility
}=require('../core/a3-scoped-external-action-eligibility');

const RUNNER_VERSION='hermes_maintainer_github_write_canary_runtime_runner_v2';
const PREEXECUTION_GATE_VERSION='hermes_a3_maintainer_github_write_preexecution_gate_v1';
const PREEXECUTION_READY='A3_PREEXECUTION_READY';
const PREEXECUTION_BLOCKED='A3_PREEXECUTION_BLOCKED';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';

function uniqueSorted(values){return [...new Set(values)].sort();}

function a3BindingBlockers(eligibilityInput,eligibility,canary,admission){
 const blockers=[];
 if(eligibility?.status!==A3_ELIGIBLE||eligibility?.a3_eligible!==true)blockers.push('A3_ELIGIBILITY_INVALID');
 if(eligibility?.execution_authorized!==false||eligibility?.execution_started!==false||eligibility?.executed!==false||eligibility?.provider_invoked!==false||eligibility?.external_network_called!==false||eligibility?.production_allowed!==false||eligibility?.a4_authority_granted!==false)blockers.push('A3_ELIGIBILITY_STATE_INVALID');
 if(eligibility?.environment!=='staging'||canary?.environment!=='staging')blockers.push('A3_STAGING_BINDING_INVALID');
 if(eligibility?.operation!=='create_branch'||canary?.operation!=='create_branch')blockers.push('A3_OPERATION_BINDING_INVALID');
 const target=eligibilityInput?.target_reference;
 const branch=typeof canary?.ref==='string'?canary.ref.replace(/^refs\/heads\//,''):null;
 if(target?.repository!==REPOSITORY||target?.repository!==canary?.repository||target?.base_ref!=='main'||target?.branch_name!==branch||target?.base_sha!==canary?.sha)blockers.push('A3_TARGET_BINDING_MISMATCH');
 if(eligibility?.base_sha!==canary?.sha)blockers.push('A3_BASE_SHA_BINDING_MISMATCH');
 if(typeof eligibility?.action_intent_digest!=='string'||eligibility.action_intent_digest!==admission?.intent_digest)blockers.push('A3_ADMISSION_INTENT_BINDING_MISMATCH');
 return uniqueSorted(blockers);
}

function blockedPreflight(eligibility,blockers){
 return Object.freeze({
  gate_version:PREEXECUTION_GATE_VERSION,
  status:PREEXECUTION_BLOCKED,
  preexecution_ready:false,
  a3_eligible:eligibility?.a3_eligible===true,
  eligibility_id:typeof eligibility?.eligibility_id==='string'?eligibility.eligibility_id:null,
  eligibility_fingerprint:typeof eligibility?.eligibility_fingerprint==='string'?eligibility.eligibility_fingerprint:null,
  execution_authorized:false,
  execution_started:false,
  execution_performed:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze(uniqueSorted(blockers))
 });
}

function readyPreflight(eligibility){
 return Object.freeze({
  gate_version:PREEXECUTION_GATE_VERSION,
  status:PREEXECUTION_READY,
  preexecution_ready:true,
  a3_eligible:true,
  eligibility_id:eligibility.eligibility_id,
  eligibility_fingerprint:eligibility.eligibility_fingerprint,
  execution_authorized:false,
  execution_started:false,
  execution_performed:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([])
 });
}

function createHermesMaintainerGithubWriteCanaryRuntimeRunner({environment,fetchImpl,createTimeoutSignal,timeoutMs}={}){
 if(!environment||typeof environment!=='object')throw new TypeError('environment_required');
 if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl_required');
 if(typeof createTimeoutSignal!=='function')throw new TypeError('createTimeoutSignal_required');
 const runtime=createHermesMaintainerGithubWriteProcessRuntimeBinding({environment,fetchImpl,createTimeoutSignal,timeoutMs});
 const guard=createHermesMaintainerGithubWriteCanaryExecutionGuard({execute:runtime.execute});
 const validationGuard=createHermesMaintainerGithubWriteCanaryExecutionGuard({execute:async()=>Object.freeze({status:'CANARY_EXECUTION_ADMISSIBLE'})});

 async function preflight(eligibilityInput,canary,admission){
  const eligibility=evaluateA3ScopedExternalActionEligibility(eligibilityInput);
  const blockers=a3BindingBlockers(eligibilityInput,eligibility,canary,admission);
  if(blockers.length)return blockedPreflight(eligibility,blockers);
  const guardValidation=await validationGuard.execute(canary,admission);
  if(guardValidation?.status!=='CANARY_EXECUTION_ADMISSIBLE'){
   return blockedPreflight(eligibility,['A3_CANARY_ADMISSION_GUARD_BLOCKED',...(Array.isArray(guardValidation?.blockers)?guardValidation.blockers:[])]);
  }
  return readyPreflight(eligibility);
 }

 return Object.freeze({
  runner_version:RUNNER_VERSION,
  preexecution_gate_version:PREEXECUTION_GATE_VERSION,
  environment:'staging',
  credential_reference:runtime.credential_reference,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  preflight,
  execute:async(eligibilityInput,canary,admission)=>{
   const readiness=await preflight(eligibilityInput,canary,admission);
   if(readiness.preexecution_ready!==true){
    return Object.freeze({
     gate_version:PREEXECUTION_GATE_VERSION,
     status:'CANARY_EXECUTION_BLOCKED',
     execution_performed:false,
     network_call_performed:false,
     write_performed:false,
     production_used:false,
     blockers:readiness.blockers
    });
   }
   return guard.execute(canary,admission);
  }
 });
}

module.exports={
 PREEXECUTION_BLOCKED,
 PREEXECUTION_GATE_VERSION,
 PREEXECUTION_READY,
 RUNNER_VERSION,
 createHermesMaintainerGithubWriteCanaryRuntimeRunner
};
