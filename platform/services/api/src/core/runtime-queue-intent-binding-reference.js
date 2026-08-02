'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { DISPATCH_INTENT_STATUSES } = require('./runtime-dispatch-intent-reference');

// pr108: "Somente Dispatch Intent PREPARED pode obter binding válido para admissão." Binds a single
// Dispatch Intent to the Queue Class/Partition/Quota/Capacity Snapshot the boundary selected for it
// and records six independent match dimensions -- `intent_binding_validated` is genuinely derived
// (never caller-declared), true only when the intent is DISPATCH_INTENT_PREPARED_SIMULATION AND
// every one of the six dimensions matches. `queue_item_created`/`queue_item_enqueued`/
// `intent_binding_applied` are permanently forced `false`.
const RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_intent_binding_reference_validator_v1';

const MATCH_FIELDS = Object.freeze([
  'queue_class_match', 'partition_match', 'quota_match', 'capacity_match', 'fairness_match', 'freshness_match'
]);

const RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_FIELDS = Object.freeze([
  'queue_intent_binding_reference_id', 'queue_intent_binding_reference_version',
  'runtime_queue_admission_request_id', 'runtime_queue_admission_package_id',
  'runtime_dispatch_package_id', 'dispatch_intent_reference_id', 'runtime_dispatch_stage_reference_id',
  'dispatch_worker_binding_reference_id',
  'scheduler_stage_reference_id', 'runtime_stage_reference_id', 'runtime_worker_reference_id',
  'runtime_queue_class_reference_id', 'runtime_queue_partition_reference_id', 'runtime_queue_quota_reference_id',
  'runtime_queue_capacity_snapshot_reference_id',
  'dispatch_intent_status', ...MATCH_FIELDS,
  'intent_binding_validated', 'intent_binding_applied', 'queue_item_created', 'queue_item_enqueued',
  'reason_codes',
  'intent_binding_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_SAFE_FLAGS = Object.freeze({
  intent_binding_applied: false,
  queue_item_created: false,
  queue_item_enqueued: false,
  simulation: true,
  production_blocked: true
});

const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function computeQueueIntentBindingFingerprint(reference) {
  const { intent_binding_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueueIntentBindingReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_intent_binding_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_FIELDS, 'runtime_queue_intent_binding_reference', errors);
  for (const field of [
    'queue_intent_binding_reference_id', 'runtime_queue_admission_request_id', 'runtime_queue_admission_package_id',
    'runtime_dispatch_package_id', 'dispatch_intent_reference_id', 'runtime_dispatch_stage_reference_id',
    'dispatch_worker_binding_reference_id', 'scheduler_stage_reference_id', 'runtime_stage_reference_id',
    'runtime_queue_class_reference_id', 'runtime_queue_partition_reference_id', 'runtime_queue_quota_reference_id',
    'runtime_queue_capacity_snapshot_reference_id', 'intent_binding_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.queue_intent_binding_reference_version) || reference.queue_intent_binding_reference_version < 1) {
    errors.push('queue_intent_binding_reference_version_invalid');
  }
  if (reference.runtime_worker_reference_id !== null && !isNonEmptyString(reference.runtime_worker_reference_id)) {
    errors.push('runtime_worker_reference_id_must_be_null_or_string');
  }
  if (!DISPATCH_INTENT_STATUSES.includes(reference.dispatch_intent_status)) errors.push('dispatch_intent_status_invalid');
  for (const field of MATCH_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.intent_binding_validated !== 'boolean') errors.push('intent_binding_validated_must_be_boolean');
  else {
    const expectedValidated = reference.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION'
      && MATCH_FIELDS.every((field) => reference[field] === true);
    if (reference.intent_binding_validated !== expectedValidated) errors.push('intent_binding_validated_inconsistent_with_status_and_matches');
  }
  if (!isSanitizedList(reference.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueueIntentBindingFingerprint(reference) !== reference.intent_binding_fingerprint) errors.push('intent_binding_fingerprint_mismatch');
  } catch (error) {
    errors.push('intent_binding_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueIntentBindingReference(input = {}) {
  const reference = {
    queue_intent_binding_reference_id: input.queue_intent_binding_reference_id,
    queue_intent_binding_reference_version: Number.isInteger(input.queue_intent_binding_reference_version) ? input.queue_intent_binding_reference_version : 1,
    runtime_queue_admission_request_id: input.runtime_queue_admission_request_id,
    runtime_queue_admission_package_id: input.runtime_queue_admission_package_id,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    dispatch_intent_reference_id: input.dispatch_intent_reference_id,
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    dispatch_worker_binding_reference_id: input.dispatch_worker_binding_reference_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    runtime_worker_reference_id: input.runtime_worker_reference_id === undefined ? null : input.runtime_worker_reference_id,
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id,
    runtime_queue_partition_reference_id: input.runtime_queue_partition_reference_id,
    runtime_queue_quota_reference_id: input.runtime_queue_quota_reference_id,
    runtime_queue_capacity_snapshot_reference_id: input.runtime_queue_capacity_snapshot_reference_id,
    dispatch_intent_status: input.dispatch_intent_status,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    intent_binding_fingerprint: 'pending',
    ...RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of MATCH_FIELDS) {
    reference[field] = input[field] === true;
  }
  reference.intent_binding_validated = reference.dispatch_intent_status === 'DISPATCH_INTENT_PREPARED_SIMULATION'
    && MATCH_FIELDS.every((field) => reference[field] === true);
  reference.intent_binding_fingerprint = computeQueueIntentBindingFingerprint(reference);

  const validation = validateRuntimeQueueIntentBindingReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_intent_binding_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MATCH_FIELDS,
  MAX_REASON_CODES,
  RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_FIELDS,
  RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_INTENT_BINDING_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueueIntentBindingReference,
  computeQueueIntentBindingFingerprint,
  validateRuntimeQueueIntentBindingReference
};
