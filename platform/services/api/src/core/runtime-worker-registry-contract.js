'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const { WORKER_TYPES } = require('./runtime-worker-reference');

const CONTRACT_NAME = 'RUNTIME_WORKER_REGISTRY_AUTHORITY';
const CONTRACT_VERSION = 'runtime_worker_registry_authority_contract_v1';
const VERSION = 1;
const SCHEMA_VERSION = 1;
const VALIDATOR_VERSION = 'runtime_worker_registry_authority_validator_v1';
const LIFECYCLE_STATES = Object.freeze(['ACTIVE', 'DISABLED']);
const IDENTITY_FIELDS = Object.freeze([
  'worker_id', 'tenant_id', 'organization_id', 'project_id', 'worker_type',
  'worker_capability_reference_id', 'worker_compatibility_reference_ids',
  'supported_stage_types', 'supported_modalities', 'supported_model_provider_ids',
  'supported_model_ids', 'supported_tool_ids', 'supported_workflow_ids'
]);
const FIELDS = Object.freeze([
  ...IDENTITY_FIELDS,
  'lifecycle_state', 'canonical_fingerprint', 'canonical_digest', 'schema_version',
  'created_at', 'updated_at', 'validator_version'
]);

function isOrderedUniqueStringList(value, maxItems = 500) {
  if (!Array.isArray(value) || value.length > maxItems || !value.every(isNonEmptyString)) return false;
  if (new Set(value).size !== value.length) return false;
  const sorted = [...value].sort();
  return value.every((item, index) => item === sorted[index]);
}

function canonicalIdentityFrom(input = {}) {
  return Object.freeze({
    worker_id: input.worker_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    worker_type: input.worker_type,
    worker_capability_reference_id: input.worker_capability_reference_id,
    worker_compatibility_reference_ids: uniqueSorted(input.worker_compatibility_reference_ids || []),
    supported_stage_types: uniqueSorted(input.supported_stage_types || []),
    supported_modalities: uniqueSorted(input.supported_modalities || []),
    supported_model_provider_ids: uniqueSorted(input.supported_model_provider_ids || []),
    supported_model_ids: uniqueSorted(input.supported_model_ids || []),
    supported_tool_ids: uniqueSorted(input.supported_tool_ids || []),
    supported_workflow_ids: uniqueSorted(input.supported_workflow_ids || [])
  });
}

function computeCanonicalFingerprint(input) {
  return stablePayload(canonicalIdentityFrom(input));
}

function computeCanonicalDigest(input) {
  return computeCanonicalContentDigest(canonicalIdentityFrom(input));
}

function buildWorkerRegistration(input = {}) {
  const identity = canonicalIdentityFrom(input);
  const record = {
    ...identity,
    lifecycle_state: LIFECYCLE_STATES.includes(input.lifecycle_state) ? input.lifecycle_state : 'DISABLED',
    canonical_fingerprint: computeCanonicalFingerprint(identity),
    canonical_digest: computeCanonicalDigest(identity),
    schema_version: SCHEMA_VERSION,
    validator_version: VALIDATOR_VERSION
  };
  const validation = validateWorkerRegistration(record);
  if (!validation.valid) {
    throw new Error(`runtime_worker_registration_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(record);
}

function validateWorkerRegistration(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: ['worker_registration_must_be_object'] };
  exactFields(value, FIELDS.filter((field) => !['created_at', 'updated_at'].includes(field)), 'worker_registration', errors);
  for (const field of ['worker_id', 'tenant_id', 'organization_id', 'project_id', 'worker_capability_reference_id', 'validator_version']) {
    if (!isNonEmptyString(value[field]) || value[field].length > 255) errors.push(`${field}_invalid`);
  }
  if (!WORKER_TYPES.includes(value.worker_type)) errors.push('worker_type_invalid');
  if (!LIFECYCLE_STATES.includes(value.lifecycle_state)) errors.push('lifecycle_state_invalid');
  for (const field of [
    'worker_compatibility_reference_ids', 'supported_stage_types', 'supported_modalities',
    'supported_model_provider_ids', 'supported_model_ids', 'supported_tool_ids', 'supported_workflow_ids'
  ]) {
    if (!isOrderedUniqueStringList(value[field])) errors.push(`${field}_invalid`);
  }
  if (!isNonEmptyString(value.canonical_fingerprint)) errors.push('canonical_fingerprint_invalid');
  if (!isCanonicalContentDigest(value.canonical_digest)) errors.push('canonical_digest_invalid');
  if (value.schema_version !== SCHEMA_VERSION) errors.push('schema_version_invalid');
  if (value.validator_version !== VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    if (computeCanonicalFingerprint(value) !== value.canonical_fingerprint) errors.push('canonical_fingerprint_mismatch');
    if (computeCanonicalDigest(value) !== value.canonical_digest) errors.push('canonical_digest_mismatch');
  } catch {
    errors.push('canonical_identity_invalid');
  }
  const { canonical_fingerprint: _fingerprint, canonical_digest: _digest, ...sourceFields } = value;
  errors.push(...findAgentCoreOperationalMaterial(sourceFields));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function sameCanonicalWorker(left, right) {
  try {
    return stablePayload(canonicalIdentityFrom(left)) === stablePayload(canonicalIdentityFrom(right))
      && computeCanonicalDigest(left) === computeCanonicalDigest(right);
  } catch {
    return false;
  }
}

function validateLifecycleTransition(from, to) {
  if (!LIFECYCLE_STATES.includes(from) || !LIFECYCLE_STATES.includes(to)) return false;
  return from !== to;
}

module.exports = {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  IDENTITY_FIELDS,
  LIFECYCLE_STATES,
  SCHEMA_VERSION,
  VALIDATOR_VERSION,
  buildWorkerRegistration,
  canonicalIdentityFrom,
  computeCanonicalDigest,
  computeCanonicalFingerprint,
  sameCanonicalWorker,
  validateLifecycleTransition,
  validateWorkerRegistration
};
