'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { READY, validateHermesMaintainerSafeWorkflowDurableTarget } = require('./hermes-maintainer-safe-workflow-durable-target');
const { prepareHermesMaintainerScmWriteDurableAdmissionHandoff } = require('./hermes-maintainer-scm-write-durable-admission-handoff');
const { prepareHermesMaintainerGithubUpdateFileDurableAdmissionHandoff } = require('./hermes-maintainer-github-update-file-durable-admission-handoff');
const { prepareHermesMaintainerGithubCreatePullRequestDurableAdmissionHandoff } = require('./hermes-maintainer-github-create-pull-request-durable-admission-handoff');

const CONTRACT_VERSION='hermes_maintainer_safe_workflow_durable_handoff_routing_v1';
const ROUTED='MAINTAINER_SAFE_WORKFLOW_DURABLE_HANDOFF_ROUTED_SIMULATION';
const BLOCKED='MAINTAINER_SAFE_WORKFLOW_DURABLE_HANDOFF_ROUTING_BLOCKED';
const OWNERSHIP_VERSION='hermes_maintainer_scm_write_durable_ownership_binding_v1';
const HANDOFFS=Object.freeze({create_branch:'hermes_maintainer_scm_write_durable_admission_handoff_v1',update_file:'hermes_maintainer_github_update_file_durable_admission_handoff_v1',create_pull_request:'hermes_maintainer_github_create_pull_request_durable_admission_handoff_v1'});

function routeHermesMaintainerSafeWorkflowDurableHandoff(prepared,ownership){
 const blockers=[],pv=validateHermesMaintainerSafeWorkflowDurableTarget(prepared);
 if(!pv.valid)blockers.push(...pv.errors.map(e=>`target::${e}`));
 if(pv.valid&&(prepared.status!==READY||prepared.target_prepared!==true))blockers.push('durable_target_not_ready');
 const op=prepared?.durable_operation,expected=HANDOFFS[op];
 if(!expected||prepared?.target_handoff_contract!==expected)blockers.push('handoff_contract_mismatch');
 if(!ownership||ownership.contract_version!==OWNERSHIP_VERSION||ownership.status!=='SCM_WRITE_DURABLE_OWNERSHIP_BOUND'||ownership.binding_valid!==true||ownership.ownership_key!==prepared?.ownership_key||ownership.intent_digest!==prepared?.intent_digest||ownership.attempt_reference!==prepared?.attempt_reference)blockers.push('ownership_identity_mismatch');
 let handoff=null;
 if(blockers.length===0){
  if(op==='create_branch')handoff=prepareHermesMaintainerScmWriteDurableAdmissionHandoff(ownership,prepared.target);
  else if(op==='update_file')handoff=prepareHermesMaintainerGithubUpdateFileDurableAdmissionHandoff(ownership,prepared.target);
  else if(op==='create_pull_request')handoff=prepareHermesMaintainerGithubCreatePullRequestDurableAdmissionHandoff(ownership,prepared.target);
  if(!handoff?.handoff_valid)blockers.push(...(handoff?.blockers||['durable_handoff_invalid']).map(e=>`handoff::${e}`));
 }
 const u=uniqueSorted(blockers),routed=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:routed?prepared.mission_id:'mission_not_available',workflow_digest:routed?prepared.workflow_digest:null,intent_digest:routed?prepared.intent_digest:null,authorization_binding_digest:routed?prepared.authorization_binding_digest:null,durable_operation:routed?op:null,target_handoff_contract:routed?expected:null,ownership_key:routed?prepared.ownership_key:null,attempt_reference:routed?prepared.attempt_reference:null,status:routed?ROUTED:BLOCKED,handoff_routed:routed,handoff:routed?handoff:null,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerSafeWorkflowDurableHandoffRouting(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['durable_handoff_routing_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![ROUTED,BLOCKED].includes(v.status)||v.handoff_routed!==(v.status===ROUTED))e.push('status_invalid');
 if(v.handoff_routed&&(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.durable_operation)||!isNonEmptyString(v.target_handoff_contract)||!isNonEmptyString(v.ownership_key)||!isNonEmptyString(v.attempt_reference)||!isPlainObject(v.handoff)||v.handoff.handoff_valid!==true))e.push('identity_invalid');
 for(const f of ['execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','merge_authority','production_allowed','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.human_merge_required!==true)e.push('human_merge_required_must_be_true');if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.handoff_routed&&v.blockers.length)e.push('routed_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,HANDOFFS,ROUTED,routeHermesMaintainerSafeWorkflowDurableHandoff,validateHermesMaintainerSafeWorkflowDurableHandoffRouting};
