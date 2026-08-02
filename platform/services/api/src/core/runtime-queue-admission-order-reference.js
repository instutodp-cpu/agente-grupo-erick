'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr108: "A ordem deve preservar a sequência do Dispatch Package." `ordered_dispatch_intent_reference_ids`
// preserves the genuine input order from the Dispatch Package's own Order Reference (never
// re-sorted); `ordered_queue_admission_entry_reference_ids` mirrors that same order 1:1 for the
// derived entries. Fairness may only reorder entries of the SAME priority class, and never breaks
// required-predecessor order or tenant isolation -- `dispatch_order_preserved`/
// `priority_order_preserved`/`fairness_order_preserved`/`required_predecessor_order_preserved` are
// computed by the boundary (which alone holds the full picture) and recorded here;
// `queue_admission_order_validated` is the one genuinely derived flag, true only when all four are
// true. "Nenhum score aleatório."
const RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_admission_order_reference_validator_v1';

const ORDERED_LIST_FIELDS = Object.freeze(['ordered_dispatch_intent_reference_ids', 'ordered_queue_admission_entry_reference_ids']);

const PARTITION_LIST_FIELDS = Object.freeze([
  'accepted_queue_admission_entry_reference_ids', 'deferred_queue_admission_entry_reference_ids',
  'waiting_queue_admission_entry_reference_ids', 'optional_queue_admission_entry_reference_ids',
  'blocked_queue_admission_entry_reference_ids'
]);

const ORDER_PRESERVED_FIELDS = Object.freeze([
  'dispatch_order_preserved', 'priority_order_preserved', 'fairness_order_preserved',
  'required_predecessor_order_preserved'
]);

const COUNT_FIELDS = Object.freeze([
  'entry_count', 'accepted_count', 'deferred_count', 'waiting_count', 'optional_count', 'blocked_count'
]);

const RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_admission_order_reference_id', 'runtime_queue_admission_order_reference_version',
  'runtime_queue_admission_package_id', 'runtime_dispatch_package_id',
  ...ORDERED_LIST_FIELDS,
  ...PARTITION_LIST_FIELDS,
  ...ORDER_PRESERVED_FIELDS,
  ...COUNT_FIELDS,
  'queue_admission_order_validated', 'queue_admission_order_applied',
  'order_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_SAFE_FLAGS = Object.freeze({
  queue_admission_order_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 500;
const MAX_COUNT = 100000;

function isOrderedUniqueList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString) && new Set(list).size === list.length;
}

