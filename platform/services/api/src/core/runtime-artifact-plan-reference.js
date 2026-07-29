'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// A declarative plan of which artifacts a future runtime *would* produce -- never creates a file,
// never writes to disk. "Nenhum arquivo deve ser criado" -- artifact_creation_allowed and
// artifact_created are always false.
const RUNTIME_ARTIFACT_PLAN_REFERENCE_VALIDATOR_VERSION = 'runtime_artifact_plan_reference_validator_v1';

const ARTIFACT_TYPES = Object.freeze([
  'AUDIT_ARTIFACT_REFERENCE', 'VALIDATION_ARTIFACT_REFERENCE', 'RESULT_ARTIFACT_REFERENCE',
  'SUMMARY_ARTIFACT_REFERENCE', 'TRACE_ARTIFACT_REFERENCE'
]);

const RUNTIME_ARTIFACT_PLAN_REFERENCE_FIELDS = Object.freeze([
  'runtime_artifact_plan_reference_id', 'runtime_artifact_plan_reference_version', 'runtime_execution_package_id',
  'execution_plan_id', 'planned_artifact_ids', 'planned_artifact_types', 'artifact_count', 'artifact_plan_validated',
  'artifact_creation_allowed', 'artifact_created', 'artifact_plan_fingerprint', 'simulation', 'production_blocked',
  'validator_version'
]);

const RUNTIME_ARTIFACT_PLAN_REFERENCE_SAFE_FLAGS = Object.freeze({
  artifact_creation_allowed: false,
  artifact_created: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function isOrderedUniqueArtifactTypeList(list) {
  if (!Array.isArray(list) || list.length > ARTIFACT_TYPES.length) return false;
  if (!list.every((item) => ARTIFACT_TYPES.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeRuntimeArtifactPlanReferenceFingerprint(reference) {
  const { artifact_plan_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeArtifactPlanReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_artifact_plan_reference_must_be_object'] };
  exactFields(reference, RUNTIME_ARTIFACT_PLAN_REFERENCE_FIELDS, 'runtime_artifact_plan_reference', errors);
  for (const field of [
    'runtime_artifact_plan_reference_id', 'runtime_execution_package_id', 'execution_plan_id',
    'artifact_plan_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_artifact_plan_reference_version) || reference.runtime_artifact_plan_reference_version < 1) {
    errors.push('runtime_artifact_plan_reference_version_invalid');
  }
  if (!isOrderedUniqueStringList(reference.planned_artifact_ids)) errors.push('planned_artifact_ids_invalid');
  if (!isOrderedUniqueArtifactTypeList(reference.planned_artifact_types)) errors.push('planned_artifact_types_invalid');
  if (!Number.isInteger(reference.artifact_count) || reference.artifact_count < 0) errors.push('artifact_count_invalid');
  else if (Array.isArray(reference.planned_artifact_ids) && reference.artifact_count !== reference.planned_artifact_ids.length) {
    errors.push('artifact_count_inconsistent');
  }
  if (typeof reference.artifact_plan_validated !== 'boolean') errors.push('artifact_plan_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_ARTIFACT_PLAN_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_ARTIFACT_PLAN_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeRuntimeArtifactPlanReferenceFingerprint(reference) !== reference.artifact_plan_fingerprint) errors.push('artifact_plan_fingerprint_mismatch');
  } catch (error) {
    errors.push('artifact_plan_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeArtifactPlanReference(input = {}) {
  const plannedIds = Array.isArray(input.planned_artifact_ids) ? uniqueSorted(input.planned_artifact_ids) : [];
  const reference = {
    runtime_artifact_plan_reference_id: input.runtime_artifact_plan_reference_id,
    runtime_artifact_plan_reference_version: Number.isInteger(input.runtime_artifact_plan_reference_version) ? input.runtime_artifact_plan_reference_version : 1,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    planned_artifact_ids: plannedIds,
    planned_artifact_types: Array.isArray(input.planned_artifact_types) ? uniqueSorted(input.planned_artifact_types) : [],
    artifact_count: plannedIds.length,
    artifact_plan_validated: input.artifact_plan_validated === true,
    artifact_plan_fingerprint: 'pending',
    ...RUNTIME_ARTIFACT_PLAN_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_ARTIFACT_PLAN_REFERENCE_VALIDATOR_VERSION
  };
  reference.artifact_plan_fingerprint = computeRuntimeArtifactPlanReferenceFingerprint(reference);

  const validation = validateRuntimeArtifactPlanReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_artifact_plan_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  ARTIFACT_TYPES,
  MAX_LIST_ITEMS,
  RUNTIME_ARTIFACT_PLAN_REFERENCE_FIELDS,
  RUNTIME_ARTIFACT_PLAN_REFERENCE_SAFE_FLAGS,
  RUNTIME_ARTIFACT_PLAN_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeArtifactPlanReference,
  computeRuntimeArtifactPlanReferenceFingerprint,
  isOrderedUniqueArtifactTypeList,
  isOrderedUniqueStringList,
  validateRuntimeArtifactPlanReference
};
