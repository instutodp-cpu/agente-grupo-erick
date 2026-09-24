'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { PREPARED_STATUS, validateHermesMaintainerExecutionHandoffAdapter } = require('./hermes-maintainer-execution-handoff-adapter');
const { validateHermesMaintainerScmAdapterRequest } = require('./hermes-maintainer-scm-adapter-contract');

const CONTRACT_VERSION='hermes_maintainer_controlled_executor_v1';
const PREPARED='MAINTAINER_CONTROLLED_EXECUTION_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_CONTROLLED_EXECUTION_BLOCKED';

function prepareHermesMaintainerControlledExecution(handoff,scm){
 const blockers=[],hv=validateHermesMaintainerExecutionHandoffAdapter(handoff),sv=validateHermesMaintainerScmAdapterRequest(scm);
 if(!hv.valid)blockers.push(...hv.errors.map(e=>'handoff::'+e));if(!sv.valid)blockers.push(...sv.errors.map(e=>'scm::'+e));
 if(hv.valid&&(handoff.status!==PREPARED_STATUS||handoff.handoff_prepared!==true))blockers.push('handoff_not_ready');
 if(sv.valid&&scm.ready!==true)blockers.push('scm_request_not_ready');
 if(handoff&&handoff.execution_authorized!==false)blockers.push('premature_handoff_authority');
 if(scm&&(scm.execution_authorized!==false||scm.network_authorized!==false||scm.credentials_authorized!==false||scm.write_authorized!==false))blockers.push('premature_scm_authority');
 const u=uniqueSorted(blockers),ready=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:handoff&&isNonEmptyString(handoff.mission_id)?handoff.mission_id:'mission_not_available',operation:scm&&isNonEmptyString(scm.operation)?scm.operation:'operation_not_available',repository:scm&&isNonEmptyString(scm.repository)?scm.repository:'repository_not_available',base_ref:scm&&isNonEmptyString(scm.base_ref)?scm.base_ref:'ref_not_available',status:ready?PREPARED:BLOCKED,execution_prepared:ready,execution_eligible:false,execution_authorized:false,network_authorized:false,credentials_authorized:false,write_authorized:false,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerControlledExecution(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['controlled_execution_must_be_object']};
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.operation)||!isNonEmptyString(v.repository)||!isNonEmptyString(v.base_ref))e.push('identity_invalid');
 if(![PREPARED,BLOCKED].includes(v.status)||v.execution_prepared!==(v.status===PREPARED))e.push('status_invalid');
 for(const f of ['execution_eligible','execution_authorized','network_authorized','credentials_authorized','write_authorized','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(f+'_must_be_false');
 if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.execution_prepared&&v.blockers.length)e.push('prepared_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,PREPARED,prepareHermesMaintainerControlledExecution,validateHermesMaintainerControlledExecution};
