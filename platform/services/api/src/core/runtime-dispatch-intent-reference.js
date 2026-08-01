'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr107: the final, per-stage declarative outcome of dispatch preparation -- vinculates the Worker
// Binding/Dependency Gate/Approval Gate/Capacity/Budget/Payload references this stage produced into
// one status. Only `DISPATCH_INTENT_PREPARED_SIMULATION` means every one of the 6 gates passed;
// every other status means at least one did not. "Mesmo nesse status" the 5 operational flags stay
// permanently false -- an intent is only ever prepared, never authorized, applied, sent,
// acknowledged, or leased.
const RUNTIME_DISPATCH_INTENT_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_intent_reference_validator_v1';

const DISPATCH_INTENT_STATUSES = Object.freeze([
  'DISPATCH_INTENT_PREPARED_SIMULATION', 'DISPATCH_INTENT_WAITING_DEPENDENCY_REFERENCE',
  'DISPATCH_INTENT_WAITING_APPROVAL_REFERENCE', 'DISPATCH_INTENT_OPTIONAL_REFERENCE',
  'DISPATCH_INTENT_NO_WORKER_BLOCKED', 'DISPATCH_INTENT_CAPACITY_BLOCKED', 'DISPATCH_INTENT_BUDGET_BLOCKED',
  'DISPATCH_INTENT_POLICY_BLOCKED', 'DISPATCH_INTENT_BLOCKED'
]);

const GATE_PASSED_FIELDS = Object.freeze([
  'dependency_gate_passed', 'approval_gate_passed', 'capacity_gate_passed', 'budget_gate_passed',
  'worker_gate_passed', 'payload_gate_passed'
]);

const RUNTIME_DISPATCH_INTENT_REFERENCE_FIELDS = Object.freeze([
  'dispatch_intent_reference_id', 'dispatch_intent_reference_version',
  'runtime_dispatch_package_id', 'runtime_dispatch_request_id',
  'runtime_dispatch_stage_reference_id', 'dispatch_worker_binding_reference_id', 'dispatch_dependency_gate_reference_id',
  'dispatch_approval_gate_reference_id', 'dispatch_capacity_reference_id', 'dispatch_budget_reference_id',
  'dispatch_payload_reference_id',
  'scheduler_stage_reference_id', 'runtime_stage_reference_id', 'runtime_worker_reference_id',
  'dispatch_sequence', 'dispatch_intent_status',
  ...GATE_PASSED_FIELDS,
  'dispatch_intent_validated', 'dispatch_intent_applied', 'dispatch_authorized', 'dispatch_sent',
  'dispatch_acknowledged', 'dispatch_lease_created',
  'reason_codes',
  'dispatch_intent_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_INTENT_REFERENCE_SAFE_FLAGS = Object.freeze({
  dispatch_intent_applied: false,
  dispatch_authorized: false,
  dispatch_sent: false,
  dispatch_acknowledged: false,
  dispatch_lease_created: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 50;
const MAX_SEQUENCE = 1000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeDispatchIntentFingerprint(reference) {
  const { dispatch_intent_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchIntentReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_intent_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_INTENT_REFERENCE_FIELDS, 'runtime_dispatch_intent_reference', errors);
  for (const field of [
    'dispatch_intent_reference_id', 'runtime_dispatch_package_id', 'runtime_dispatch_request_id',
    'runtime_dispatch_stage_reference_id', 'dispatch_worker_binding_reference_id', 'dispatch_dependency_gate_reference_id',
    'dispatch_approval_gate_reference_id', 'dispatch_capacity_reference_id', 'dispatch_budget_reference_id',
    'dispatch_payload_reference_id', 'scheduler_stage_reference_id', 'runtime_stage_reference_id',
    'dispatch_intent_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (reference.runtime_worker_reference_id !== null && !isNonEmptyString(reference.runtime_worker_reference_id)) {
    errors.push('runtime_worker_reference_id_must_be_null_or_string');
  }
  if (!Number.isInteger(reference.dispatch_intent_reference_version) || reference.dispatch_intent_reference_version < 1) {
    errors.push('dispatch_intent_reference_version_invalid');
  }
  if (!Number.isInteger(reference.dispatch_sequence) || reference.dispatch_sequence < 0 || reference.dispatch_sequence > MAX_SEQUENCE) {
    errors.push('dispatch_sequence_invalid');
  }
  if (!DISPATCH_INTENT_STATUSES.includes(reference.dispatch_intent_status)) errors.push('dispatch_intent_status_invalid');
  for (const field of GATE_PASSED_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (GATE_PASSED_FIELDS.every((field) => typeof reference[field] === 'boolean') && isNonEmptyString(reference.dispatch_intent_status)) {
    const allGatesPassed = GATE_PASSED_FIELDS.every((field) => reference[field] === true);
    if (reference.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION' && !allGatesPassed) {
      errors.push('dispatch_intent_status_prepared_requires_every_gate_passed');
    }
    if (reference.dispatch_intent_status !== 'DISPATCH_INTENT_PREPARED_SIMULATION' && allGatesPassed) {
      errors.push('dispatch_intent_status_not_prepared_but_every_gate_passed');
    }
  }
  if (typeof reference.dispatch_intent_validated !== 'boolean') errors.push('dispatch_intent_validated_must_be_boolean');
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_INTENT_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_INTENT_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeDispatchIntentFingerprint(reference) !== reference.dispatch_intent_fingerprint) errors.push('dispatch_intent_fingerprint_mismatch');
  } catch (error) {
    errors.push('dispatch_intent_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchIntentReference(input = {}) {
  const status = DISPATCH_INTENT_STATUSES.includes(input.dispatch_intent_status) ? input.dispatch_intent_status : 'DISPATCH_INTENT_BLOCKED';
  const reference = {
    dispatch_intent_reference_id: input.dispatch_intent_reference_id,
    dispatch_intent_reference_version: Number.isInteger(input.dispatch_intent_reference_version) ? input.dispatch_intent_reference_version : 1,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_dispatch_request_id: input.runtime_dispatch_request_id,
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    dispatch_worker_binding_reference_id: input.dispatch_worker_binding_reference_id,
    dispatch_dependency_gate_reference_id: input.dispatch_dependency_gate_reference_id,
    dispatch_approval_gate_reference_id: input.dispatch_approval_gate_reference_id,
    dispatch_capacity_reference_id: input.dispatch_capacity_reference_id,
    dispatch_budget_reference_id: input.dispatch_budget_reference_id,
    dispatch_payload_reference_id: input.dispatch_payload_reference_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    runtime_worker_reference_id: input.runtime_worker_reference_id === undefined ? null : input.runtime_worker_reference_id,
    dispatch_sequence: Number.isInteger(input.dispatch_sequence) ? input.dispatch_sequence : 0,
    dispatch_intent_status: status,
    dispatch_intent_validated: true,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    dispatch_intent_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_INTENT_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_INTENT_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of GATE_PASSED_FIELDS) {
    reference[field] = input[field] === true;
  }

  reference.dispatch_intent_fingerprint = computeDispatchIntentFingerprint(reference);

  const validation = validateRuntimeDispatchIntentReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_intent_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  DISPATCH_INTENT_STATUSES,
  GATE_PASSED_FIELDS,
  MAX_LIST_ITEMS,
  MAX_SEQUENCE,
  RUNTIME_DISPATCH_INTENT_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_INTENT_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_INTENT_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDispatchIntentReference,
  computeDispatchIntentFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeDispatchIntentReference
};
