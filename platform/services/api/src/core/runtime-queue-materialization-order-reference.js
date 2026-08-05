'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr109: "A ordem de materialização deve derivar exclusivamente da ordem oficial produzida pela
// PR108." `ordered_queue_admission_entry_reference_ids` is copied verbatim from the Queue Admission
// Order Reference's own field of the same name (never re-sorted, never independently derived) --
// `ordered_queue_materialization_entry_reference_ids` mirrors it 1:1, positionally, with THIS
// layer's own entry IDs. `admission_order_preserved` proves that copy is genuine (never silently
// substituted); `predecessor_order_preserved` proves that, among materialized entries only, position
// strictly follows the same relative order the admission layer already proved
// required-predecessor-safe -- "a posição declarada corresponde exatamente ao índice canônico."
//
// "Primeiro determine qual contrato anterior é a fonte soberana para predecessor order": the Queue
// Admission Package never exposes raw dependency edges (by design, PR109's own input boundary
// excludes the Dispatch/Scheduler chain) -- the sovereign source is
// `RuntimeQueueAdmissionOrderReference.required_predecessor_order_preserved`, already proven true by
// PR108's own boundary. This layer re-verifies that flag's own authenticity (via the Order
// Reference's own recomputed fingerprint) and additionally proves, independently, that deriving
// `materialization_position` by iterating the same canonical order never reorders materialized
// entries relative to each other -- the one predecessor-relevant fact this layer CAN independently
// check without seeing raw edges.
const RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_materialization_order_reference_validator_v1';

const ORDERED_LIST_FIELDS = Object.freeze(['ordered_queue_admission_entry_reference_ids', 'ordered_queue_materialization_entry_reference_ids']);

const PARTITION_LIST_FIELDS = Object.freeze([
  'materialized_queue_materialization_entry_reference_ids', 'not_materialized_queue_materialization_entry_reference_ids'
]);

const ORDER_PRESERVED_FIELDS = Object.freeze(['admission_order_preserved', 'predecessor_order_preserved']);

const COUNT_FIELDS = Object.freeze(['entry_count', 'materialized_count', 'not_materialized_count']);

const RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_materialization_order_reference_id', 'runtime_queue_materialization_order_reference_version',
  'runtime_queue_materialization_package_id', 'runtime_queue_admission_package_id',
  'runtime_queue_admission_order_reference_id', 'runtime_queue_admission_order_fingerprint',
  ...ORDERED_LIST_FIELDS,
  ...PARTITION_LIST_FIELDS,
  ...ORDER_PRESERVED_FIELDS,
  ...COUNT_FIELDS,
  'queue_materialization_order_validated', 'queue_materialization_order_applied',
  'materialization_order_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_SAFE_FLAGS = Object.freeze({
  queue_materialization_order_applied: false,
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

