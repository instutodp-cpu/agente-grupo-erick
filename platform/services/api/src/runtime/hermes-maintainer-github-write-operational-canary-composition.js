'use strict';

const {createHermesMaintainerGithubWriteOperationalAdmissionComposition}=require('./hermes-maintainer-github-write-operational-admission-composition');
const {createHermesMaintainerGithubWriteCanaryRuntimeRunner}=require('./hermes-maintainer-github-write-canary-runtime-runner');

const COMPOSITION_VERSION='hermes_maintainer_github_write_operational_canary_composition_v1';

function createHermesMaintainerGithubWriteOperationalCanaryComposition({pool,environment,fetchImpl,createTimeoutSignal}={}){
 const admission=createHermesMaintainerGithubWriteOperationalAdmissionComposition({pool});
 const runner=createHermesMaintainerGithubWriteCanaryRuntimeRunner({environment,fetchImpl,createTimeoutSignal});
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
   if(durableAdmission?.contract_version!=='hermes_maintainer_github_durable_write_admission_v1'||durableAdmission?.status!=='GITHUB_DURABLE_WRITE_REQUEST_ADMITTED'||durableAdmission?.admission_valid!==true||durableAdmission?.execution_authorized!==true){
    return Object.freeze({composition_version:COMPOSITION_VERSION,status:'OPERATIONAL_CANARY_EXECUTION_BLOCKED',execution_performed:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze(['DURABLE_ADMISSION_NOT_CONFIRMED'])});
   }
   return runner.execute(canary,durableAdmission);
  }
 });
}

module.exports={COMPOSITION_VERSION,createHermesMaintainerGithubWriteOperationalCanaryComposition};
