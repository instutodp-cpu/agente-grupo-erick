'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');
const { validateHermesMaintainerExecutionIntent } = require('./hermes-maintainer-execution-intent-contract');
const { verifyHermesMaintainerExecutionIntentFingerprint } = require('./hermes-maintainer-execution-intent-fingerprint');

const CONTRACT_VERSION='hermes_maintainer_execution_authorization_request_v1';
const REQUESTED='MAINTAINER_EXECUTION_AUTHORIZATION_REQUESTED_SIMULATION';
const BLOCKED='MAINTAINER_EXECUTION_AUTHORIZATION_REQUEST_BLOCKED';

function buildHermesMaintainerExecutionAuthorizationRequest(intent,fingerprint){
 const blockers=[];
 const iv=validateHermesMaintainerExecutionIntent(intent);
 const fv=verifyHermesMaintainerExecutionIntentFingerprint(intent,fingerprint);
 if(!iv.valid) blockers.push(...iv.errors.map(e=>`intent::${e}`));
 if(!fv.valid) blockers.push(...fv.errors.map(e=>`fingerprint::${e}`));
 if(iv.valid&&(intent.ready!==true||intent.status!=='MAINTAINER_EXECUTION_INTENT_PREPARED_SIMULATION')) blockers.push('intent_not_ready');
 if(iv.valid&&(intent.simulation!==true||intent.production_allowed!==false||intent.execution_authorized!==false)) blockers.push('intent_boundary_invalid');
 const unique=uniqueSorted(blockers), ready=unique.length===0;
 return Object.freeze({
  contract_version:CONTRACT_VERSION,
  mission_id:intent&&isNonEmptyString(intent.mission_id)?intent.mission_id:'mission_not_available',
  intent_fingerprint_contract_version:fingerprint&&isNonEmptyString(fingerprint.contract_version)?fingerprint.contract_version:'fingerprint_contract_not_available',
  intent_digest:fingerprint&&isNonEmptyString(fingerprint.intent_digest)?fingerprint.intent_digest:'digest_not_available',
  intent_count:fingerprint&&Number.isInteger(fingerprint.intent_count)?fingerprint.intent_count:0,
  status:ready?REQUESTED:BLOCKED,
  authorization_requested:ready,
  authorization_granted:false,
  execution_authorized:false,
  authority_consumed:false,
  simulation:true,
  production_allowed:false,
  executed:false,
  runtime_mutated:false,
  network_used:false,
  provider_called:false,
  secret_accessed:false,
  operational_authority_consumed:false,
  blockers:Object.freeze(unique)
 });
}

function validateHermesMaintainerExecutionAuthorizationRequest(v){
 const errors=[];
 if(!isPlainObject(v)) return {valid:false,errors:['authorization_request_must_be_object']};
 const fields=['contract_version','mission_id','intent_fingerprint_contract_version','intent_digest','intent_count','status','authorization_requested','authorization_granted','execution_authorized','authority_consumed','simulation','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed','blockers'];
 for(const k of Object.keys(v)) if(!fields.includes(k)) errors.push(`authorization_request_unknown_field::${k}`);
 for(const k of fields) if(!Object.prototype.hasOwnProperty.call(v,k)) errors.push(`authorization_request_missing_field::${k}`);
 if(v.contract_version!==CONTRACT_VERSION) errors.push('contract_version_invalid');
 if(!isNonEmptyString(v.mission_id)||!isNonEmptyString(v.intent_fingerprint_contract_version)) errors.push('identity_invalid');
 if(!isCanonicalContentDigest(v.intent_digest)) errors.push('intent_digest_invalid');
 if(!Number.isInteger(v.intent_count)||v.intent_count<0) errors.push('intent_count_invalid');
 if(![REQUESTED,BLOCKED].includes(v.status)) errors.push('status_invalid');
 if(v.authorization_requested!==(v.status===REQUESTED)) errors.push('authorization_requested_status_mismatch');
 for(const f of ['authorization_granted','execution_authorized','authority_consumed','production_allowed','executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) if(v[f]!==false) errors.push(`${f}_must_be_false`);
 if(v.simulation!==true) errors.push('simulation_must_be_true');
 if(!Array.isArray(v.blockers)||!v.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
 if(v.authorization_requested===true&&v.blockers.length) errors.push('requested_with_blockers');
 return {valid:errors.length===0,errors:uniqueSorted(errors)};
}
module.exports={BLOCKED,CONTRACT_VERSION,REQUESTED,buildHermesMaintainerExecutionAuthorizationRequest,validateHermesMaintainerExecutionAuthorizationRequest};
