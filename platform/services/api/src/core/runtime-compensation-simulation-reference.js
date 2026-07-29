'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { COMPENSATION_TYPES } = require('./execution-plan-compensation-reference');
const { CONDITION_TYPES } = require('./execution-plan-stop-condition');

// A declarative reference to a real ExecutionPlanCompensationReference (PR #98), bound to the
// runtime stage it would apply to. "Nenhuma compensação é executada" -- compensation_executed is
// always false. compensation_planned is always true, but only as a *declarative* reference: it
// records that a compensation plan exists and was validated, never that it ran.
const RUNTIME_COMPENSATION_SIMULATION_REFERENCE_VALIDATOR_VERSION = 'runtime_compensation_simulation_reference_validator_v1';

const RUNTIME_COMPENSATION_SIMULATION_REFERENCE_FIELDS = Object.freeze([
  'runtime_compensation_reference_id', 'runtime_compensation_reference_version', 'runtime_execution_package_id',
  'execution_plan_id', 'runtime_stage_reference_id', 'source_compensation_reference_id', 'compensation_type',
  'required', 'trigger_reference_types', 'compensation_stage_reference_ids', 'human_review_required',
  'compensation_validated', 'compensation_planned', 'compensation_executed', 'compensation_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_COMPENSATION_SIMULATION_REFERENCE_SAFE_FLAGS = Object.freeze({
  compensation_planned: true,
  compensation_executed: false,
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

function isOrderedUniqueConditionTypeList(list) {
  if (!Array.isArray(list) || list.length > CONDITION_TYPES.length) return false;
  if (!list.every((item) => CONDITION_TYPES.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeRuntimeCompensationReferenceFingerprint(reference) {
  const { compensation_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeCompensationSimulationReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_compensation_simulation_reference_must_be_object'] };
  exactFields(reference, RUNTIME_COMPENSATION_SIMULATION_REFERENCE_FIELDS, 'runtime_compensation_simulation_reference', errors);
  for (const field of [
    'runtime_compensation_reference_id', 'runtime_execution_package_id', 'execution_plan_id',
    'runtime_stage_reference_id', 'source_compensation_reference_id', 'compensation_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_compensation_reference_version) || reference.runtime_compensation_reference_version < 1) {
    errors.push('runtime_compensation_reference_version_invalid');
  }
  if (!COMPENSATION_TYPES.includes(reference.compensation_type)) errors.push(`compensation_type_not_allowed::${reference.compensation_type}`);
  for (const field of ['required', 'human_review_required', 'compensation_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!isOrderedUniqueConditionTypeList(reference.trigger_reference_types)) errors.push('trigger_reference_types_invalid');
  if (!isOrderedUniqueStringList(reference.compensation_stage_reference_ids)) errors.push('compensation_stage_reference_ids_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_COMPENSATION_SIMULATION_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_COMPENSATION_SIMULATION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeRuntimeCompensationReferenceFingerprint(reference) !== reference.compensation_fingerprint) errors.push('compensation_fingerprint_mismatch');
  } catch (error) {
    errors.push('compensation_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeCompensationSimulationReference(input = {}) {
  const reference = {
    runtime_compensation_reference_id: input.runtime_compensation_reference_id,
    runtime_compensation_reference_version: Number.isInteger(input.runtime_compensation_reference_version) ? input.runtime_compensation_reference_version : 1,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    source_compensation_reference_id: input.source_compensation_reference_id,
    compensation_type: input.compensation_type,
    required: input.required === true,
    trigger_reference_types: uniqueSorted(input.trigger_reference_types || []),
    compensation_stage_reference_ids: uniqueSorted(input.compensation_stage_reference_ids || []),
    human_review_required: input.human_review_required === true,
    compensation_validated: input.compensation_validated === true,
    compensation_fingerprint: 'pending',
    ...RUNTIME_COMPENSATION_SIMULATION_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_COMPENSATION_SIMULATION_REFERENCE_VALIDATOR_VERSION
  };
  reference.compensation_fingerprint = computeRuntimeCompensationReferenceFingerprint(reference);

  const validation = validateRuntimeCompensationSimulationReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_compensation_simulation_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_LIST_ITEMS,
  RUNTIME_COMPENSATION_SIMULATION_REFERENCE_FIELDS,
  RUNTIME_COMPENSATION_SIMULATION_REFERENCE_SAFE_FLAGS,
  RUNTIME_COMPENSATION_SIMULATION_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeCompensationSimulationReference,
  computeRuntimeCompensationReferenceFingerprint,
  isOrderedUniqueConditionTypeList,
  isOrderedUniqueStringList,
  validateRuntimeCompensationSimulationReference
};
