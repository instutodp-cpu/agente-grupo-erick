'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr106fix: a declarative, 1:1-bound description of the network policy a synthetic worker would be
// governed by -- genuinely comparable identity (ID/version/fingerprint) plus tenant/organization/
// project binding, never a string-presence pass-through. This contract never resolves a real network
// policy, opens a connection, or performs a lookup; it only records what a worker's own
// `network_policy_reference_id` would need to match against to be considered network-compatible for
// a stage that actually requires network access.
//
// pr106fix2: this contract is a minimized *binding* between a worker and the official Network
// Permission Boundary policy (`transcription-network-permission-boundary.js`'s own
// `TranscriptionNetworkDestinationReference`, validated by its own `validateDestinationReference`) --
// never a second, weaker, self-declared policy. `official_network_policy_reference_id`/`_version`/
// `_fingerprint` record which official destination reference this binding claims to describe;
// `runtime-worker-assignment-boundary.js` looks that official reference up by ID and requires all
// three fields to match the official object's own `destination_ref_id`/`destination_ref_version` and
// a fingerprint recomputed with the official module's own canonicalizer -- `network_policy_reference_valid`
// is a derived convenience flag, never the source of truth.
const RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_network_policy_reference_validator_v1';

const RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_FIELDS = Object.freeze([
  'worker_network_policy_reference_id', 'worker_network_policy_reference_version',
  'runtime_worker_reference_id', 'runtime_environment_reference_id',
  'network_policy_reference_id', 'network_policy_version',
  'official_network_policy_reference_id', 'official_network_policy_version', 'official_network_policy_fingerprint',
  'tenant_id', 'organization_id', 'project_id',
  'network_policy_reference_valid',
  'network_policy_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true
});

function computeNetworkPolicyFingerprint(reference) {
  const { network_policy_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeWorkerNetworkPolicyReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_network_policy_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_FIELDS, 'runtime_worker_network_policy_reference', errors);
  for (const field of [
    'worker_network_policy_reference_id', 'runtime_worker_reference_id', 'runtime_environment_reference_id',
    'network_policy_reference_id', 'tenant_id', 'organization_id', 'network_policy_fingerprint', 'validator_version',
    'official_network_policy_reference_id', 'official_network_policy_fingerprint'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (reference.project_id !== null && !isNonEmptyString(reference.project_id)) errors.push('project_id_invalid');
  if (!Number.isInteger(reference.worker_network_policy_reference_version) || reference.worker_network_policy_reference_version < 1) {
    errors.push('worker_network_policy_reference_version_invalid');
  }
  if (!Number.isInteger(reference.network_policy_version) || reference.network_policy_version < 1) {
    errors.push('network_policy_version_invalid');
  }
  if (!Number.isInteger(reference.official_network_policy_version) || reference.official_network_policy_version < 1) {
    errors.push('official_network_policy_version_invalid');
  }
  if (typeof reference.network_policy_reference_valid !== 'boolean') errors.push('network_policy_reference_valid_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeNetworkPolicyFingerprint(reference) !== reference.network_policy_fingerprint) errors.push('network_policy_fingerprint_mismatch');
  } catch (error) {
    errors.push('network_policy_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerNetworkPolicyReference(input = {}) {
  const reference = {
    worker_network_policy_reference_id: input.worker_network_policy_reference_id,
    worker_network_policy_reference_version: Number.isInteger(input.worker_network_policy_reference_version) ? input.worker_network_policy_reference_version : 1,
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    runtime_environment_reference_id: input.runtime_environment_reference_id,
    network_policy_reference_id: input.network_policy_reference_id,
    network_policy_version: Number.isInteger(input.network_policy_version) ? input.network_policy_version : 1,
    official_network_policy_reference_id: input.official_network_policy_reference_id,
    official_network_policy_version: Number.isInteger(input.official_network_policy_version) ? input.official_network_policy_version : 1,
    official_network_policy_fingerprint: input.official_network_policy_fingerprint,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id === undefined ? null : input.project_id,
    network_policy_reference_valid: input.network_policy_reference_valid !== false,
    network_policy_fingerprint: 'pending',
    ...RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_VALIDATOR_VERSION
  };
  reference.network_policy_fingerprint = computeNetworkPolicyFingerprint(reference);

  const validation = validateRuntimeWorkerNetworkPolicyReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_network_policy_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_FIELDS,
  RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeWorkerNetworkPolicyReference,
  computeNetworkPolicyFingerprint,
  validateRuntimeWorkerNetworkPolicyReference
};
