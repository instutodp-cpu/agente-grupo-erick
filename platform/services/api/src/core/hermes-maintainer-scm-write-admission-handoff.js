'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_admission_handoff_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const OPERATION='create_branch';
const BASE_REF='main';

function prepareHermesMaintainerScmWriteAdmissionHandoff(ownership,target){
 const blockers=[];
 if(!ownership||ownership.contract_version!=='hermes_maintainer_scm_write_attempt_ownership_v1'||ownership.status!=='SCM_WRITE_ATTEMPT_CLAIMED'||ownership.claim_valid!==true||ownership.ownership_exclusive!==true||ownership.durable_replay_protection!==true)blockers.push('ATTEMPT_OWNERSHIP_INVALID');
 if(!target||target.operation!==OPERATION||target.repository!==REPOSITORY||target.base_ref!==BASE_REF)blockers.push('TARGET_SCOPE_INVALID');
 if(typeof target?.branch_name!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(target.branch_name)||target.branch_name.includes('..'))blockers.push('BRANCH_NAME_INVALID');
 if(typeof target?.base_sha!=='string'||!/^[a-f0-9]{40}$/.test(target.base_sha))blockers.push('BASE_SHA_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_ADMISSION_HANDOFF_PREPARED':'SCM_WRITE_ADMISSION_HANDOFF_BLOCKED',
  handoff_valid:valid,
  intent_digest:valid?ownership.intent_digest:null,
  attempt_reference:valid?ownership.attempt_reference:null,
  operation:valid?OPERATION:null,
  repository:valid?REPOSITORY:null,
  base_ref:valid?BASE_REF:null,
  base_sha:valid?target.base_sha:null,
  branch_name:valid?target.branch_name:null,
  durable_replay_protection:valid,
  ownership_exclusive:valid,
  execution_authorized:false,
  network_call_performed:false,
  write_performed:false,
  production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerScmWriteAdmissionHandoff};
