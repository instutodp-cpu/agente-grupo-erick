'use strict';

const {createHermesMaintainerGithubWriteOperationalAdmissionComposition}=require('./hermes-maintainer-github-write-operational-admission-composition');
const {createHermesMaintainerGithubWriteCanaryRuntimeRunner}=require('./hermes-maintainer-github-write-canary-runtime-runner');
const {createHermesMaintainerGithubWriteOperationalFinalizationComposition}=require('./hermes-maintainer-github-write-operational-finalization-composition');

const COMPOSITION_VERSION='hermes_maintainer_github_write_e2e_durable_closure_v1';

function blocked(reason,execution){
 return Object.freeze({composition_version:COMPOSITION_VERSION,status:'E2E_DURABLE_WRITE_CLOSURE_BLOCKED',closure_valid:false,durable:false,execution:execution||null,receipt:null,production_used:false,blockers:Object.freeze([reason])});
}

function createHermesMaintainerGithubWriteE2eDurableClosure({pool,environment,fetchImpl,createTimeoutSignal,timeoutMs}={}){
 const admission=createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool});
 const runner=createHermesMaintainerGithubWriteCanaryRuntimeRunner({environment,fetchImpl,createTimeoutSignal,timeoutMs});
 const finalization=createHermesMaintainerGithubWriteOperationalFinalizationComposition({pool});
 return Object.freeze({
  composition_version:COMPOSITION_VERSION,
  environment:'staging',
  credential_reference:runner.credential_reference,
  credential_material_present:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  async execute(grant,canary,input){
   const durableAdmission=await admission.prepare(grant,canary,input);
   if(durableAdmission?.contract_version!=='hermes_maintainer_github_durable_write_admission_v1'||durableAdmission?.status!=='GITHUB_DURABLE_WRITE_REQUEST_ADMITTED'||durableAdmission?.admission_valid!==true||durableAdmission?.execution_authorized!==true)return blocked('DURABLE_ADMISSION_NOT_CONFIRMED');
   const execution=await runner.execute(canary,durableAdmission);
   if(execution?.status!=='GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED'||execution?.execution_performed!==true||execution?.network_call_performed!==true||execution?.write_performed!==true||execution?.production_used!==false)return blocked('EXECUTION_NOT_CONFIRMED',execution);
   const closed=await finalization.finalize(durableAdmission,execution);
   if(closed?.status!=='OPERATIONAL_WRITE_FINALIZATION_CONFIRMED'||closed?.finalization_valid!==true||closed?.durable!==true||closed?.receipt?.receipt_valid!==true)return blocked('DURABLE_FINALIZATION_NOT_CONFIRMED',execution);
   return Object.freeze({composition_version:COMPOSITION_VERSION,status:'E2E_DURABLE_WRITE_CLOSURE_CONFIRMED',closure_valid:true,durable:true,execution,receipt:closed.receipt,network_call_performed:true,write_performed:true,production_used:false,blockers:Object.freeze([])});
  }
 });
}

module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubWriteE2eDurableClosure};
