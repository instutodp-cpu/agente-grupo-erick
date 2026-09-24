'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  verifyHermesMaintainerStepAdmissionFingerprint
} = require('./hermes-maintainer-step-admission-fingerprint');
const { validateHermesMaintainerStepAdmission } = require('./hermes-maintainer-step-admission-contract');

const CONTRACT_VERSION = 'hermes_maintainer_execution_intent_contract_v1';
const PREPARED_STATUS = 'MAINTAINER_EXECUTION_INTENT_PREPARED_SIMULATION';
const BLOCKED_STATUS = 'MAINTAINER_EXECUTION_INTENT_BLOCKED';

function prepareHermesMaintainerExecutionIntent(admission, fingerprint) {
  const blockers = [];
  const admissionValidation = validateHermesMaintainerStepAdmission(admission);
  const fingerprintVerification = verifyHermesMaintainerStepAdmissionFingerprint(admission, fingerprint);
  if (!admissionValidation.valid) blockers.push(...admissionValidation.errors.map((e) => `admission::${e}`));
  if (!fingerprintVerification.valid) blockers.push(...fingerprintVerification.errors.map((e) => `fingerprint::${e}`));
  if (!admission || admission.admitted !== true || admission.status !== 'MAINTAINER_STEPS_ADMITTED_SIMULATION') blockers.push('admission_not_admitted');
  if (!admission || admission.simulation !== true || admission.production_allowed !== false) blockers.push('maintainer_boundary_invalid');
  if (!admission || !Array.isArray(admission.blockers) || admission.blockers.length !== 0) blockers.push('admission_blockers_present');
  for (const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) {
    if (!admission || admission[field] !== false) blockers.push(`admission::${field}_must_be_false`);
  }

  const steps = admission && Array.isArray(admission.admitted_steps) ? admission.admitted_steps : [];
  const intents = steps.map((step,index) => Object.freeze({
    intent_index: index,
    source_step_index: step.step_index,
    action: step.action,
    step_kind: step.step_kind,
    intent_state: 'PREPARED_NOT_EXECUTABLE',
    execution_authorized: false,
    capability_granted: false,
    operational_payload_materialized: false
  }));
  const unique = uniqueSorted(blockers);
  const ready = unique.length === 0;
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    mission_id: admission && isNonEmptyString(admission.mission_id) ? admission.mission_id : 'mission_not_available',
    source_admission_contract_version: admission && isNonEmptyString(admission.contract_version) ? admission.contract_version : 'source_contract_not_available',
    source_admission_digest: fingerprint && isNonEmptyString(fingerprint.admission_digest) ? fingerprint.admission_digest : 'digest_not_available',
    status: ready ? PREPARED_STATUS : BLOCKED_STATUS,
    ready,
    intent_count: intents.length,
    intents: Object.freeze(intents),
    simulation: true,
    production_allowed: false,
    execution_authorized: false,
    executed: false,
    runtime_mutated: false,
    network_used: false,
    provider_called: false,
    secret_accessed: false,
    operational_authority_consumed: false,
    blockers: Object.freeze(unique)
  });
}

function validateHermesMaintainerExecutionIntent(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid:false, errors:['execution_intent_must_be_object'] };
  if (value.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (!isNonEmptyString(value.mission_id)) errors.push('mission_id_invalid');
  if (!isNonEmptyString(value.source_admission_contract_version)) errors.push('source_admission_contract_version_invalid');
  if (!isNonEmptyString(value.source_admission_digest)) errors.push('source_admission_digest_invalid');
  if (![PREPARED_STATUS,BLOCKED_STATUS].includes(value.status)) errors.push('status_invalid');
  if (typeof value.ready !== 'boolean' || value.ready !== (value.status === PREPARED_STATUS)) errors.push('ready_status_mismatch');
  if (!Number.isInteger(value.intent_count) || value.intent_count < 0 || !Array.isArray(value.intents) || value.intent_count !== value.intents.length) errors.push('intent_count_invalid');
  if (Array.isArray(value.intents)) value.intents.forEach((intent,index) => {
    if (!isPlainObject(intent)) { errors.push(`intent_${index}_invalid`); return; }
    if (intent.intent_index !== index || intent.source_step_index !== index) errors.push(`intent_${index}_order_invalid`);
    if (!isNonEmptyString(intent.action) || !isNonEmptyString(intent.step_kind)) errors.push(`intent_${index}_identity_invalid`);
    if (intent.intent_state !== 'PREPARED_NOT_EXECUTABLE') errors.push(`intent_${index}_state_invalid`);
    if (intent.execution_authorized !== false || intent.capability_granted !== false || intent.operational_payload_materialized !== false) errors.push(`intent_${index}_must_not_be_executable`);
  });
  if (value.simulation !== true || value.production_allowed !== false || value.execution_authorized !== false) errors.push('execution_boundary_invalid');
  for (const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) if (value[field] !== false) errors.push(`${field}_must_be_false`);
  if (!Array.isArray(value.blockers) || !value.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  if (value.ready === true && Array.isArray(value.blockers) && value.blockers.length !== 0) errors.push('ready_with_blockers');
  return { valid:errors.length===0, errors:uniqueSorted(errors) };
}

module.exports = { BLOCKED_STATUS, CONTRACT_VERSION, PREPARED_STATUS, prepareHermesMaintainerExecutionIntent, validateHermesMaintainerExecutionIntent };
