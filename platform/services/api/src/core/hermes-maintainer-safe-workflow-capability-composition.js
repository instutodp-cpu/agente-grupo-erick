'use strict';
const { isPlainObject, uniqueSorted }=require('./read-only-adapter-contract');
const { PREPARED, validateHermesMaintainerSafeWorkflowAuthorizedCompositionHandoff }=require('./hermes-maintainer-safe-workflow-authorized-composition-handoff');
const { grantHermesMaintainerScmWriteDurableCapability }=require('./hermes-maintainer-scm-write-durable-capability');
const { grantHermesMaintainerGithubUpdateFileCapability }=require('./hermes-maintainer-github-update-file-capability');
const { grantHermesMaintainerGithubCreatePullRequestCapability }=require('./hermes-maintainer-github-create-pull-request-capability');
const CONTRACT_VERSION='hermes_maintainer_safe_workflow_capability_composition_v1';
const GRANTED='MAINTAINER_SAFE_WORKFLOW_CAPABILITY_COMPOSED_SIMULATION',BLOCKED='MAINTAINER_SAFE_WORKFLOW_CAPABILITY_COMPOSITION_BLOCKED';
function composeHermesMaintainerSafeWorkflowCapability(handoff,{durable_handoff,grant,target}={}){
 const blockers=[],hv=validateHermesMaintainerSafeWorkflowAuthorizedCompositionHandoff(handoff);
 if(!hv.valid)blockers.push(...hv.errors.map(e=>`composition_handoff::${e}`));
 if(hv.valid&&(handoff.status!==PREPARED||handoff.authorized_composition_handoff_prepared!==true))blockers.push('authorized_composition_handoff_not_ready');
 let capability=null;
 if(blockers.length===0){
  if(handoff.durable_operation==='create_branch')capability=grantHermesMaintainerScmWriteDurableCapability(durable_handoff,grant);
  else if(handoff.durable_operation==='update_file')capability=grantHermesMaintainerGithubUpdateFileCapability(grant,target);
  else if(handoff.durable_operation==='create_pull_request')capability=grantHermesMaintainerGithubCreatePullRequestCapability(grant,target);
  else blockers.push('durable_operation_unsupported');
 }
 if(capability&&capability.capability_valid!==true)blockers.push(...(capability.blockers||[]).map(e=>`capability::${e}`));
 if(capability&&capability.intent_digest!==handoff.intent_digest)blockers.push('capability_intent_mismatch');
 if(capability&&capability.attempt_reference!==handoff.attempt_reference)blockers.push('capability_attempt_mismatch');
 const u=uniqueSorted(blockers),ok=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:ok?handoff.mission_id:'mission_not_available',workflow_digest:ok?handoff.workflow_digest:null,intent_digest:ok?handoff.intent_digest:null,durable_operation:ok?handoff.durable_operation:null,ownership_key:ok?handoff.ownership_key:null,attempt_reference:ok?handoff.attempt_reference:null,status:ok?GRANTED:BLOCKED,capability_composed:ok,capability:ok?capability:null,capability_contract:ok?capability.contract_version:null,capability_reference:ok?capability.capability_reference:null,credential_resolution_invoked:false,credential_material_present:false,authority_consumed:false,composition_invoked:ok,durable_admission_invoked:false,execution_boundary_invoked:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowCapabilityComposition(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['capability_composition_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![GRANTED,BLOCKED].includes(v.status)||v.capability_composed!==(v.status===GRANTED))e.push('status_invalid');
 if(v.capability_composed&&(!isPlainObject(v.capability)||v.capability.capability_valid!==true||v.capability.execution_authorized!==false||v.capability.credential_material_present!==false||v.composition_invoked!==true))e.push('capability_invalid');
 for(const f of ['credential_resolution_invoked','credential_material_present','authority_consumed','durable_admission_invoked','execution_boundary_invoked','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers))e.push('blockers_invalid');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,GRANTED,composeHermesMaintainerSafeWorkflowCapability,validateHermesMaintainerSafeWorkflowCapabilityComposition};
