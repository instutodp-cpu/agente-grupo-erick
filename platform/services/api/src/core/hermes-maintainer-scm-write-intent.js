'use strict';

const CONTRACT_VERSION='hermes_maintainer_scm_write_intent_v1';
const PROVIDER='GITHUB';
const ALLOWED_OPERATION='create_branch';

function buildHermesMaintainerScmWriteIntent(input){
 const blockers=[];
 if(!input||typeof input!=='object'||Array.isArray(input))blockers.push('INPUT_INVALID');
 if(input?.provider!==PROVIDER)blockers.push('PROVIDER_INVALID');
 if(input?.operation!==ALLOWED_OPERATION)blockers.push('OPERATION_INVALID');
 if(input?.repository!=='instutodp-cpu/agente-grupo-erick')blockers.push('REPOSITORY_INVALID');
 if(input?.base_ref!=='main')blockers.push('BASE_REF_INVALID');
 if(typeof input?.branch_name!=='string'||!/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(input.branch_name)||input.branch_name.includes('..'))blockers.push('BRANCH_INVALID');
 const valid=blockers.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  status:valid?'SCM_WRITE_INTENT_PREPARED':'SCM_WRITE_INTENT_BLOCKED',
  intent_valid:valid,provider:PROVIDER,operation:ALLOWED_OPERATION,
  repository:input?.repository||null,base_ref:input?.base_ref||null,branch_name:input?.branch_name||null,
  approval_required:true,approval_present:false,execution_authorized:false,
  credential_material_present:false,network_call_performed:false,write_performed:false,production_used:false,
  blockers:Object.freeze([...new Set(blockers)].sort())
 });
}

module.exports={CONTRACT_VERSION,buildHermesMaintainerScmWriteIntent};
