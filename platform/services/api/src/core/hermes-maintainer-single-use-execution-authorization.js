'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { PASSED, validateHermesMaintainerStagingGate } = require('./hermes-maintainer-staging-gate');

const CONTRACT_VERSION='hermes_maintainer_single_use_execution_authorization_v1';
const AUTHORIZED='MAINTAINER_EXECUTION_AUTHORIZED_STAGING';
const BLOCKED='MAINTAINER_EXECUTION_AUTHORIZATION_BLOCKED';
function material(v){return{contract_version:CONTRACT_VERSION,authorization_id:v.authorization_id,mission_id:v.mission_id,operation:v.operation,repository:v.repository,base_ref:v.base_ref,issued_at:v.issued_at,expires_at:v.expires_at,environment:v.environment,single_use:v.single_use};}
function buildHermesMaintainerSingleUseAuthorization(gate,input={}){
 const blockers=[],gv=validateHermesMaintainerStagingGate(gate);
 if(!gv.valid)blockers.push(...gv.errors.map(e=>'gate::'+e));if(gv.valid&&(gate.status!==PASSED||gate.staging_gate_passed!==true))blockers.push('staging_gate_not_passed');
 const authorization_id=input.authorization_id,issued_at=input.issued_at,expires_at=input.expires_at;
 if(!isNonEmptyString(authorization_id))blockers.push('authorization_id_invalid');
 if(!isNonEmptyString(issued_at)||!Number.isFinite(Date.parse(issued_at)))blockers.push('issued_at_invalid');
 if(!isNonEmptyString(expires_at)||!Number.isFinite(Date.parse(expires_at))||Date.parse(expires_at)<=Date.parse(issued_at))blockers.push('expires_at_invalid');
 const u=uniqueSorted(blockers),ok=u.length===0,v={contract_version:CONTRACT_VERSION,authorization_id:isNonEmptyString(authorization_id)?authorization_id:'authorization_not_available',mission_id:gate&&isNonEmptyString(gate.mission_id)?gate.mission_id:'mission_not_available',operation:gate&&isNonEmptyString(gate.operation)?gate.operation:'operation_not_available',repository:gate&&isNonEmptyString(gate.repository)?gate.repository:'repository_not_available',base_ref:gate&&isNonEmptyString(gate.base_ref)?gate.base_ref:'ref_not_available',issued_at:isNonEmptyString(issued_at)?issued_at:'time_not_available',expires_at:isNonEmptyString(expires_at)?expires_at:'time_not_available',environment:'staging',single_use:true,status:ok?AUTHORIZED:BLOCKED,execution_authorized:ok,consumed:false,revoked:false,authorization_fingerprint:null,production_allowed:false,executed:false,blockers:Object.freeze(u)};
 v.authorization_fingerprint=ok?computeCanonicalContentDigest(material(v)):null;return Object.freeze(v);
}
function validateHermesMaintainerSingleUseAuthorization(v){
 const e=[];if(!isPlainObject(v))return{valid:false,errors:['authorization_must_be_object']};if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');for(const f of ['authorization_id','mission_id','operation','repository','base_ref'])if(!isNonEmptyString(v[f]))e.push(f+'_invalid');if(v.environment!=='staging'||v.single_use!==true)e.push('scope_invalid');if(!isNonEmptyString(v.issued_at)||!isNonEmptyString(v.expires_at)||!Number.isFinite(Date.parse(v.issued_at))||!Number.isFinite(Date.parse(v.expires_at))||Date.parse(v.expires_at)<=Date.parse(v.issued_at))e.push('authorization_window_invalid');if(![AUTHORIZED,BLOCKED].includes(v.status)||v.execution_authorized!==(v.status===AUTHORIZED))e.push('status_invalid');if(v.consumed!==false||v.revoked!==false||v.production_allowed!==false||v.executed!==false)e.push('lifecycle_boundary_invalid');if(v.status===AUTHORIZED&&(!isCanonicalContentDigest(v.authorization_fingerprint)||v.authorization_fingerprint!==computeCanonicalContentDigest(material(v))))e.push('authorization_fingerprint_invalid');if(v.status===BLOCKED&&v.authorization_fingerprint!==null)e.push('blocked_fingerprint_must_be_null');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');if(v.execution_authorized&&v.blockers.length)e.push('authorized_with_blockers');return{valid:e.length===0,errors:uniqueSorted(e)};
}
module.exports={AUTHORIZED,BLOCKED,CONTRACT_VERSION,buildHermesMaintainerSingleUseAuthorization,validateHermesMaintainerSingleUseAuthorization};
