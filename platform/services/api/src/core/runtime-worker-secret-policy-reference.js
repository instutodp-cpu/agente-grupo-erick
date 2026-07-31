'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr106fix: a declarative, 1:1-bound description of the secret policy a synthetic worker would be
// governed by -- genuinely comparable identity (ID/version/fingerprint) plus tenant/organization/
// project binding, never a string-presence pass-through. This contract never resolves a real secret,
// loads material, or performs a lookup; it only records what a worker's own
// `secret_policy_reference_id` would need to match against to be considered secret-compatible for a
// stage that actually requires secret-backed access (e.g. a model provider API key).
//
// pr106fix2: this contract is a minimized *binding* between a worker and the official Secret
// Resolution Boundary policy (`transcription-secret-resolution-boundary.js`'s own
// `TranscriptionSecretReference`, validated by its own `validateSecretReference`) -- never a second,
// weaker, self-declared policy. `official_secret_policy_reference_id`/`_version`/`_fingerprint`
// record which official secret reference this binding claims to describe; `runtime-worker-assignment-
// boundary.js` looks that official reference up by ID and requires all three fields to match the
// official object's own `secret_ref_id`/`secret_ref_version` and a fingerprint recomputed with the
// official module's own canonicalizer -- `secret_policy_reference_valid` is a derived convenience
// flag, never the source of truth.
const RUNTIME_WORKER_SECRET_POLICY_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_secret_policy_reference_validator_v1';

const RUNTIME_WORKER_SECRET_POLICY_REFERENCE_FIELDS = Object.freeze([
  'worker_secret_policy_reference_id', 'worker_secret_policy_reference_version',
  'runtime_worker_reference_id', 'runtime_environment_reference_id',
  'secret_policy_reference_id', 'secret_policy_version',
  'official_secret_policy_reference_id', 'official_secret_policy_version', 'official_secret_policy_fingerprint',
  'tenant_id', 'organization_id', 'project_id',
  'secret_policy_reference_valid',
  'secret_policy_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_SECRET_POLICY_REFERENCE_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true
});

function computeSecretPolicyFingerprint(reference) {
  const { secret_policy_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeWorkerSecretPolicyReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_secret_policy_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_SECRET_POLICY_REFERENCE_FIELDS, 'runtime_worker_secret_policy_reference', errors);
  for (const field of [
    'worker_secret_policy_reference_id', 'runtime_worker_reference_id', 'runtime_environment_reference_id',
    'secret_policy_reference_id', 'tenant_id', 'organization_id', 'secret_policy_fingerprint', 'validator_version',
    'official_secret_policy_reference_id', 'official_secret_policy_fingerprint'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (reference.project_id !== null && !isNonEmptyString(reference.project_id)) errors.push('project_id_invalid');
  if (!Number.isInteger(reference.worker_secret_policy_reference_version) || reference.worker_secret_policy_reference_version < 1) {
    errors.push('worker_secret_policy_reference_version_invalid');
  }
  if (!Number.isInteger(reference.secret_policy_version) || reference.secret_policy_version < 1) {
    errors.push('secret_policy_version_invalid');
  }
  if (!Number.isInteger(reference.official_secret_policy_version) || reference.official_secret_policy_version < 1) {
    errors.push('official_secret_policy_version_invalid');
  }
  if (typeof reference.secret_policy_reference_valid !== 'boolean') errors.push('secret_policy_reference_valid_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_SECRET_POLICY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_WORKER_SECRET_POLICY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeSecretPolicyFingerprint(reference) !== reference.secret_policy_fingerprint) errors.push('secret_policy_fingerprint_mismatch');
  } catch (error) {
    errors.push('secret_policy_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerSecretPolicyReference(input = {}) {
  const reference = {
    worker_secret_policy_reference_id: input.worker_secret_policy_reference_id,
    worker_secret_policy_reference_version: Number.isInteger(input.worker_secret_policy_reference_version) ? input.worker_secret_policy_reference_version : 1,
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    runtime_environment_reference_id: input.runtime_environment_reference_id,
    secret_policy_reference_id: input.secret_policy_reference_id,
    secret_policy_version: Number.isInteger(input.secret_policy_version) ? input.secret_policy_version : 1,
    official_secret_policy_reference_id: input.official_secret_policy_reference_id,
    official_secret_policy_version: Number.isInteger(input.official_secret_policy_version) ? input.official_secret_policy_version : 1,
    official_secret_policy_fingerprint: input.official_secret_policy_fingerprint,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id === undefined ? null : input.project_id,
    secret_policy_reference_valid: input.secret_policy_reference_valid !== false,
    secret_policy_fingerprint: 'pending',
    ...RUNTIME_WORKER_SECRET_POLICY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_SECRET_POLICY_REFERENCE_VALIDATOR_VERSION
  };
  reference.secret_policy_fingerprint = computeSecretPolicyFingerprint(reference);

  const validation = validateRuntimeWorkerSecretPolicyReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_secret_policy_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  RUNTIME_WORKER_SECRET_POLICY_REFERENCE_FIELDS,
  RUNTIME_WORKER_SECRET_POLICY_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_SECRET_POLICY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeWorkerSecretPolicyReference,
  computeSecretPolicyFingerprint,
  validateRuntimeWorkerSecretPolicyReference
};
