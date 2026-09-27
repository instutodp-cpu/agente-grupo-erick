'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_capability_v1';
const CAPABILITY='github_create_branch_staging';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';

function grantHermesMaintainerScmWriteCapability(handoff,grant){
 const blockers=[];
 if(!handoff||handoff.contract_version!=='hermes_maintainer_scm_write_admission_handoff_v1'||handoff.status!=='SCM_WRITE_ADMISSION_HANDOFF_PREPARED'||handoff.handoff_valid!==true||handoff.operation!=='create_branch'||handoff.repository!==REPOSITORY||handoff.base_ref!=='main'||handoff.durable_replay_protection!==true||handoff.ownership_exclusive!==true)blockers.push('HANDOFF_INVALID');
 if(!grant||grant.decision!=='GRANTED'||grant.capability!==CAPABILITY)blockers.push('CAPABILITY_GRANT_INVALID');
 if(grant?.intent_digest!==handoff?.intent_digest||grant?.attempt_reference!==handoff?.attempt_reference)blockers.push('CAPABILITY_SCOPE_MISMATCH');
 if(typeof grant?.capability_reference!=='string'||grant.capability_reference.trim()==='')blockers.push('CAPABILITY_REFERENCE_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_CAPABILITY_GRANTED':'SCM_WRITE_CAPABILITY_BLOCKED',
  capability_valid:valid,
  capability:valid?CAPABILITY:null,
  capability_reference:valid?grant.capability_reference:null,
  intent_digest:valid?handoff.intent_digest:null,
  attempt_reference:valid?handoff.attempt_reference:null,
  operation:valid?'create_branch':null,
  repository:valid?REPOSITORY:null,
  base_ref:valid?'main':null,
  base_sha:valid?handoff.base_sha:null,
  branch_name:valid?handoff.branch_name:null,
  credential_material_present:false,
  credential_scope_bound:valid,
  execution_authorized:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,CAPABILITY,grantHermesMaintainerScmWriteCapability};
