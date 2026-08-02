'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { QUEUE_PRIORITY_CLASSES } = require('./runtime-queue-class-reference');

// pr108: the per-intent admission decision -- "Somente QUEUE_ADMISSION_ACCEPTED_SIMULATION entra na
// lista de entries aceitas." `queue_admission_validated` is genuinely derived (never
// caller-declared): true only when `admission_status === QUEUE_ADMISSION_ACCEPTED_SIMULATION` AND
// every one of the 8 gates passed. "Mesmo nesse status": queue_admission_applied/queue_created/
// queue_item_created/queue_item_enqueued/queue_position_reserved are permanently forced `false`.
const RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_admission_entry_reference_validator_v1';

const ADMISSION_STATUSES = Object.freeze([
  'QUEUE_ADMISSION_ACCEPTED_SIMULATION', 'QUEUE_ADMISSION_DEFERRED_QUOTA_REFERENCE',
  'QUEUE_ADMISSION_DEFERRED_BACKLOG_REFERENCE', 'QUEUE_ADMISSION_DEFERRED_FAIRNESS_REFERENCE',
  'QUEUE_ADMISSION_WAITING_DEPENDENCY_REFERENCE', 'QUEUE_ADMISSION_WAITING_APPROVAL_REFERENCE',
  'QUEUE_ADMISSION_OPTIONAL_REFERENCE', 'QUEUE_ADMISSION_QUEUE_CLASS_BLOCKED', 'QUEUE_ADMISSION_PARTITION_BLOCKED',
  'QUEUE_ADMISSION_CAPACITY_BLOCKED', 'QUEUE_ADMISSION_BUDGET_BLOCKED', 'QUEUE_ADMISSION_POLICY_BLOCKED',
  'QUEUE_ADMISSION_NO_WORKER_BLOCKED', 'QUEUE_ADMISSION_BLOCKED'
]);

const GATE_PASSED_FIELDS = Object.freeze([
  'queue_class_gate_passed', 'partition_gate_passed', 'quota_gate_passed', 'capacity_gate_passed',
  'fairness_gate_passed', 'freshness_gate_passed', 'replay_gate_passed', 'idempotency_gate_passed'
]);

const RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_admission_entry_reference_id', 'runtime_queue_admission_entry_reference_version',
  'runtime_queue_admission_package_id', 'runtime_queue_admission_request_id',
  'queue_intent_binding_reference_id', 'runtime_queue_fairness_reference_id',
  'dispatch_intent_reference_id', 'runtime_dispatch_stage_reference_id', 'runtime_worker_reference_id',
  'runtime_queue_class_reference_id', 'runtime_queue_partition_reference_id',
  'admission_sequence', 'queue_priority_class', 'admission_status',
  ...GATE_PASSED_FIELDS,
  'queue_admission_validated', 'queue_admission_applied', 'queue_created', 'queue_item_created',
  'queue_item_enqueued', 'queue_position_reserved',
  'reason_codes',
  'admission_entry_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_SAFE_FLAGS = Object.freeze({
  queue_admission_applied: false,
  queue_created: false,
  queue_item_created: false,
  queue_item_enqueued: false,
  queue_position_reserved: false,
  simulation: true,
  production_blocked: true
});

const MAX_SEQUENCE = 1000000;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function computeAdmissionEntryFingerprint(reference) {
  const { admission_entry_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueueAdmissionEntryReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_admission_entry_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_FIELDS, 'runtime_queue_admission_entry_reference', errors);
  for (const field of [
    'runtime_queue_admission_entry_reference_id', 'runtime_queue_admission_package_id',
    'runtime_queue_admission_request_id', 'queue_intent_binding_reference_id', 'runtime_queue_fairness_reference_id',
    'dispatch_intent_reference_id', 'runtime_dispatch_stage_reference_id', 'admission_entry_fingerprint',
    'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_admission_entry_reference_version) || reference.runtime_queue_admission_entry_reference_version < 1) {
    errors.push('runtime_queue_admission_entry_reference_version_invalid');
  }
  for (const field of ['runtime_worker_reference_id', 'runtime_queue_class_reference_id', 'runtime_queue_partition_reference_id']) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!Number.isInteger(reference.admission_sequence) || reference.admission_sequence < 0 || reference.admission_sequence > MAX_SEQUENCE) {
    errors.push('admission_sequence_invalid');
  }
  if (!QUEUE_PRIORITY_CLASSES.includes(reference.queue_priority_class)) errors.push('queue_priority_class_invalid');
  if (!ADMISSION_STATUSES.includes(reference.admission_status)) errors.push('admission_status_invalid');
  for (const field of GATE_PASSED_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.queue_admission_validated !== 'boolean') errors.push('queue_admission_validated_must_be_boolean');
  else {
    const expectedValidated = reference.admission_status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION'
      && GATE_PASSED_FIELDS.every((field) => reference[field] === true);
    if (reference.queue_admission_validated !== expectedValidated) errors.push('queue_admission_validated_inconsistent_with_status_and_gates');
  }
  if (!isSanitizedList(reference.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeAdmissionEntryFingerprint(reference) !== reference.admission_entry_fingerprint) errors.push('admission_entry_fingerprint_mismatch');
  } catch (error) {
    errors.push('admission_entry_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueAdmissionEntryReference(input = {}) {
  const status = ADMISSION_STATUSES.includes(input.admission_status) ? input.admission_status : 'QUEUE_ADMISSION_BLOCKED';
  const reference = {
    runtime_queue_admission_entry_reference_id: input.runtime_queue_admission_entry_reference_id,
    runtime_queue_admission_entry_reference_version: Number.isInteger(input.runtime_queue_admission_entry_reference_version) ? input.runtime_queue_admission_entry_reference_version : 1,
    runtime_queue_admission_package_id: input.runtime_queue_admission_package_id,
    runtime_queue_admission_request_id: input.runtime_queue_admission_request_id,
    queue_intent_binding_reference_id: input.queue_intent_binding_reference_id,
    runtime_queue_fairness_reference_id: input.runtime_queue_fairness_reference_id,
    dispatch_intent_reference_id: input.dispatch_intent_reference_id,
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    runtime_worker_reference_id: input.runtime_worker_reference_id === undefined ? null : input.runtime_worker_reference_id,
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id === undefined ? null : input.runtime_queue_class_reference_id,
    runtime_queue_partition_reference_id: input.runtime_queue_partition_reference_id === undefined ? null : input.runtime_queue_partition_reference_id,
    admission_sequence: Number.isInteger(input.admission_sequence) ? input.admission_sequence : 0,
    queue_priority_class: input.queue_priority_class,
    admission_status: status,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    admission_entry_fingerprint: 'pending',
    ...RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of GATE_PASSED_FIELDS) {
    reference[field] = input[field] === true;
  }
  reference.queue_admission_validated = status === 'QUEUE_ADMISSION_ACCEPTED_SIMULATION'
    && GATE_PASSED_FIELDS.every((field) => reference[field] === true);
  reference.admission_entry_fingerprint = computeAdmissionEntryFingerprint(reference);

  const validation = validateRuntimeQueueAdmissionEntryReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_admission_entry_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  ADMISSION_STATUSES,
  GATE_PASSED_FIELDS,
  MAX_REASON_CODES,
  MAX_SEQUENCE,
  RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_FIELDS,
  RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_ADMISSION_ENTRY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueueAdmissionEntryReference,
  computeAdmissionEntryFingerprint,
  validateRuntimeQueueAdmissionEntryReference
};
