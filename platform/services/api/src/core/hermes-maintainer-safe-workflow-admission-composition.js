'use strict';
const {isNonEmptyString,isPlainObject,uniqueSorted}=require('./read-only-adapter-contract');
const {validateHermesMaintainerSafeWorkflowRequestComposition}=require('./hermes-maintainer-safe-workflow-request-composition');
const {validateHermesMaintainerSafeWorkflowCapabilityComposition}=require('./hermes-maintainer-safe-workflow-capability-composition');
const {admitHermesMaintainerGithubDurableWriteRequest}=require('./hermes-maintainer-github-durable-write-admission');
const {admitHermesMaintainerGithubUpdateFileRequest}=require('./hermes-maintainer-github-update-file-admission');
const {admitHermesMaintainerGithubUpdateFileDurableRequest}=require('./hermes-maintainer-github-update-file-durable-admission');
const {admitHermesMaintainerGithubCreatePullRequestRequest}=require('./hermes-maintainer-github-create-pull-request-admission');
const {admitHermesMaintainerGithubCreatePullRequestDurableRequest}=require('./hermes-maintainer-github-create-pull-request-durable-admission');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_admission_composition_v1';
const ADMITTED='MAINTAINER_SAFE_WORKFLOW_ADMISSION_COMPOSED_SIMULATION',BLOCKED='MAINTAINER_SAFE_WORKFLOW_ADMISSION_COMPOSITION_BLOCKED';
function composeHermesMaintainerSafeWorkflowAdmission(requestComposition,capabilityComposition,{admission_reference,ownership}={}){
 const blockers=[],rv=validateHermesMaintainerSafeWorkflowRequestComposition(requestComposition),cv=validateHermesMaintainerSafeWorkflowCapabilityComposition(capabilityComposition);
 if(!rv.valid)blockers.push(...rv.errors.map(e=>'request_composition::'+e));if(!cv.valid)blockers.push(...cv.errors.map(e=>'capability_composition::'+e));
 if(rv.valid&&requestComposition.request_composed!==true)blockers.push('request_composition_not_ready');if(cv.valid&&capabilityComposition.capability_composed!==true)blockers.push('capability_composition_not_ready');
 for(const f of ['mission_id','workflow_digest','intent_digest','durable_operation','ownership_key','attempt_reference','capability_reference'])if(rv.valid&&cv.valid&&requestComposition[f]!==capabilityComposition[f])blockers.push('composition_binding_mismatch');
 if(!isNonEmptyString(admission_reference))blockers.push('admission_reference_invalid');
 const op=requestComposition?.durable_operation;
 if(['update_file','create_pull_request'].includes(op)){
  if(!ownership||ownership.contract_version!=='hermes_maintainer_scm_write_durable_ownership_binding_v1'||ownership.status!=='SCM_WRITE_DURABLE_OWNERSHIP_BOUND'||ownership.binding_valid!==true||ownership.ownership_key!==requestComposition?.ownership_key||ownership.intent_digest!==requestComposition?.intent_digest||ownership.attempt_reference!==requestComposition?.attempt_reference||ownership.durable_replay_protection!==true||ownership.ownership_exclusive!==true||ownership.execution_authorized!==false||ownership.network_call_performed!==false||ownership.write_performed!==false||ownership.production_used!==false)blockers.push('durable_ownership_invalid');
 }
 let admission=null;
 if(blockers.length===0){
  const evidence={decision:'ADMITTED',intent_digest:requestComposition.intent_digest,attempt_reference:requestComposition.attempt_reference,capability_reference:requestComposition.capability_reference,admission_reference};
  if(op==='create_branch')admission=admitHermesMaintainerGithubDurableWriteRequest(requestComposition.request,{...evidence,ownership_key:requestComposition.ownership_key});
  else if(op==='update_file'){const first=admitHermesMaintainerGithubUpdateFileRequest(capabilityComposition.capability,requestComposition.request,evidence);admission=admitHermesMaintainerGithubUpdateFileDurableRequest(first,{decision:'OWNED',persistence_key:ownership.persistence_key,ownership_key:ownership.ownership_key,intent_digest:ownership.intent_digest,attempt_reference:ownership.attempt_reference});}
  else if(op==='create_pull_request'){const first=admitHermesMaintainerGithubCreatePullRequestRequest(capabilityComposition.capability,requestComposition.request,evidence);admission=admitHermesMaintainerGithubCreatePullRequestDurableRequest(first,{decision:'OWNED',persistence_key:ownership.persistence_key,ownership_key:ownership.ownership_key,intent_digest:ownership.intent_digest,attempt_reference:ownership.attempt_reference});}
  else blockers.push('durable_operation_unsupported');
 }
 if(admission&&admission.admission_valid!==true)blockers.push(...(admission.blockers||[]).map(e=>'admission::'+e));
 const u=uniqueSorted(blockers),ok=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ok?requestComposition.mission_id:'mission_not_available',workflow_digest:ok?requestComposition.workflow_digest:null,intent_digest:ok?requestComposition.intent_digest:null,durable_operation:ok?op:null,ownership_key:ok?requestComposition.ownership_key:null,attempt_reference:ok?requestComposition.attempt_reference:null,capability_reference:ok?requestComposition.capability_reference:null,admission_reference:ok?admission_reference:null,status:ok?ADMITTED:BLOCKED,admission_composed:ok,admission:ok?admission:null,admission_contract:ok?admission.contract_version:null,credential_resolution_invoked:false,credential_material_present:false,authority_consumed:ok,request_admission_invoked:ok,durable_admission_invoked:ok,execution_boundary_invoked:false,execution_authorized:ok,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:ok,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowAdmissionComposition(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['admission_composition_must_be_object']};const ok=v.status===ADMITTED;
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![ADMITTED,BLOCKED].includes(v.status)||v.admission_composed!==ok)e.push('status_invalid');
 if(ok&&(!isPlainObject(v.admission)||v.admission.admission_valid!==true||v.admission.execution_authorized!==true||v.admission.credential_material_present!==false||v.admission.network_call_performed!==false||v.admission.write_performed!==false||v.admission.production_used!==false))e.push('admission_invalid');
 for(const f of ['credential_resolution_invoked','credential_material_present','execution_boundary_invoked','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed'])if(v[f]!==false)e.push(f+'_must_be_false');
 for(const f of ['authority_consumed','request_admission_invoked','durable_admission_invoked','execution_authorized','operational_authority_consumed'])if(v[f]!==ok)e.push(f+'_invalid');
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers))e.push('blockers_invalid');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={ADMITTED,BLOCKED,CONTRACT_VERSION,composeHermesMaintainerSafeWorkflowAdmission,validateHermesMaintainerSafeWorkflowAdmissionComposition};
