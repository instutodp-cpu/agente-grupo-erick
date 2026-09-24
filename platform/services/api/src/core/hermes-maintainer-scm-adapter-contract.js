'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { ACTIONS } = require('./hermes-maintainer-action-gate');

const CONTRACT_VERSION='hermes_maintainer_scm_adapter_contract_v1';
const OPERATIONS=Object.freeze(['branch_prepare','ci_read','code_edit_prepare','pull_request_prepare','repository_code_search','repository_read','test_execution']);

function buildHermesMaintainerScmAdapterRequest(input={}){
 const blockers=[];
 if(!isPlainObject(input)) blockers.push('input_must_be_object');
 const operation=input.operation,repository=input.repository,base_ref=input.base_ref;
 if(!isNonEmptyString(operation)||!OPERATIONS.includes(operation)||!ACTIONS.includes(operation)) blockers.push('operation_not_allowed');
 if(!isNonEmptyString(repository)) blockers.push('repository_invalid');
 if(!isNonEmptyString(base_ref)) blockers.push('base_ref_invalid');
 const ready=blockers.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,operation:isNonEmptyString(operation)?operation:'operation_not_available',repository:isNonEmptyString(repository)?repository:'repository_not_available',base_ref:isNonEmptyString(base_ref)?base_ref:'ref_not_available',status:ready?'SCM_ADAPTER_REQUEST_PREPARED_SIMULATION':'SCM_ADAPTER_REQUEST_BLOCKED',ready,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(uniqueSorted(blockers))});
}
function validateHermesMaintainerScmAdapterRequest(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['scm_request_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');
 if(!OPERATIONS.includes(v.operation)||!isNonEmptyString(v.repository)||!isNonEmptyString(v.base_ref))e.push('identity_invalid');
 if(v.ready!==(v.status==='SCM_ADAPTER_REQUEST_PREPARED_SIMULATION'))e.push('status_invalid');
 for(const f of ['execution_authorized','network_authorized','credentials_authorized','write_authorized','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(f+'_must_be_false');
 if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.ready&&v.blockers.length)e.push('ready_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={CONTRACT_VERSION,OPERATIONS,buildHermesMaintainerScmAdapterRequest,validateHermesMaintainerScmAdapterRequest};
