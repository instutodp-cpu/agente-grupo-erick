'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr106fix: a declarative, 1:1-bound description of the network policy a synthetic worker would be
// governed by -- genuinely comparable identity (ID/version/fingerprint) plus tenant/organization/
// project binding, never a string-presence pass-through. This contract never resolves a real network
// policy, opens a connection, or performs a lookup; it only records what a worker's own
// `network_policy_reference_id` would need to match against to be considered network-compatible for
// a stage that actually requires network access.
const RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_network_policy_reference_validator_v1';

const RUNTIME_WORKER_NETWORK_POLICY_REFERENCE_FIELDS = Object.freeze([
  'worker_network_policy_reference_id', 'worker_network_policy_reference_version',
  'runtime_worker_reference_id', 'runtime_environment_reference_id',
  'network_policy_reference_id', 'network_policy_version',
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
    'network_policy_reference_id', 'tenant_id', 'organization_id', 'network_policy_fingerprint', 'validator_version'
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
