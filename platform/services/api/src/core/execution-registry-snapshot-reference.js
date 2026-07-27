'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const REGISTRY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION = 'execution_registry_snapshot_reference_validator_v1';

const REGISTRY_SNAPSHOT_REFERENCE_FIELDS = Object.freeze([
  'registry_snapshot_reference_id', 'registry_snapshot_reference_version', 'tenant_id', 'organization_id',
  'project_id', 'session_reference_id', 'execution_plan_request_id', 'execution_plan_id',
  'expected_registry_version', 'observed_registry_version', 'registry_entity_versions',
  'registry_entity_fingerprints', 'snapshot_consistent', 'snapshot_validated', 'snapshot_applied',
  'logical_sequence', 'snapshot_fingerprint', 'simulation', 'production_blocked', 'validator_version'
]);

// registry_entity_versions/registry_entity_fingerprints are plain, exact-fields objects over this
// fixed, documented set of entity keys -- never a Map, never an arbitrary caller-chosen key set.
// Each key names one of the versioned, fingerprinted references an ExecutionPlanRequest carries.
const REGISTRY_ENTITY_KEYS = Object.freeze([
  'execution_plan_request', 'stage_manifest', 'dependency_graph', 'provenance', 'scope', 'execution_plan_budget',
  'idempotency_policy'
]);

const REGISTRY_SNAPSHOT_REFERENCE_SAFE_FLAGS = Object.freeze({
  snapshot_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_VERSION = 1000000;

function isEntityVersionsObject(value) {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== REGISTRY_ENTITY_KEYS.length) return false;
  return REGISTRY_ENTITY_KEYS.every((key) => Number.isInteger(value[key]) && value[key] >= 1 && value[key] <= MAX_VERSION);
}

function isEntityFingerprintsObject(value) {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).length !== REGISTRY_ENTITY_KEYS.length) return false;
  return REGISTRY_ENTITY_KEYS.every((key) => isNonEmptyString(value[key]));
}

function computeSnapshotFingerprint(reference) {
  const { snapshot_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateExecutionRegistrySnapshotReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['registry_snapshot_reference_must_be_object'] };
  exactFields(reference, REGISTRY_SNAPSHOT_REFERENCE_FIELDS, 'registry_snapshot_reference', errors);
  for (const field of [
    'registry_snapshot_reference_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
    'execution_plan_request_id', 'execution_plan_id', 'expected_registry_version', 'observed_registry_version',
    'snapshot_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.registry_snapshot_reference_version) || reference.registry_snapshot_reference_version < 1) {
    errors.push('registry_snapshot_reference_version_invalid');
  }
  if (!isEntityVersionsObject(reference.registry_entity_versions)) errors.push('registry_entity_versions_invalid');
  if (!isEntityFingerprintsObject(reference.registry_entity_fingerprints)) errors.push('registry_entity_fingerprints_invalid');
  if (!Number.isInteger(reference.logical_sequence) || reference.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (typeof reference.snapshot_validated !== 'boolean') errors.push('snapshot_validated_must_be_boolean');
  // snapshot_consistent is never caller-asserted independently of the two version strings it
  // claims to summarize -- it must always equal their actual equality, exactly like
  // execution_plan_prepared is tied to status elsewhere in this codebase.
  if (isNonEmptyString(reference.expected_registry_version) && isNonEmptyString(reference.observed_registry_version)) {
    const expectedConsistency = reference.expected_registry_version === reference.observed_registry_version;
    if (reference.snapshot_consistent !== expectedConsistency) errors.push('snapshot_consistent_does_not_match_declared_versions');
  } else if (typeof reference.snapshot_consistent !== 'boolean') {
    errors.push('snapshot_consistent_must_be_boolean');
  }
  for (const [field, expected] of Object.entries(REGISTRY_SNAPSHOT_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== REGISTRY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeSnapshotFingerprint(reference) !== reference.snapshot_fingerprint) {
      errors.push('snapshot_fingerprint_mismatch');
    }
  } catch (error) {
    errors.push('snapshot_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionRegistrySnapshotReference(input = {}) {
  const expectedVersion = input.expected_registry_version;
  const observedVersion = input.observed_registry_version;
  const reference = {
    registry_snapshot_reference_id: input.registry_snapshot_reference_id,
    registry_snapshot_reference_version: Number.isInteger(input.registry_snapshot_reference_version) ? input.registry_snapshot_reference_version : 1,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    execution_plan_request_id: input.execution_plan_request_id,
    execution_plan_id: input.execution_plan_id,
    expected_registry_version: expectedVersion,
    observed_registry_version: observedVersion,
    registry_entity_versions: isPlainObject(input.registry_entity_versions) ? input.registry_entity_versions : {},
    registry_entity_fingerprints: isPlainObject(input.registry_entity_fingerprints) ? input.registry_entity_fingerprints : {},
    snapshot_consistent: expectedVersion === observedVersion,
    snapshot_validated: input.snapshot_validated === true,
    snapshot_applied: false,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    validator_version: REGISTRY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION
  };
  reference.snapshot_fingerprint = computeSnapshotFingerprint({ ...reference, snapshot_fingerprint: undefined });

  const validation = validateExecutionRegistrySnapshotReference(reference);
  if (!validation.valid) {
    throw new Error(`execution_registry_snapshot_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_VERSION,
  REGISTRY_ENTITY_KEYS,
  REGISTRY_SNAPSHOT_REFERENCE_FIELDS,
  REGISTRY_SNAPSHOT_REFERENCE_SAFE_FLAGS,
  REGISTRY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION,
  buildExecutionRegistrySnapshotReference,
  computeSnapshotFingerprint,
  isEntityFingerprintsObject,
  isEntityVersionsObject,
  validateExecutionRegistrySnapshotReference
};
