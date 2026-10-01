'use strict';
const { isPlainObject, uniqueSorted }=require('./read-only-adapter-contract');
const { GRANTED, validateHermesMaintainerSafeWorkflowCapabilityComposition }=require('./hermes-maintainer-safe-workflow-capability-composition');
const { prepareHermesMaintainerGithubDurableCreateBranchRequest }=require('./hermes-maintainer-github-durable-create-branch-request');
const { prepareHermesMaintainerGithubUpdateFileRequest }=require('./hermes-maintainer-github-update-file-request');
const { prepareHermesMaintainerGithubCreatePullRequestRequest }=require('./hermes-maintainer-github-create-pull-request-request');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_request_composition_v1';
const PREPARED='MAINTAINER_SAFE_WORKFLOW_REQUEST_COMPOSED_SIMULATION',BLOCKED='MAINTAINER_SAFE_WORKFLOW_REQUEST_COMPOSITION_BLOCKED';
function composeHermesMaintainerSafeWorkflowRequest(composition,{request_input}={}){
 const blockers=[],cv=validateHermesMaintainerSafeWorkflowCapabilityComposition(composition);
 if(!cv.valid)blockers.push(...cv.errors.map(e=>`capability_composition::${e}`));
 if(cv.valid&&(composition.status!==GRANTED||composition.capability_composed!==true))blockers.push('capability_composition_not_ready');
 let request=null;
 if(blockers.length===0){
  if(composition.durable_operation==='create_branch')request=prepareHermesMaintainerGithubDurableCreateBranchRequest(composition.capability);
  else if(composition.durable_operation==='update_file')request=prepareHermesMaintainerGithubUpdateFileRequest(request_input);
  else if(composition.durable_operation==='create_pull_request')request=prepareHermesMaintainerGithubCreatePullRequestRequest(request_input);
  else blockers.push('durable_operation_unsupported');
 }
 if(request&&request.request_valid!==true)blockers.push(...(request.blockers||[]).map(e=>`request::${e}`));
 if(request&&composition.durable_operation==='update_file'&&request.branch!==composition.capability.branch)blockers.push('request_target_mismatch');
 if(request&&composition.durable_operation==='create_pull_request'&&(request.head!==composition.capability.head||request.base!==composition.capability.base||request.draft!==composition.capability.draft))blockers.push('request_target_mismatch');
 if(request&&composition.durable_operation==='create_branch'&&(request.intent_digest!==composition.intent_digest||request.attempt_reference!==composition.attempt_reference||request.capability_reference!==composition.capability_reference))blockers.push('request_binding_mismatch');
 const u=uniqueSorted(blockers),ok=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ok?composition.mission_id:'mission_not_available',workflow_digest:ok?composition.workflow_digest:null,intent_digest:ok?composition.intent_digest:null,durable_operation:ok?composition.durable_operation:null,ownership_key:ok?composition.ownership_key:null,attempt_reference:ok?composition.attempt_reference:null,status:ok?PREPARED:BLOCKED,request_composed:ok,capability_reference:ok?composition.capability_reference:null,request:ok?request:null,request_contract:ok?request.contract_version:null,credential_resolution_invoked:false,credential_material_present:false,authority_consumed:false,request_admission_invoked:false,durable_admission_invoked:false,execution_boundary_invoked:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowRequestComposition(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['request_composition_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![PREPARED,BLOCKED].includes(v.status)||v.request_composed!==(v.status===PREPARED))e.push('status_invalid');
 if(v.request_composed&&(!isPlainObject(v.request)||v.request.request_valid!==true||v.request.execution_authorized!==false||v.request.credential_material_present!==false||v.request.network_call_performed!==false||v.request.write_performed!==false))e.push('request_invalid');
 for(const f of ['credential_resolution_invoked','credential_material_present','authority_consumed','request_admission_invoked','durable_admission_invoked','execution_boundary_invoked','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers))e.push('blockers_invalid');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,PREPARED,composeHermesMaintainerSafeWorkflowRequest,validateHermesMaintainerSafeWorkflowRequestComposition};