function isSortedUniqueList(list, maxItems = MAX_LIST_ITEMS) {
  if (!isOrderedUniqueList(list, maxItems)) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeQueueAdmissionOrderFingerprint(reference) {
  const { order_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueueAdmissionOrderReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_admission_order_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_FIELDS, 'runtime_queue_admission_order_reference', errors);
  for (const field of [
    'runtime_queue_admission_order_reference_id', 'runtime_queue_admission_package_id', 'runtime_dispatch_package_id',
    'order_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_admission_order_reference_version) || reference.runtime_queue_admission_order_reference_version < 1) {
    errors.push('runtime_queue_admission_order_reference_version_invalid');
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueList(reference[field])) errors.push(`${field}_invalid`);
  }
  for (const field of PARTITION_LIST_FIELDS) {
    if (!isSortedUniqueList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (PARTITION_LIST_FIELDS.every((field) => Array.isArray(reference[field])) && Array.isArray(reference.ordered_queue_admission_entry_reference_ids)) {
    const union = PARTITION_LIST_FIELDS.flatMap((field) => reference[field]);
    if (new Set(union).size !== union.length) errors.push('entry_partition_lists_overlap');
    if (
      union.length !== reference.ordered_queue_admission_entry_reference_ids.length
      || !union.every((id) => reference.ordered_queue_admission_entry_reference_ids.includes(id))
    ) {
      errors.push('entry_partition_lists_do_not_cover_ordered_entries');
    }
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (Array.isArray(reference.ordered_queue_admission_entry_reference_ids) && Number.isInteger(reference.entry_count) && reference.entry_count !== reference.ordered_queue_admission_entry_reference_ids.length) {
    errors.push('entry_count_inconsistent');
  }
  const partitionCountByField = {
    accepted_queue_admission_entry_reference_ids: 'accepted_count', deferred_queue_admission_entry_reference_ids: 'deferred_count',
    waiting_queue_admission_entry_reference_ids: 'waiting_count', optional_queue_admission_entry_reference_ids: 'optional_count',
    blocked_queue_admission_entry_reference_ids: 'blocked_count'
  };
  for (const [listField, countField] of Object.entries(partitionCountByField)) {
    if (Array.isArray(reference[listField]) && Number.isInteger(reference[countField]) && reference[countField] !== reference[listField].length) {
      errors.push(`${countField}_inconsistent`);
    }
  }
  for (const field of [...ORDER_PRESERVED_FIELDS, 'queue_admission_order_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (ORDER_PRESERVED_FIELDS.every((field) => typeof reference[field] === 'boolean') && typeof reference.queue_admission_order_validated === 'boolean') {
    const expectedValidated = ORDER_PRESERVED_FIELDS.every((field) => reference[field] === true);
    if (reference.queue_admission_order_validated !== expectedValidated) errors.push('queue_admission_order_validated_inconsistent_with_preserved_flags');
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueueAdmissionOrderFingerprint(reference) !== reference.order_fingerprint) errors.push('order_fingerprint_mismatch');
  } catch (error) {
    errors.push('order_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueAdmissionOrderReference(input = {}) {
  const orderedIntentIds = Array.isArray(input.ordered_dispatch_intent_reference_ids) ? input.ordered_dispatch_intent_reference_ids : [];
  const orderedEntryIds = Array.isArray(input.ordered_queue_admission_entry_reference_ids) ? input.ordered_queue_admission_entry_reference_ids : [];
  const acceptedIds = uniqueSorted(input.accepted_queue_admission_entry_reference_ids || []);
  const deferredIds = uniqueSorted(input.deferred_queue_admission_entry_reference_ids || []);
  const waitingIds = uniqueSorted(input.waiting_queue_admission_entry_reference_ids || []);
  const optionalIds = uniqueSorted(input.optional_queue_admission_entry_reference_ids || []);
  const blockedIds = uniqueSorted(input.blocked_queue_admission_entry_reference_ids || []);

  const reference = {
    runtime_queue_admission_order_reference_id: input.runtime_queue_admission_order_reference_id,
    runtime_queue_admission_order_reference_version: Number.isInteger(input.runtime_queue_admission_order_reference_version) ? input.runtime_queue_admission_order_reference_version : 1,
    runtime_queue_admission_package_id: input.runtime_queue_admission_package_id,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    ordered_dispatch_intent_reference_ids: orderedIntentIds,
    ordered_queue_admission_entry_reference_ids: orderedEntryIds,
    accepted_queue_admission_entry_reference_ids: acceptedIds,
    deferred_queue_admission_entry_reference_ids: deferredIds,
    waiting_queue_admission_entry_reference_ids: waitingIds,
    optional_queue_admission_entry_reference_ids: optionalIds,
    blocked_queue_admission_entry_reference_ids: blockedIds,
    entry_count: orderedEntryIds.length,
    accepted_count: acceptedIds.length,
    deferred_count: deferredIds.length,
    waiting_count: waitingIds.length,
    optional_count: optionalIds.length,
    blocked_count: blockedIds.length,
    order_fingerprint: 'pending',
    ...RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of ORDER_PRESERVED_FIELDS) {
    reference[field] = input[field] === true;
  }
  reference.queue_admission_order_validated = ORDER_PRESERVED_FIELDS.every((field) => reference[field] === true);
  reference.order_fingerprint = computeQueueAdmissionOrderFingerprint(reference);

  const validation = validateRuntimeQueueAdmissionOrderReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_admission_order_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  COUNT_FIELDS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  ORDERED_LIST_FIELDS,
  ORDER_PRESERVED_FIELDS,
  PARTITION_LIST_FIELDS,
  RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_FIELDS,
  RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_ADMISSION_ORDER_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueueAdmissionOrderReference,
  computeQueueAdmissionOrderFingerprint,
  isOrderedUniqueList,
  isSortedUniqueList,
  validateRuntimeQueueAdmissionOrderReference
};
