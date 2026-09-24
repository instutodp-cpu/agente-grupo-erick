'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { PREPARED, validateHermesMaintainerAuthorizationBinding, verifyHermesMaintainerAuthorizationBinding } = require('./hermes-maintainer-authorization-binding');

const CONTRACT_VERSION='hermes_maintainer_execution_handoff_adapter_v1';
const PREPARED_STATUS='MAINTAINER_EXECUTION_HANDOFF_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_EXECUTION_HANDOFF_BLOCKED';
const FIELDS=Object.freeze(['contract_version','mission_id','source_binding_contract_version','binding_digest','intent_digest','intent_count','status','handoff_prepared','execution_eligible','execution_authorized','authority_consumed','simulation','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','blockers']);

function buildHermesMaintainerExecutionHandoffAdapter(request,binding){
 const blockers=[],bv=validateHermesMaintainerAuthorizationBinding(binding),vv=verifyHermesMaintainerAuthorizationBinding(request,binding);
 if(!bv.valid) blockers.push(...bv.errors.map(e=>`binding::${e}`)); if(!vv.valid) blockers.push(...vv.errors.map(e=>`verification::${e}`));
 if(bv.valid&&(binding.status!==PREPARED||binding.binding_prepared!==true)) blockers.push('binding_not_ready');
 const u=uniqueSorted(blockers),ready=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:binding&&isNonEmptyString(binding.mission_id)?binding.mission_id:'mission_not_available',source_binding_contract_version:binding&&isNonEmptyString(binding.contract_version)?binding.contract_version:'binding_contract_not_available',binding_digest:binding&&isCanonicalContentDigest(binding.binding_digest)?binding.binding_digest:null,intent_digest:binding&&isNonEmptyString(binding.intent_digest)?binding.intent_digest:'digest_not_available',intent_count:binding&&Number.isInteger(binding.intent_count)?binding.intent_count:0,status:ready?PREPARED_STATUS:BLOCKED,handoff_prepared:ready,execution_eligible:false,execution_authorized:false,authority_consumed:false,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerExecutionHandoffAdapter(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['handoff_adapter_must_be_object']};
 for(const k of Object.keys(v))if(!FIELDS.includes(k))e.push(`handoff_adapter_unknown_field::${k}`);for(const k of FIELDS)if(!Object.prototype.hasOwnProperty.call(v,k))e.push(`handoff_adapter_missing_field::${k}`);
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.source_binding_contract_version))e.push('identity_invalid');
 if(v.status===PREPARED_STATUS&&!isCanonicalContentDigest(v.binding_digest))e.push('binding_digest_invalid');if(![PREPARED_STATUS,BLOCKED].includes(v.status)||v.handoff_prepared!==(v.status===PREPARED_STATUS))e.push('status_invalid');
 for(const f of ['execution_eligible','execution_authorized','authority_consumed','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.handoff_prepared&&v.blockers.length)e.push('prepared_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={BLOCKED,CONTRACT_VERSION,FIELDS,PREPARED_STATUS,buildHermesMaintainerExecutionHandoffAdapter,validateHermesMaintainerExecutionHandoffAdapter};
