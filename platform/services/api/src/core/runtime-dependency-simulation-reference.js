'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { DEPENDENCY_TYPES } = require('./orchestrator-plan-dependency');

// A pure 1:1 declarative materialization of a single edge from the Gateway's already-accepted
// DependencyGraphReference -- preserves the dependency id, from/to stage, type, and required flag
// unchanged. Never applies the dependency (no stage transition is ever computed or allowed here).
const RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_VALIDATOR_VERSION = 'runtime_dependency_simulation_reference_validator_v1';

const RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_FIELDS = Object.freeze([
  'runtime_dependency_reference_id', 'runtime_dependency_reference_version', 'runtime_execution_package_id',
  'execution_plan_id', 'source_dependency_id', 'from_runtime_stage_id', 'to_runtime_stage_id', 'dependency_type',
  'required', 'dependency_validated', 'dependency_satisfied', 'dependency_applied', 'would_allow_transition',
  'reason_codes', 'dependency_fingerprint', 'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_SAFE_FLAGS = Object.freeze({
  dependency_satisfied: false,
  dependency_applied: false,
  would_allow_transition: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 50;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeRuntimeDependencyReferenceFingerprint(reference) {
  const { dependency_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDependencySimulationReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dependency_simulation_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_FIELDS, 'runtime_dependency_simulation_reference', errors);
  for (const field of [
    'runtime_dependency_reference_id', 'runtime_execution_package_id', 'execution_plan_id', 'source_dependency_id',
    'from_runtime_stage_id', 'to_runtime_stage_id', 'dependency_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_dependency_reference_version) || reference.runtime_dependency_reference_version < 1) {
    errors.push('runtime_dependency_reference_version_invalid');
  }
  if (!DEPENDENCY_TYPES.includes(reference.dependency_type)) errors.push(`dependency_type_not_allowed::${reference.dependency_type}`);
  if (typeof reference.required !== 'boolean') errors.push('required_must_be_boolean');
  if (typeof reference.dependency_validated !== 'boolean') errors.push('dependency_validated_must_be_boolean');
  if (isNonEmptyString(reference.from_runtime_stage_id) && isNonEmptyString(reference.to_runtime_stage_id)
    && reference.from_runtime_stage_id === reference.to_runtime_stage_id) {
    errors.push('dependency_cannot_reference_itself');
  }
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeRuntimeDependencyReferenceFingerprint(reference) !== reference.dependency_fingerprint) errors.push('dependency_fingerprint_mismatch');
  } catch (error) {
    errors.push('dependency_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDependencySimulationReference(input = {}) {
  const reference = {
    runtime_dependency_reference_id: input.runtime_dependency_reference_id,
    runtime_dependency_reference_version: Number.isInteger(input.runtime_dependency_reference_version) ? input.runtime_dependency_reference_version : 1,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    source_dependency_id: input.source_dependency_id,
    from_runtime_stage_id: input.from_runtime_stage_id,
    to_runtime_stage_id: input.to_runtime_stage_id,
    dependency_type: input.dependency_type,
    required: input.required === true,
    dependency_validated: input.dependency_validated === true,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    dependency_fingerprint: 'pending',
    ...RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_VALIDATOR_VERSION
  };
  reference.dependency_fingerprint = computeRuntimeDependencyReferenceFingerprint(reference);

  const validation = validateRuntimeDependencySimulationReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dependency_simulation_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_LIST_ITEMS,
  RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_FIELDS,
  RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_SAFE_FLAGS,
  RUNTIME_DEPENDENCY_SIMULATION_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDependencySimulationReference,
  computeRuntimeDependencyReferenceFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeDependencySimulationReference
};