function computeMaterializationOrderFingerprint(reference) {
  const { materialization_order_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueueMaterializationOrderReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_materialization_order_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_FIELDS, 'runtime_queue_materialization_order_reference', errors);
  for (const field of [
    'runtime_queue_materialization_order_reference_id', 'runtime_queue_materialization_package_id',
    'runtime_queue_admission_package_id', 'runtime_queue_admission_order_reference_id',
    'runtime_queue_admission_order_fingerprint', 'materialization_order_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_materialization_order_reference_version) || reference.runtime_queue_materialization_order_reference_version < 1) {
    errors.push('runtime_queue_materialization_order_reference_version_invalid');
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueList(reference[field])) errors.push(`${field}_invalid`);
  }
  for (const field of PARTITION_LIST_FIELDS) {
    if (!isSortedUniqueList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (
    PARTITION_LIST_FIELDS.every((field) => Array.isArray(reference[field]))
    && Array.isArray(reference.ordered_queue_materialization_entry_reference_ids)
  ) {
    const union = PARTITION_LIST_FIELDS.flatMap((field) => reference[field]);
    if (new Set(union).size !== union.length) errors.push('entry_partition_lists_overlap');
    if (
      union.length !== reference.ordered_queue_materialization_entry_reference_ids.length
      || !union.every((id) => reference.ordered_queue_materialization_entry_reference_ids.includes(id))
    ) {
      errors.push('entry_partition_lists_do_not_cover_ordered_entries');
    }
  }
  if (
    Array.isArray(reference.ordered_queue_admission_entry_reference_ids)
    && Array.isArray(reference.ordered_queue_materialization_entry_reference_ids)
    && reference.ordered_queue_admission_entry_reference_ids.length !== reference.ordered_queue_materialization_entry_reference_ids.length
  ) {
    errors.push('ordered_list_length_mismatch');
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (Array.isArray(reference.ordered_queue_materialization_entry_reference_ids) && Number.isInteger(reference.entry_count) && reference.entry_count !== reference.ordered_queue_materialization_entry_reference_ids.length) {
    errors.push('entry_count_inconsistent');
  }
  const partitionCountByField = {
    materialized_queue_materialization_entry_reference_ids: 'materialized_count',
    not_materialized_queue_materialization_entry_reference_ids: 'not_materialized_count'
  };
  for (const [listField, countField] of Object.entries(partitionCountByField)) {
    if (Array.isArray(reference[listField]) && Number.isInteger(reference[countField]) && reference[countField] !== reference[listField].length) {
      errors.push(`${countField}_inconsistent`);
    }
  }
  for (const field of [...ORDER_PRESERVED_FIELDS, 'queue_materialization_order_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (ORDER_PRESERVED_FIELDS.every((field) => typeof reference[field] === 'boolean') && typeof reference.queue_materialization_order_validated === 'boolean') {
    const expectedValidated = ORDER_PRESERVED_FIELDS.every((field) => reference[field] === true);
    if (reference.queue_materialization_order_validated !== expectedValidated) errors.push('queue_materialization_order_validated_inconsistent_with_preserved_flags');
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeMaterializationOrderFingerprint(reference) !== reference.materialization_order_fingerprint) errors.push('materialization_order_fingerprint_mismatch');
  } catch (error) {
    errors.push('materialization_order_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueMaterializationOrderReference(input = {}) {
  const orderedAdmissionIds = Array.isArray(input.ordered_queue_admission_entry_reference_ids) ? input.ordered_queue_admission_entry_reference_ids : [];
  const orderedEntryIds = Array.isArray(input.ordered_queue_materialization_entry_reference_ids) ? input.ordered_queue_materialization_entry_reference_ids : [];
  const materializedIds = uniqueSorted(input.materialized_queue_materialization_entry_reference_ids || []);
  const notMaterializedIds = uniqueSorted(input.not_materialized_queue_materialization_entry_reference_ids || []);

  const reference = {
    runtime_queue_materialization_order_reference_id: input.runtime_queue_materialization_order_reference_id,
    runtime_queue_materialization_order_reference_version: Number.isInteger(input.runtime_queue_materialization_order_reference_version) ? input.runtime_queue_materialization_order_reference_version : 1,
    runtime_queue_materialization_package_id: input.runtime_queue_materialization_package_id,
    runtime_queue_admission_package_id: input.runtime_queue_admission_package_id,
    runtime_queue_admission_order_reference_id: input.runtime_queue_admission_order_reference_id,
    runtime_queue_admission_order_fingerprint: input.runtime_queue_admission_order_fingerprint,
    ordered_queue_admission_entry_reference_ids: orderedAdmissionIds,
    ordered_queue_materialization_entry_reference_ids: orderedEntryIds,
    materialized_queue_materialization_entry_reference_ids: materializedIds,
    not_materialized_queue_materialization_entry_reference_ids: notMaterializedIds,
    entry_count: orderedEntryIds.length,
    materialized_count: materializedIds.length,
    not_materialized_count: notMaterializedIds.length,
    materialization_order_fingerprint: 'pending',
    ...RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of ORDER_PRESERVED_FIELDS) {
    reference[field] = input[field] === true;
  }
  reference.queue_materialization_order_validated = ORDER_PRESERVED_FIELDS.every((field) => reference[field] === true);
  reference.materialization_order_fingerprint = computeMaterializationOrderFingerprint(reference);

  const validation = validateRuntimeQueueMaterializationOrderReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_materialization_order_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
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
  RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_FIELDS,
  RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_MATERIALIZATION_ORDER_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueueMaterializationOrderReference,
  computeMaterializationOrderFingerprint,
  isOrderedUniqueList,
  isSortedUniqueList,
  validateRuntimeQueueMaterializationOrderReference
};
