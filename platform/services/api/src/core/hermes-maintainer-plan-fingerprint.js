'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { validateHermesMaintainerPlan } = require('./hermes-maintainer-plan-contract');

const CONTRACT_VERSION='hermes_maintainer_plan_fingerprint_v1';
const FIELDS=Object.freeze(['contract_version','mission_id','plan_digest','request_count','simulation','production_blocked']);

function canonicalPlanPayload(plan){
 return {
   contract_version:plan.contract_version,
   mission_id:plan.mission_id,
   status:plan.status,
   ready:plan.ready,
   request_count:plan.request_count,
   request_decisions:plan.request_decisions,
   blockers:plan.blockers
 };
}
function buildHermesMaintainerPlanFingerprint(plan){
 const validation=validateHermesMaintainerPlan(plan);
 if(!validation.valid||plan.ready!==true) return Object.freeze({status:'MAINTAINER_PLAN_FINGERPRINT_BLOCKED',fingerprint:null,blockers:uniqueSorted(validation.valid?['plan_not_ready']:validation.errors),executed:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false});
 const fingerprint=Object.freeze({contract_version:CONTRACT_VERSION,mission_id:plan.mission_id,plan_digest:computeCanonicalContentDigest(canonicalPlanPayload(plan)),request_count:plan.request_count,simulation:true,production_blocked:true});
 return Object.freeze({status:'MAINTAINER_PLAN_FINGERPRINT_PREPARED_SIMULATION',fingerprint,blockers:Object.freeze([]),executed:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false});
}
function validateHermesMaintainerPlanFingerprint(value){
 const errors=[];
 if(!isPlainObject(value)) return {valid:false,errors:['fingerprint_must_be_object']};
 for(const k of Object.keys(value)) if(!FIELDS.includes(k)) errors.push(`fingerprint_unknown_field::${k}`);
 for(const k of FIELDS) if(!Object.prototype.hasOwnProperty.call(value,k)) errors.push(`fingerprint_missing_field::${k}`);
 if(value.contract_version!==CONTRACT_VERSION) errors.push('contract_version_invalid');
 if(!isNonEmptyString(value.mission_id)) errors.push('mission_id_invalid');
 if(!isCanonicalContentDigest(value.plan_digest)) errors.push('plan_digest_invalid');
 if(!Number.isInteger(value.request_count)||value.request_count<1) errors.push('request_count_invalid');
 if(value.simulation!==true) errors.push('simulation_must_be_true');
 if(value.production_blocked!==true) errors.push('production_blocked_must_be_true');
 return {valid:errors.length===0,errors:uniqueSorted(errors)};
}
function verifyHermesMaintainerPlanFingerprint(plan,fingerprint){
 const validation=validateHermesMaintainerPlanFingerprint(fingerprint);
 const planValidation=validateHermesMaintainerPlan(plan);
 const errors=[...validation.errors,...planValidation.errors];
 if(validation.valid&&planValidation.valid){
  if(fingerprint.mission_id!==plan.mission_id) errors.push('mission_id_mismatch');
  if(fingerprint.request_count!==plan.request_count) errors.push('request_count_mismatch');
  if(fingerprint.plan_digest!==computeCanonicalContentDigest(canonicalPlanPayload(plan))) errors.push('plan_digest_mismatch');
 }
 return {valid:errors.length===0,errors:uniqueSorted(errors)};
}
module.exports={CONTRACT_VERSION,FIELDS,canonicalPlanPayload,buildHermesMaintainerPlanFingerprint,validateHermesMaintainerPlanFingerprint,verifyHermesMaintainerPlanFingerprint};
