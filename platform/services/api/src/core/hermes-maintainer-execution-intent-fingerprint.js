'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { validateHermesMaintainerExecutionIntent } = require('./hermes-maintainer-execution-intent-contract');

const CONTRACT_VERSION = 'hermes_maintainer_execution_intent_fingerprint_v1';
const FIELDS = Object.freeze(['contract_version','mission_id','intent_digest','intent_count','simulation','production_blocked']);

function canonicalExecutionIntentPayload(intent) {
  return {
    contract_version: intent.contract_version,
    mission_id: intent.mission_id,
    source_admission_contract_version: intent.source_admission_contract_version,
    source_admission_digest: intent.source_admission_digest,
    status: intent.status,
    ready: intent.ready,
    intent_count: intent.intent_count,
    intents: intent.intents,
    blockers: intent.blockers
  };
}

function buildHermesMaintainerExecutionIntentFingerprint(intent) {
  const validation = validateHermesMaintainerExecutionIntent(intent);
  const blockers = [...validation.errors];
  if (validation.valid && (intent.ready !== true || intent.status !== 'MAINTAINER_EXECUTION_INTENT_PREPARED_SIMULATION')) blockers.push('execution_intent_not_ready');
  if (validation.valid && (intent.simulation !== true || intent.production_allowed !== false || intent.execution_authorized !== false)) blockers.push('execution_boundary_invalid');
  for (const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) if (validation.valid && intent[field] !== false) blockers.push(`${field}_must_be_false`);
  const unique = uniqueSorted(blockers);
  if (unique.length) return Object.freeze({status:'MAINTAINER_EXECUTION_INTENT_FINGERPRINT_BLOCKED',fingerprint:null,blockers:Object.freeze(unique),executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,production_allowed:false,simulation:true});
  return Object.freeze({
    status:'MAINTAINER_EXECUTION_INTENT_FINGERPRINT_PREPARED_SIMULATION',
    fingerprint:Object.freeze({
      contract_version:CONTRACT_VERSION,
      mission_id:intent.mission_id,
      intent_digest:computeCanonicalContentDigest(canonicalExecutionIntentPayload(intent)),
      intent_count:intent.intent_count,
      simulation:true,
      production_blocked:true
    }),
    blockers:Object.freeze([]),
    executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,production_allowed:false,simulation:true
  });
}

function validateHermesMaintainerExecutionIntentFingerprint(value) {
  const errors=[];
  if(!isPlainObject(value)) return {valid:false,errors:['fingerprint_must_be_object']};
  for(const key of Object.keys(value)) if(!FIELDS.includes(key)) errors.push(`fingerprint_unknown_field::${key}`);
  for(const key of FIELDS) if(!Object.prototype.hasOwnProperty.call(value,key)) errors.push(`fingerprint_missing_field::${key}`);
  if(value.contract_version!==CONTRACT_VERSION) errors.push('contract_version_invalid');
  if(!isNonEmptyString(value.mission_id)) errors.push('mission_id_invalid');
  if(!isCanonicalContentDigest(value.intent_digest)) errors.push('intent_digest_invalid');
  if(!Number.isInteger(value.intent_count)||value.intent_count<1) errors.push('intent_count_invalid');
  if(value.simulation!==true) errors.push('simulation_must_be_true');
  if(value.production_blocked!==true) errors.push('production_blocked_must_be_true');
  return {valid:errors.length===0,errors:uniqueSorted(errors)};
}

function verifyHermesMaintainerExecutionIntentFingerprint(intent,fingerprint) {
  const fv=validateHermesMaintainerExecutionIntentFingerprint(fingerprint);
  const iv=validateHermesMaintainerExecutionIntent(intent);
  const errors=[...fv.errors,...iv.errors];
  if(fv.valid&&iv.valid){
    if(intent.ready!==true||intent.status!=='MAINTAINER_EXECUTION_INTENT_PREPARED_SIMULATION') errors.push('execution_intent_not_ready');
    if(fingerprint.mission_id!==intent.mission_id) errors.push('mission_id_mismatch');
    if(fingerprint.intent_count!==intent.intent_count) errors.push('intent_count_mismatch');
    if(fingerprint.intent_digest!==computeCanonicalContentDigest(canonicalExecutionIntentPayload(intent))) errors.push('intent_digest_mismatch');
  }
  return {valid:errors.length===0,errors:uniqueSorted(errors)};
}

module.exports={CONTRACT_VERSION,FIELDS,canonicalExecutionIntentPayload,buildHermesMaintainerExecutionIntentFingerprint,validateHermesMaintainerExecutionIntentFingerprint,verifyHermesMaintainerExecutionIntentFingerprint};
