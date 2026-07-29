'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// A declarative plan of which events a future runtime *would* emit -- never emits one. "Nenhum
// evento deve ser emitido" -- event_emission_allowed and event_emitted are always false.
const RUNTIME_EVENT_PLAN_REFERENCE_VALIDATOR_VERSION = 'runtime_event_plan_reference_validator_v1';

const EVENT_TYPES = Object.freeze([
  'RUNTIME_PACKAGE_PREPARED_REFERENCE', 'RUNTIME_STAGE_PREPARED_REFERENCE', 'RUNTIME_DEPENDENCY_REGISTERED_REFERENCE',
  'RUNTIME_BUDGET_VALIDATED_REFERENCE', 'RUNTIME_STOP_REGISTERED_REFERENCE', 'RUNTIME_COMPENSATION_REGISTERED_REFERENCE',
  'RUNTIME_AUDIT_REFERENCE'
]);

const RUNTIME_EVENT_PLAN_REFERENCE_FIELDS = Object.freeze([
  'runtime_event_plan_reference_id', 'runtime_event_plan_reference_version', 'runtime_execution_package_id',
  'execution_plan_id', 'planned_event_ids', 'planned_event_types', 'event_count', 'event_plan_validated',
  'event_emission_allowed', 'event_emitted', 'event_plan_fingerprint', 'simulation', 'production_blocked',
  'validator_version'
]);

const RUNTIME_EVENT_PLAN_REFERENCE_SAFE_FLAGS = Object.freeze({
  event_emission_allowed: false,
  event_emitted: false,
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

function isOrderedUniqueEventTypeList(list) {
  if (!Array.isArray(list) || list.length > EVENT_TYPES.length) return false;
  if (!list.every((item) => EVENT_TYPES.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeRuntimeEventPlanReferenceFingerprint(reference) {
  const { event_plan_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeEventPlanReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_event_plan_reference_must_be_object'] };
  exactFields(reference, RUNTIME_EVENT_PLAN_REFERENCE_FIELDS, 'runtime_event_plan_reference', errors);
  for (const field of [
    'runtime_event_plan_reference_id', 'runtime_execution_package_id', 'execution_plan_id',
    'event_plan_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_event_plan_reference_version) || reference.runtime_event_plan_reference_version < 1) {
    errors.push('runtime_event_plan_reference_version_invalid');
  }
  if (!isOrderedUniqueStringList(reference.planned_event_ids)) errors.push('planned_event_ids_invalid');
  if (!isOrderedUniqueEventTypeList(reference.planned_event_types)) errors.push('planned_event_types_invalid');
  if (!Number.isInteger(reference.event_count) || reference.event_count < 0) errors.push('event_count_invalid');
  else if (Array.isArray(reference.planned_event_ids) && reference.event_count !== reference.planned_event_ids.length) {
    errors.push('event_count_inconsistent');
  }
  if (typeof reference.event_plan_validated !== 'boolean') errors.push('event_plan_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_EVENT_PLAN_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_EVENT_PLAN_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeRuntimeEventPlanReferenceFingerprint(reference) !== reference.event_plan_fingerprint) errors.push('event_plan_fingerprint_mismatch');
  } catch (error) {
    errors.push('event_plan_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeEventPlanReference(input = {}) {
  const plannedIds = Array.isArray(input.planned_event_ids) ? uniqueSorted(input.planned_event_ids) : [];
  const reference = {
    runtime_event_plan_reference_id: input.runtime_event_plan_reference_id,
    runtime_event_plan_reference_version: Number.isInteger(input.runtime_event_plan_reference_version) ? input.runtime_event_plan_reference_version : 1,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    planned_event_ids: plannedIds,
    planned_event_types: Array.isArray(input.planned_event_types) ? uniqueSorted(input.planned_event_types) : [],
    event_count: plannedIds.length,
    event_plan_validated: input.event_plan_validated === true,
    event_plan_fingerprint: 'pending',
    ...RUNTIME_EVENT_PLAN_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_EVENT_PLAN_REFERENCE_VALIDATOR_VERSION
  };
  reference.event_plan_fingerprint = computeRuntimeEventPlanReferenceFingerprint(reference);

  const validation = validateRuntimeEventPlanReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_event_plan_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  EVENT_TYPES,
  MAX_LIST_ITEMS,
  RUNTIME_EVENT_PLAN_REFERENCE_FIELDS,
  RUNTIME_EVENT_PLAN_REFERENCE_SAFE_FLAGS,
  RUNTIME_EVENT_PLAN_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeEventPlanReference,
  computeRuntimeEventPlanReferenceFingerprint,
  isOrderedUniqueEventTypeList,
  isOrderedUniqueStringList,
  validateRuntimeEventPlanReference
};
