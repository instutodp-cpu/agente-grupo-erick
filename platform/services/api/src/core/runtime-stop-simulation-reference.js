'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { CONDITION_TYPES } = require('./execution-plan-stop-condition');

// A declarative reference to a real ExecutionPlanStopCondition (PR #98), bound to the runtime
// stage it would apply to. "Nenhuma condição é avaliada" -- stop_condition_evaluated/
// stop_condition_triggered/stop_applied are always false; only stop_validated (a structural/
// binding cross-check, never a live evaluation) can legitimately vary.
const RUNTIME_STOP_SIMULATION_REFERENCE_VALIDATOR_VERSION = 'runtime_stop_simulation_reference_validator_v1';

const RUNTIME_STOP_SIMULATION_REFERENCE_FIELDS = Object.freeze([
  'runtime_stop_reference_id', 'runtime_stop_reference_version', 'runtime_execution_package_id', 'execution_plan_id',
  'runtime_stage_reference_id', 'source_stop_condition_id', 'condition_type', 'condition_priority', 'blocking',
  'terminal', 'evaluation_reference_id', 'stop_validated', 'stop_condition_evaluated', 'stop_condition_triggered',
  'stop_applied', 'reason_codes', 'stop_fingerprint', 'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_STOP_SIMULATION_REFERENCE_SAFE_FLAGS = Object.freeze({
  stop_condition_evaluated: false,
  stop_condition_triggered: false,
  stop_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_PRIORITY = 1000000;
const MAX_LIST_ITEMS = 50;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeRuntimeStopReferenceFingerprint(reference) {
  const { stop_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeStopSimulationReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_stop_simulation_reference_must_be_object'] };
  exactFields(reference, RUNTIME_STOP_SIMULATION_REFERENCE_FIELDS, 'runtime_stop_simulation_reference', errors);
  for (const field of [
    'runtime_stop_reference_id', 'runtime_execution_package_id', 'execution_plan_id', 'runtime_stage_reference_id',
    'source_stop_condition_id', 'evaluation_reference_id', 'stop_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_stop_reference_version) || reference.runtime_stop_reference_version < 1) {
    errors.push('runtime_stop_reference_version_invalid');
  }
  if (!CONDITION_TYPES.includes(reference.condition_type)) errors.push(`condition_type_not_allowed::${reference.condition_type}`);
  if (!Number.isInteger(reference.condition_priority) || reference.condition_priority < 0 || reference.condition_priority > MAX_PRIORITY) {
    errors.push('condition_priority_invalid');
  }
  for (const field of ['blocking', 'terminal', 'stop_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_STOP_SIMULATION_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_STOP_SIMULATION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeRuntimeStopReferenceFingerprint(reference) !== reference.stop_fingerprint) errors.push('stop_fingerprint_mismatch');
  } catch (error) {
    errors.push('stop_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeStopSimulationReference(input = {}) {
  const reference = {
    runtime_stop_reference_id: input.runtime_stop_reference_id,
    runtime_stop_reference_version: Number.isInteger(input.runtime_stop_reference_version) ? input.runtime_stop_reference_version : 1,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    source_stop_condition_id: input.source_stop_condition_id,
    condition_type: input.condition_type,
    condition_priority: Number.isInteger(input.condition_priority) ? input.condition_priority : 0,
    blocking: input.blocking === true,
    terminal: input.terminal === true,
    evaluation_reference_id: input.evaluation_reference_id,
    stop_validated: input.stop_validated === true,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    stop_fingerprint: 'pending',
    ...RUNTIME_STOP_SIMULATION_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_STOP_SIMULATION_REFERENCE_VALIDATOR_VERSION
  };
  reference.stop_fingerprint = computeRuntimeStopReferenceFingerprint(reference);

  const validation = validateRuntimeStopSimulationReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_stop_simulation_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_LIST_ITEMS,
  MAX_PRIORITY,
  RUNTIME_STOP_SIMULATION_REFERENCE_FIELDS,
  RUNTIME_STOP_SIMULATION_REFERENCE_SAFE_FLAGS,
  RUNTIME_STOP_SIMULATION_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeStopSimulationReference,
  computeRuntimeStopReferenceFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeStopSimulationReference
};
