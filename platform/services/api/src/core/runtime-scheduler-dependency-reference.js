'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { DEPENDENCY_TYPES } = require('./orchestrator-plan-dependency');

// pr105: a minimized declarative materialization of a single RuntimeDependencySimulationReference
// (PR #103) edge for scheduling purposes -- preserves source dependency id, from/to endpoints,
// type, and required flag unchanged ("Preservar integralmente... Não redirecionar endpoints"; see
// runtime-scheduler-boundary.js's own 1:1 cross-check). `would_block_target` is the only genuinely
// new, caller-supplied signal this contract carries: true only when a required dependency's
// predecessor is not yet declaratively satisfied -- never applies the dependency itself.
const RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_VALIDATOR_VERSION = 'runtime_scheduler_dependency_reference_validator_v1';

const RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_FIELDS = Object.freeze([
  'scheduler_dependency_reference_id', 'scheduler_dependency_reference_version',
  'runtime_scheduler_package_id', 'runtime_execution_package_id', 'source_runtime_dependency_reference_id',
  'from_scheduler_stage_reference_id', 'to_scheduler_stage_reference_id',
  'dependency_type', 'required', 'dependency_order',
  'source_dependency_fingerprint', 'dependency_fingerprint',
  'dependency_validated', 'dependency_satisfied', 'dependency_applied', 'would_block_target', 'would_allow_target',
  'reason_codes',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_SAFE_FLAGS = Object.freeze({
  dependency_satisfied: false,
  dependency_applied: false,
  would_allow_target: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 50;
const MAX_DEPENDENCY_ORDER = 100000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeSchedulerDependencyFingerprint(reference) {
  const { dependency_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeSchedulerDependencyReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_scheduler_dependency_reference_must_be_object'] };
  exactFields(reference, RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_FIELDS, 'runtime_scheduler_dependency_reference', errors);
  for (const field of [
    'scheduler_dependency_reference_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
    'source_runtime_dependency_reference_id', 'from_scheduler_stage_reference_id', 'to_scheduler_stage_reference_id',
    'source_dependency_fingerprint', 'dependency_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.scheduler_dependency_reference_version) || reference.scheduler_dependency_reference_version < 1) {
    errors.push('scheduler_dependency_reference_version_invalid');
  }
  if (!DEPENDENCY_TYPES.includes(reference.dependency_type)) errors.push(`dependency_type_not_allowed::${reference.dependency_type}`);
  if (typeof reference.required !== 'boolean') errors.push('required_must_be_boolean');
  if (!Number.isInteger(reference.dependency_order) || reference.dependency_order < 0 || reference.dependency_order > MAX_DEPENDENCY_ORDER) {
    errors.push('dependency_order_invalid');
  }
  if (
    isNonEmptyString(reference.from_scheduler_stage_reference_id) && isNonEmptyString(reference.to_scheduler_stage_reference_id)
    && reference.from_scheduler_stage_reference_id === reference.to_scheduler_stage_reference_id
  ) {
    errors.push('dependency_cannot_reference_itself');
  }
  if (typeof reference.dependency_validated !== 'boolean') errors.push('dependency_validated_must_be_boolean');
  if (typeof reference.would_block_target !== 'boolean') errors.push('would_block_target_must_be_boolean');
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeSchedulerDependencyFingerprint(reference) !== reference.dependency_fingerprint) errors.push('dependency_fingerprint_mismatch');
  } catch (error) {
    errors.push('dependency_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerDependencyReference(input = {}) {
  const reference = {
    scheduler_dependency_reference_id: input.scheduler_dependency_reference_id,
    scheduler_dependency_reference_version: Number.isInteger(input.scheduler_dependency_reference_version) ? input.scheduler_dependency_reference_version : 1,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    source_runtime_dependency_reference_id: input.source_runtime_dependency_reference_id,
    from_scheduler_stage_reference_id: input.from_scheduler_stage_reference_id,
    to_scheduler_stage_reference_id: input.to_scheduler_stage_reference_id,
    dependency_type: input.dependency_type,
    required: input.required === true,
    dependency_order: Number.isInteger(input.dependency_order) ? input.dependency_order : 0,
    source_dependency_fingerprint: input.source_dependency_fingerprint,
    dependency_validated: input.dependency_validated === true,
    would_block_target: input.would_block_target === true,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    dependency_fingerprint: 'pending',
    ...RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_VALIDATOR_VERSION
  };
  reference.dependency_fingerprint = computeSchedulerDependencyFingerprint(reference);

  const validation = validateRuntimeSchedulerDependencyReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_dependency_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_DEPENDENCY_ORDER,
  MAX_LIST_ITEMS,
  RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_FIELDS,
  RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_SAFE_FLAGS,
  RUNTIME_SCHEDULER_DEPENDENCY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeSchedulerDependencyReference,
  computeSchedulerDependencyFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeSchedulerDependencyReference
};
