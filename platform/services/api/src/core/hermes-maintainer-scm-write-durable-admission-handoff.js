'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_durable_admission_handoff_v1';
const OWNERSHIP_VERSION='hermes_maintainer_scm_write_durable_ownership_binding_v1';
const REPOSITORY='instutodp-cpu/agente-grupo-erick';
const OPERATION='create_branch';
const BASE_REF='main';

function prepareHermesMaintainerScmWriteDurableAdmissionHandoff(ownership,target){
 const blockers=[];
 if(!ownership||ownership.contract_version!==OWNERSHIP_VERSION||ownership.status!=='SCM_WRITE_DURABLE_OWNERSHIP_BOUND'||ownership.binding_valid!==true||ownership.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT'||ownership.ownership_exclusive!==true||ownership.durable_replay_protection!==true)blockers.push('DURABLE_ATTEMPT_OWNERSHIP_INVALID');
 if(ownership?.execution_authorized!==false||ownership?.network_call_performed!==false||ownership?.write_performed!==false||ownership?.production_used!==false)blockers.push('OWNERSHIP_STATE_INVALID');
 if(!target||target.operation!==OPERATION||target.repository!==REPOSITORY||target.base_ref!==BASE_REF)blockers.push('TARGET_SCOPE_INVALID');
 if(typeof target?.branch_name!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,79}$/.test(target.branch_name)||target.branch_name.includes('..'))blockers.push('BRANCH_NAME_INVALID');
 if(typeof target?.base_sha!=='string'||!/^[a-f0-9]{40}$/.test(target.base_sha))blockers.push('BASE_SHA_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,status:valid?'SCM_WRITE_DURABLE_ADMISSION_HANDOFF_PREPARED':'SCM_WRITE_DURABLE_ADMISSION_HANDOFF_BLOCKED',handoff_valid:valid,ownership_source:valid?ownership.ownership_source:null,ownership_key:valid?ownership.ownership_key:null,persistence_key:valid?ownership.persistence_key:null,intent_digest:valid?ownership.intent_digest:null,attempt_reference:valid?ownership.attempt_reference:null,operation:valid?OPERATION:null,repository:valid?REPOSITORY:null,base_ref:valid?BASE_REF:null,base_sha:valid?target.base_sha:null,branch_name:valid?target.branch_name:null,durable_replay_protection:valid,ownership_exclusive:valid,execution_authorized:false,credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
module.exports={CONTRACT_VERSION,prepareHermesMaintainerScmWriteDurableAdmissionHandoff};
