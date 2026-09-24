'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { validateHermesMaintainerStepAdmission } = require('./hermes-maintainer-step-admission-contract');

const CONTRACT_VERSION = 'hermes_maintainer_step_admission_fingerprint_v1';
const FIELDS = Object.freeze([
  'contract_version','mission_id','admission_digest','step_count','simulation','production_blocked'
]);

function canonicalAdmissionPayload(admission) {
  return {
    contract_version: admission.contract_version,
    mission_id: admission.mission_id,
    source_contract_version: admission.source_contract_version,
    status: admission.status,
    admitted: admission.admitted,
    step_count: admission.step_count,
    admitted_steps: admission.admitted_steps,
    blockers: admission.blockers
  };
}

function buildHermesMaintainerStepAdmissionFingerprint(admission) {
  const validation = validateHermesMaintainerStepAdmission(admission);
  const blockers = [...validation.errors];
  if (validation.valid && admission.admitted !== true) blockers.push('admission_not_admitted');
  if (validation.valid && admission.status !== 'MAINTAINER_STEPS_ADMITTED_SIMULATION') blockers.push('admission_status_not_admitted');
  if (validation.valid && admission.simulation !== true) blockers.push('simulation_required');
  if (validation.valid && admission.production_allowed !== false) blockers.push('production_must_be_blocked');
  for (const field of ['executed','runtime_mutated','network_used','provider_called','secret_accessed','operational_authority_consumed']) {
    if (validation.valid && admission[field] !== false) blockers.push(`${field}_must_be_false`);
  }
  const unique = uniqueSorted(blockers);
  if (unique.length !== 0) return Object.freeze({
    status: 'MAINTAINER_STEP_ADMISSION_FINGERPRINT_BLOCKED',
    fingerprint: null,
    blockers: Object.freeze(unique),
    executed: false,
    runtime_mutated: false,
    network_used: false,
    provider_called: false,
    secret_accessed: false,
    operational_authority_consumed: false,
    production_allowed: false,
    simulation: true
  });

  return Object.freeze({
    status: 'MAINTAINER_STEP_ADMISSION_FINGERPRINT_PREPARED_SIMULATION',
    fingerprint: Object.freeze({
      contract_version: CONTRACT_VERSION,
      mission_id: admission.mission_id,
      admission_digest: computeCanonicalContentDigest(canonicalAdmissionPayload(admission)),
      step_count: admission.step_count,
      simulation: true,
      production_blocked: true
    }),
    blockers: Object.freeze([]),
    executed: false,
    runtime_mutated: false,
    network_used: false,
    provider_called: false,
    secret_accessed: false,
    operational_authority_consumed: false,
    production_allowed: false,
    simulation: true
  });
}

function validateHermesMaintainerStepAdmissionFingerprint(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: ['fingerprint_must_be_object'] };
  for (const key of Object.keys(value)) if (!FIELDS.includes(key)) errors.push(`fingerprint_unknown_field::${key}`);
  for (const key of FIELDS) if (!Object.prototype.hasOwnProperty.call(value,key)) errors.push(`fingerprint_missing_field::${key}`);
  if (value.contract_version !== CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (!isNonEmptyString(value.mission_id)) errors.push('mission_id_invalid');
  if (!isCanonicalContentDigest(value.admission_digest)) errors.push('admission_digest_invalid');
  if (!Number.isInteger(value.step_count) || value.step_count < 1) errors.push('step_count_invalid');
  if (value.simulation !== true) errors.push('simulation_must_be_true');
  if (value.production_blocked !== true) errors.push('production_blocked_must_be_true');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function verifyHermesMaintainerStepAdmissionFingerprint(admission, fingerprint) {
  const fingerprintValidation = validateHermesMaintainerStepAdmissionFingerprint(fingerprint);
  const admissionValidation = validateHermesMaintainerStepAdmission(admission);
  const errors = [...fingerprintValidation.errors, ...admissionValidation.errors];
  if (fingerprintValidation.valid && admissionValidation.valid) {
    if (admission.admitted !== true || admission.status !== 'MAINTAINER_STEPS_ADMITTED_SIMULATION') errors.push('admission_not_admitted');
    if (fingerprint.mission_id !== admission.mission_id) errors.push('mission_id_mismatch');
    if (fingerprint.step_count !== admission.step_count) errors.push('step_count_mismatch');
    if (fingerprint.admission_digest !== computeCanonicalContentDigest(canonicalAdmissionPayload(admission))) errors.push('admission_digest_mismatch');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CONTRACT_VERSION, FIELDS, canonicalAdmissionPayload,
  buildHermesMaintainerStepAdmissionFingerprint,
  validateHermesMaintainerStepAdmissionFingerprint,
  verifyHermesMaintainerStepAdmissionFingerprint
};
