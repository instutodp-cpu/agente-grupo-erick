'use strict';
const {isNonEmptyString,isPlainObject,uniqueSorted}=require('./read-only-adapter-contract');
const {stablePayload}=require('./agent-identity-contract');
const {computeCanonicalContentDigest,isCanonicalContentDigest}=require('./canonical-content-digest');
const CONTRACT_VERSION='hermes_maintainer_execution_attempt_ownership_v1';
const CLAIMED='MAINTAINER_EXECUTION_ATTEMPT_CLAIMED_STAGING',BLOCKED='MAINTAINER_EXECUTION_ATTEMPT_CLAIM_BLOCKED';
const digest=v=>computeCanonicalContentDigest(JSON.parse(stablePayload(v)));
function material(v){return{contract_version:CONTRACT_VERSION,attempt_id:v.attempt_id,authorization_id:v.authorization_id,lifecycle_fingerprint:v.lifecycle_fingerprint,mission_id:v.mission_id,operation:v.operation,repository:v.repository,base_ref:v.base_ref,executor_id:v.executor_id,lease_id:v.lease_id,lease_expires_at:v.lease_expires_at,idempotency_key:v.idempotency_key,environment:v.environment};}
function buildHermesMaintainerExecutionAttemptClaim(consumption,input={}){
 const b=[];if(!isPlainObject(consumption)||consumption.ok!==true||consumption.status!=='CONSUMED')b.push('consumption_invalid');
 for(const f of ['authorization_id','fingerprint'])if(!isNonEmptyString(consumption?.[f]))b.push('consumption_'+f+'_invalid');
 for(const f of ['attempt_id','mission_id','operation','repository','base_ref','executor_id','lease_id','lease_expires_at','idempotency_key'])if(!isNonEmptyString(input[f]))b.push(f+'_invalid');
 if(isNonEmptyString(input.lease_expires_at)&&(!Number.isFinite(Date.parse(input.lease_expires_at))))b.push('lease_expires_at_invalid');
 const u=uniqueSorted(b),ok=u.length===0,v={contract_version:CONTRACT_VERSION,attempt_id:input.attempt_id||'attempt_not_available',authorization_id:consumption?.authorization_id||'authorization_not_available',lifecycle_fingerprint:consumption?.fingerprint||'fingerprint_not_available',mission_id:input.mission_id||'mission_not_available',operation:input.operation||'operation_not_available',repository:input.repository||'repository_not_available',base_ref:input.base_ref||'ref_not_available',executor_id:input.executor_id||'executor_not_available',lease_id:input.lease_id||'lease_not_available',lease_expires_at:input.lease_expires_at||'time_not_available',idempotency_key:input.idempotency_key||'key_not_available',environment:'staging',status:ok?CLAIMED:BLOCKED,claimed:ok,attempt_fingerprint:null,execution_performed:false,network_used:false,credentials_used:false,write_performed:false,production_allowed:false,blockers:Object.freeze(u)};
 v.attempt_fingerprint=ok?digest(material(v)):null;return Object.freeze(v);
}
function validateHermesMaintainerExecutionAttemptClaim(v){const e=[];if(!isPlainObject(v))return{valid:false,errors:['attempt_must_be_object']};if(v.contract_version!==CONTRACT_VERSION)e.push('contract_version_invalid');if(![CLAIMED,BLOCKED].includes(v.status)||v.claimed!==(v.status===CLAIMED))e.push('status_invalid');if(v.environment!=='staging'||v.execution_performed!==false||v.network_used!==false||v.credentials_used!==false||v.write_performed!==false||v.production_allowed!==false)e.push('boundary_invalid');if(v.claimed&&(!isCanonicalContentDigest(v.attempt_fingerprint)||v.attempt_fingerprint!==digest(material(v))))e.push('attempt_fingerprint_invalid');if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString))e.push('blockers_invalid');return{valid:e.length===0,errors:uniqueSorted(e)};}
module.exports={BLOCKED,CLAIMED,CONTRACT_VERSION,buildHermesMaintainerExecutionAttemptClaim,validateHermesMaintainerExecutionAttemptClaim};
