'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr107: a declarative gate over one Dispatch Stage's own required/optional/blocking dependency IDs
// -- "Stages com dependências required não satisfeitas nunca geram intents preparadas." Never
// satisfies or applies a dependency; `dispatch_allowed_by_dependencies` is a pure derived boolean
// (true only when `blocking_dependency_count` is zero), never a caller-declared flag.
const RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_dependency_gate_reference_validator_v1';

const RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_FIELDS = Object.freeze([
  'dispatch_dependency_gate_reference_id', 'dispatch_dependency_gate_reference_version',
  'runtime_dispatch_package_id', 'runtime_scheduler_package_id',
  'runtime_dispatch_stage_reference_id', 'scheduler_stage_reference_id',
  'required_dependency_reference_ids', 'optional_dependency_reference_ids', 'blocking_dependency_reference_ids',
  'required_dependency_count', 'optional_dependency_count', 'blocking_dependency_count',
  'dependencies_validated', 'dependencies_satisfied', 'dependencies_applied', 'dispatch_allowed_by_dependencies',
  'reason_codes',
  'dependency_gate_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_SAFE_FLAGS = Object.freeze({
  dependencies_satisfied: false,
  dependencies_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_COUNT = 100000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeDependencyGateFingerprint(reference) {
  const { dependency_gate_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchDependencyGateReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_dependency_gate_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_FIELDS, 'runtime_dispatch_dependency_gate_reference', errors);
  for (const field of [
    'dispatch_dependency_gate_reference_id', 'runtime_dispatch_package_id', 'runtime_scheduler_package_id',
    'runtime_dispatch_stage_reference_id', 'scheduler_stage_reference_id', 'dependency_gate_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.dispatch_dependency_gate_reference_version) || reference.dispatch_dependency_gate_reference_version < 1) {
    errors.push('dispatch_dependency_gate_reference_version_invalid');
  }
  if (!isOrderedUniqueStringList(reference.required_dependency_reference_ids)) errors.push('required_dependency_reference_ids_invalid');
  if (!isOrderedUniqueStringList(reference.optional_dependency_reference_ids)) errors.push('optional_dependency_reference_ids_invalid');
  if (!isOrderedUniqueStringList(reference.blocking_dependency_reference_ids)) errors.push('blocking_dependency_reference_ids_invalid');
  if (
    Array.isArray(reference.blocking_dependency_reference_ids) && Array.isArray(reference.required_dependency_reference_ids)
    && reference.blocking_dependency_reference_ids.some((id) => !reference.required_dependency_reference_ids.includes(id))
  ) {
    errors.push('blocking_dependency_reference_ids_must_be_a_subset_of_required');
  }
  for (const field of ['required_dependency_count', 'optional_dependency_count', 'blocking_dependency_count']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (
    Array.isArray(reference.required_dependency_reference_ids) && Number.isInteger(reference.required_dependency_count)
    && reference.required_dependency_count !== reference.required_dependency_reference_ids.length
  ) {
    errors.push('required_dependency_count_inconsistent');
  }
  if (
    Array.isArray(reference.optional_dependency_reference_ids) && Number.isInteger(reference.optional_dependency_count)
    && reference.optional_dependency_count !== reference.optional_dependency_reference_ids.length
  ) {
    errors.push('optional_dependency_count_inconsistent');
  }
  if (
    Array.isArray(reference.blocking_dependency_reference_ids) && Number.isInteger(reference.blocking_dependency_count)
    && reference.blocking_dependency_count !== reference.blocking_dependency_reference_ids.length
  ) {
    errors.push('blocking_dependency_count_inconsistent');
  }
  if (typeof reference.dependencies_validated !== 'boolean') errors.push('dependencies_validated_must_be_boolean');
  if (typeof reference.dispatch_allowed_by_dependencies !== 'boolean') errors.push('dispatch_allowed_by_dependencies_must_be_boolean');
  if (Number.isInteger(reference.blocking_dependency_count) && typeof reference.dispatch_allowed_by_dependencies === 'boolean') {
    const expectedAllowed = reference.blocking_dependency_count === 0;
    if (reference.dispatch_allowed_by_dependencies !== expectedAllowed) errors.push('dispatch_allowed_by_dependencies_inconsistent_with_blocking_count');
  }
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeDependencyGateFingerprint(reference) !== reference.dependency_gate_fingerprint) errors.push('dependency_gate_fingerprint_mismatch');
  } catch (error) {
    errors.push('dependency_gate_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchDependencyGateReference(input = {}) {
  const requiredIds = uniqueSorted(input.required_dependency_reference_ids || []);
  const optionalIds = uniqueSorted(input.optional_dependency_reference_ids || []);
  const blockingIds = uniqueSorted(input.blocking_dependency_reference_ids || []);
  const reference = {
    dispatch_dependency_gate_reference_id: input.dispatch_dependency_gate_reference_id,
    dispatch_dependency_gate_reference_version: Number.isInteger(input.dispatch_dependency_gate_reference_version) ? input.dispatch_dependency_gate_reference_version : 1,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    required_dependency_reference_ids: requiredIds,
    optional_dependency_reference_ids: optionalIds,
    blocking_dependency_reference_ids: blockingIds,
    required_dependency_count: requiredIds.length,
    optional_dependency_count: optionalIds.length,
    blocking_dependency_count: blockingIds.length,
    dependencies_validated: true,
    dispatch_allowed_by_dependencies: blockingIds.length === 0,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    dependency_gate_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_VALIDATOR_VERSION
  };
  reference.dependency_gate_fingerprint = computeDependencyGateFingerprint(reference);

  const validation = validateRuntimeDispatchDependencyGateReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_dependency_gate_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_COUNT,
  MAX_LIST_ITEMS,
  RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_DEPENDENCY_GATE_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDispatchDependencyGateReference,
  computeDependencyGateFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeDispatchDependencyGateReference
};
