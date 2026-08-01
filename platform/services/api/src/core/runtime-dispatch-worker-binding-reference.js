'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { ASSIGNMENT_STATUSES } = require('./runtime-worker-stage-assignment-reference');

// pr107: "Dispatch não pode ser apenas stage ID + worker ID" -- revalidates the recommended worker
// genuinely still matches its own Stage Assignment/Candidate Set/Compatibility Reference, and that
// Health/Capacity are still valid at the Dispatch Request's own sequence (never trusted from the
// Worker Assignment layer's earlier, possibly-stale snapshot). worker_reserved/worker_started/
// worker_connection_opened stay permanently false -- this contract only ever revalidates a binding,
// never applies one.
const RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_worker_binding_reference_validator_v1';

const RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_FIELDS = Object.freeze([
  'dispatch_worker_binding_reference_id', 'dispatch_worker_binding_reference_version',
  'runtime_dispatch_package_id', 'runtime_worker_assignment_package_id', 'runtime_scheduler_package_id',
  'runtime_dispatch_stage_reference_id', 'scheduler_stage_reference_id', 'runtime_stage_reference_id',
  'worker_stage_assignment_reference_id', 'worker_candidate_set_reference_id', 'worker_compatibility_reference_id',
  'runtime_worker_reference_id', 'worker_capability_reference_id', 'worker_capacity_reference_id', 'worker_health_reference_id',
  'worker_assignment_status', 'worker_compatible', 'worker_health_valid_at_dispatch', 'worker_capacity_valid_at_dispatch',
  'worker_binding_validated', 'worker_binding_applied', 'worker_reserved', 'worker_started', 'worker_connection_opened',
  'reason_codes',
  'worker_binding_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_SAFE_FLAGS = Object.freeze({
  worker_binding_applied: false,
  worker_reserved: false,
  worker_started: false,
  worker_connection_opened: false,
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

function computeWorkerBindingFingerprint(reference) {
  const { worker_binding_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchWorkerBindingReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_worker_binding_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_FIELDS, 'runtime_dispatch_worker_binding_reference', errors);
  for (const field of [
    'dispatch_worker_binding_reference_id', 'runtime_dispatch_package_id', 'runtime_worker_assignment_package_id',
    'runtime_scheduler_package_id', 'runtime_dispatch_stage_reference_id', 'scheduler_stage_reference_id',
    'runtime_stage_reference_id', 'worker_stage_assignment_reference_id', 'worker_candidate_set_reference_id',
    'worker_compatibility_reference_id', 'runtime_worker_reference_id', 'worker_capability_reference_id',
    'worker_capacity_reference_id', 'worker_health_reference_id', 'worker_binding_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.dispatch_worker_binding_reference_version) || reference.dispatch_worker_binding_reference_version < 1) {
    errors.push('dispatch_worker_binding_reference_version_invalid');
  }
  if (!ASSIGNMENT_STATUSES.includes(reference.worker_assignment_status)) errors.push('worker_assignment_status_invalid');
  for (const field of ['worker_compatible', 'worker_health_valid_at_dispatch', 'worker_capacity_valid_at_dispatch', 'worker_binding_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeWorkerBindingFingerprint(reference) !== reference.worker_binding_fingerprint) errors.push('worker_binding_fingerprint_mismatch');
  } catch (error) {
    errors.push('worker_binding_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchWorkerBindingReference(input = {}) {
  const reference = {
    dispatch_worker_binding_reference_id: input.dispatch_worker_binding_reference_id,
    dispatch_worker_binding_reference_version: Number.isInteger(input.dispatch_worker_binding_reference_version) ? input.dispatch_worker_binding_reference_version : 1,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_worker_assignment_package_id: input.runtime_worker_assignment_package_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    worker_stage_assignment_reference_id: input.worker_stage_assignment_reference_id,
    worker_candidate_set_reference_id: input.worker_candidate_set_reference_id,
    worker_compatibility_reference_id: input.worker_compatibility_reference_id,
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    worker_capability_reference_id: input.worker_capability_reference_id,
    worker_capacity_reference_id: input.worker_capacity_reference_id,
    worker_health_reference_id: input.worker_health_reference_id,
    worker_assignment_status: input.worker_assignment_status,
    worker_compatible: input.worker_compatible === true,
    worker_health_valid_at_dispatch: input.worker_health_valid_at_dispatch === true,
    worker_capacity_valid_at_dispatch: input.worker_capacity_valid_at_dispatch === true,
    worker_binding_validated: input.worker_binding_validated === true,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    worker_binding_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_VALIDATOR_VERSION
  };
  reference.worker_binding_fingerprint = computeWorkerBindingFingerprint(reference);

  const validation = validateRuntimeDispatchWorkerBindingReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_worker_binding_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_LIST_ITEMS,
  RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_WORKER_BINDING_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDispatchWorkerBindingReference,
  computeWorkerBindingFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeDispatchWorkerBindingReference
};
