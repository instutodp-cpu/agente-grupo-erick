'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { CONDITION_TYPES } = require('./execution-plan-stop-condition');

const EXECUTION_PLAN_COMPENSATION_REFERENCE_VALIDATOR_VERSION = 'execution_plan_compensation_reference_validator_v1';

const EXECUTION_PLAN_COMPENSATION_REFERENCE_FIELDS = Object.freeze([
  'compensation_reference_id', 'compensation_reference_version', 'execution_plan_id', 'execution_stage_id',
  'compensation_type', 'required', 'trigger_reference_types', 'compensation_stage_reference_ids',
  'human_review_required', 'compensation_validated', 'compensation_executed', 'compensation_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const COMPENSATION_TYPES = Object.freeze([
  'NONE', 'ROLLBACK_REFERENCE', 'REVERSE_ACTION_REFERENCE', 'MANUAL_COMPENSATION_REFERENCE', 'HUMAN_COMPENSATION_REFERENCE'
]);

const EXECUTION_PLAN_COMPENSATION_REFERENCE_SAFE_FLAGS = Object.freeze({
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

function validateExecutionPlanCompensationReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['execution_plan_compensation_reference_must_be_object'] };
  exactFields(reference, EXECUTION_PLAN_COMPENSATION_REFERENCE_FIELDS, 'execution_plan_compensation_reference', errors);
  for (const field of ['compensation_reference_id', 'execution_plan_id', 'execution_stage_id', 'compensation_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.compensation_reference_version) || reference.compensation_reference_version < 1) errors.push('compensation_reference_version_invalid');
  if (!COMPENSATION_TYPES.includes(reference.compensation_type)) errors.push(`compensation_type_not_allowed::${reference.compensation_type}`);
  for (const field of ['required', 'human_review_required', 'compensation_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!isOrderedUniqueConditionTypeList(reference.trigger_reference_types)) errors.push('trigger_reference_types_invalid');
  if (!isOrderedUniqueStringList(reference.compensation_stage_reference_ids)) errors.push('compensation_stage_reference_ids_invalid');
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_COMPENSATION_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== EXECUTION_PLAN_COMPENSATION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeCompensationFingerprint(reference) {
  const { compensation_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function buildExecutionPlanCompensationReference(input = {}) {
  const reference = {
    compensation_reference_id: input.compensation_reference_id,
    compensation_reference_version: Number.isInteger(input.compensation_reference_version) ? input.compensation_reference_version : 1,
    execution_plan_id: input.execution_plan_id,
    execution_stage_id: input.execution_stage_id,
    compensation_type: input.compensation_type,
    required: input.required === true,
    trigger_reference_types: uniqueSorted(input.trigger_reference_types || []),
    compensation_stage_reference_ids: uniqueSorted(input.compensation_stage_reference_ids || []),
    human_review_required: input.human_review_required === true,
    compensation_validated: input.compensation_validated === true,
    compensation_executed: false,
    simulation: true,
    production_blocked: true,
    validator_version: EXECUTION_PLAN_COMPENSATION_REFERENCE_VALIDATOR_VERSION
  };
  reference.compensation_fingerprint = computeCompensationFingerprint({ ...reference, compensation_fingerprint: undefined });

  const validation = validateExecutionPlanCompensationReference(reference);
  if (!validation.valid) {
    throw new Error(`execution_plan_compensation_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  COMPENSATION_TYPES,
  EXECUTION_PLAN_COMPENSATION_REFERENCE_FIELDS,
  EXECUTION_PLAN_COMPENSATION_REFERENCE_SAFE_FLAGS,
  EXECUTION_PLAN_COMPENSATION_REFERENCE_VALIDATOR_VERSION,
  MAX_LIST_ITEMS,
  buildExecutionPlanCompensationReference,
  computeCompensationFingerprint,
  isOrderedUniqueStringList,
  validateExecutionPlanCompensationReference
};
