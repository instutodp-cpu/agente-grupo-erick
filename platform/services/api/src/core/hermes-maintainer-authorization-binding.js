'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { validateHermesMaintainerExecutionAuthorizationRequest, REQUESTED } = require('./hermes-maintainer-execution-authorization-request');

const CONTRACT_VERSION='hermes_maintainer_authorization_binding_v1';
const PREPARED='MAINTAINER_AUTHORIZATION_BINDING_PREPARED_SIMULATION';
const BLOCKED='MAINTAINER_AUTHORIZATION_BINDING_BLOCKED';
const FIELDS=Object.freeze(['contract_version','mission_id','source_request_contract_version','intent_digest','intent_count','binding_digest','status','binding_prepared','authorization_granted','execution_authorized','authority_consumed','simulation','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','blockers']);

function material(r){return {contract_version:r.contract_version,mission_id:r.mission_id,intent_fingerprint_contract_version:r.intent_fingerprint_contract_version,intent_digest:r.intent_digest,intent_count:r.intent_count,status:r.status,authorization_requested:r.authorization_requested,blockers:r.blockers};}
function buildHermesMaintainerAuthorizationBinding(r){
 const v=validateHermesMaintainerExecutionAuthorizationRequest(r), blockers=[...v.errors];
 if(v.valid&&(r.status!==REQUESTED||r.authorization_requested!==true)) blockers.push('authorization_request_not_ready');
 if(v.valid&&(r.authorization_granted!==false||r.execution_authorized!==false||r.authority_consumed!==false)) blockers.push('request_already_has_authority');
 const u=uniqueSorted(blockers),ready=u.length===0;
 return Object.freeze({contract_version:CONTRACT_VERSION,mission_id:r&&isNonEmptyString(r.mission_id)?r.mission_id:'mission_not_available',source_request_contract_version:r&&isNonEmptyString(r.contract_version)?r.contract_version:'request_contract_not_available',intent_digest:r&&isNonEmptyString(r.intent_digest)?r.intent_digest:'digest_not_available',intent_count:r&&Number.isInteger(r.intent_count)?r.intent_count:0,binding_digest:ready?computeCanonicalContentDigest(material(r)):null,status:ready?PREPARED:BLOCKED,binding_prepared:ready,authorization_granted:false,execution_authorized:false,authority_consumed:false,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:Object.freeze(u)});
}
function validateHermesMaintainerAuthorizationBinding(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['binding_must_be_object']};
 for(const k of Object.keys(v))if(!FIELDS.includes(k))e.push(`binding_unknown_field::${k}`);for(const k of FIELDS)if(!Object.prototype.hasOwnProperty.call(v,k))e.push(`binding_missing_field::${k}`);
 if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.source_request_contract_version))e.push('identity_invalid');
 if(v.status===PREPARED&&!isCanonicalContentDigest(v.binding_digest))e.push('binding_digest_invalid');if(v.status===BLOCKED&&v.binding_digest!==null)e.push('blocked_binding_digest_must_be_null');
 if(![PREPARED,BLOCKED].includes(v.status)||v.binding_prepared!==(v.status===PREPARED))e.push('status_invalid');
 for(const f of ['authorization_granted','execution_authorized','authority_consumed','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed'])if(v[f]!==false)e.push(`${f}_must_be_false`);
 if(v.simulation!==true)e.push('simulation_must_be_true');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.binding_prepared&&v.blockers.length)e.push('prepared_with_blockers');
 return{valid:e.length===0,errors:uniqueSorted(e)};
}
function verifyHermesMaintainerAuthorizationBinding(r,b){const e=[...validateHermesMaintainerExecutionAuthorizationRequest(r).errors,...validateHermesMaintainerAuthorizationBinding(b).errors];if(!e.length){if(r.status!==REQUESTED||r.authorization_requested!==true)e.push('authorization_request_not_ready');if(b.mission_id!==r.mission_id)e.push('mission_id_mismatch');if(b.intent_digest!==r.intent_digest)e.push('intent_digest_mismatch');if(b.intent_count!==r.intent_count)e.push('intent_count_mismatch');if(b.binding_digest!==computeCanonicalContentDigest(material(r)))e.push('binding_digest_mismatch');}return{valid:e.length===0,errors:uniqueSorted(e)};}
module.exports={BLOCKED,CONTRACT_VERSION,FIELDS,PREPARED,buildHermesMaintainerAuthorizationBinding,validateHermesMaintainerAuthorizationBinding,verifyHermesMaintainerAuthorizationBinding};
