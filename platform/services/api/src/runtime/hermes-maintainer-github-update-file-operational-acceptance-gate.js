'use strict';
const {createHermesMaintainerGithubUpdateFileE2eDurableClosure}=require('./hermes-maintainer-github-update-file-e2e-durable-closure');
const VERSION='hermes_maintainer_github_update_file_operational_acceptance_gate_v1';
function createHermesMaintainerGithubUpdateFileOperationalAcceptanceGate(deps={}){
 const closure=createHermesMaintainerGithubUpdateFileE2eDurableClosure(deps);
 return Object.freeze({acceptance_version:VERSION,environment:'staging',credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,async execute(grant,target,input){
  const result=await closure.execute(grant,target,input);
  const accepted=result?.status==='UPDATE_FILE_E2E_DURABLE_CLOSURE_CONFIRMED'&&result?.closure_valid===true&&result?.durable===true&&result?.network_call_performed===true&&result?.write_performed===true&&result?.production_used===false&&result?.execution?.provider_status===200&&result?.receipt?.receipt_valid===true;
  return Object.freeze({acceptance_version:VERSION,status:accepted?'OPERATIONAL_ACCEPTANCE_CONFIRMED':'OPERATIONAL_ACCEPTANCE_BLOCKED',accepted,durable:accepted,environment:'staging',network_call_performed:result?.network_call_performed===true,write_performed:result?.write_performed===true,production_used:false,execution_status:result?.execution?.status||null,provider_status:result?.execution?.provider_status||null,previous_blob_sha:result?.execution?.previous_blob_sha||null,new_blob_sha:result?.execution?.new_blob_sha||null,commit_sha:result?.execution?.commit_sha||null,receipt_status:result?.receipt?.status||null,blockers:Object.freeze(accepted?[]:['E2E_DURABLE_CLOSURE_NOT_CONFIRMED'])});
 }});
}
module.exports={VERSION,createHermesMaintainerGithubUpdateFileOperationalAcceptanceGate};
