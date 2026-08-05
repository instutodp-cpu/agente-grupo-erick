'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr110: "A ordem global deve preservar integralmente a ordem oficial da PR109." `ordered_
// queue_materialization_entry_reference_ids` is copied verbatim from the Queue Materialization
// Order Reference's own field of the same name (never re-sorted, never independently derived) --
// `ordered_queue_placement_entry_reference_ids` mirrors it 1:1, positionally, with THIS layer's own
// entry IDs. `materialization_order_preserved` proves that copy is genuine; `predecessor_order_
// preserved` proves that grouping never inverts the relative order any two materialized entries
// already had -- "o agrupamento não pode alterar a ordem soberana."
//
// `ordered_queue_placement_group_reference_ids` orders GROUPS by the position their first member
// occupies in the global canonical order -- a genuine derivation from the sovereign order, never an
// incidental sort by group key or alphabetical key.
const RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_placement_order_reference_validator_v1';

const ORDERED_LIST_FIELDS = Object.freeze(['ordered_queue_materialization_entry_reference_ids', 'ordered_queue_placement_entry_reference_ids']);

const PARTITION_LIST_FIELDS = Object.freeze([
  'placed_queue_placement_entry_reference_ids', 'not_placed_queue_placement_entry_reference_ids'
]);

const ORDER_PRESERVED_FIELDS = Object.freeze(['materialization_order_preserved', 'predecessor_order_preserved']);

const COUNT_FIELDS = Object.freeze(['entry_count', 'placed_count', 'not_placed_count', 'group_count']);

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

const RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_placement_order_reference_id', 'runtime_queue_placement_order_reference_version',
  'runtime_queue_placement_package_id', 'runtime_queue_materialization_package_id',
  'runtime_queue_materialization_order_reference_id', 'runtime_queue_materialization_order_fingerprint',
  ...ORDERED_LIST_FIELDS,
  ...PARTITION_LIST_FIELDS,
  'ordered_queue_placement_group_reference_ids',
  ...ORDER_PRESERVED_FIELDS,
  ...COUNT_FIELDS,
  'queue_placement_order_validated', 'queue_placement_order_applied',
  'placement_order_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_SAFE_FLAGS = Object.freeze({
  queue_placement_order_applied: false,
  simulation: true,
  production_blocked: true
});

function computePlacementOrderFingerprint(reference) {
  const { placement_order_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueuePlacementOrderReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_placement_order_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_FIELDS, 'runtime_queue_placement_order_reference', errors);
  for (const field of [
    'runtime_queue_placement_order_reference_id', 'runtime_queue_placement_package_id',
    'runtime_queue_materialization_package_id', 'runtime_queue_materialization_order_reference_id',
    'runtime_queue_materialization_order_fingerprint', 'placement_order_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_placement_order_reference_version) || reference.runtime_queue_placement_order_reference_version < 1) {
    errors.push('runtime_queue_placement_order_reference_version_invalid');
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueList(reference[field])) errors.push(`${field}_invalid`);
  }
  for (const field of PARTITION_LIST_FIELDS) {
    if (!isSortedUniqueList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueList(reference.ordered_queue_placement_group_reference_ids)) errors.push('ordered_queue_placement_group_reference_ids_invalid');
  if (
    PARTITION_LIST_FIELDS.every((field) => Array.isArray(reference[field]))
    && Array.isArray(reference.ordered_queue_placement_entry_reference_ids)
  ) {
    const union = PARTITION_LIST_FIELDS.flatMap((field) => reference[field]);
    if (new Set(union).size !== union.length) errors.push('entry_partition_lists_overlap');
    if (
      union.length !== reference.ordered_queue_placement_entry_reference_ids.length
      || !union.every((id) => reference.ordered_queue_placement_entry_reference_ids.includes(id))
    ) {
      errors.push('entry_partition_lists_do_not_cover_ordered_entries');
    }
  }
  if (
    Array.isArray(reference.ordered_queue_materialization_entry_reference_ids)
    && Array.isArray(reference.ordered_queue_placement_entry_reference_ids)
    && reference.ordered_queue_materialization_entry_reference_ids.length !== reference.ordered_queue_placement_entry_reference_ids.length
  ) {
    errors.push('ordered_list_length_mismatch');
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (Array.isArray(reference.ordered_queue_placement_entry_reference_ids) && Number.isInteger(reference.entry_count) && reference.entry_count !== reference.ordered_queue_placement_entry_reference_ids.length) {
    errors.push('entry_count_inconsistent');
  }
  const partitionCountByField = {
    placed_queue_placement_entry_reference_ids: 'placed_count',
    not_placed_queue_placement_entry_reference_ids: 'not_placed_count'
  };
  for (const [listField, countField] of Object.entries(partitionCountByField)) {
    if (Array.isArray(reference[listField]) && Number.isInteger(reference[countField]) && reference[countField] !== reference[listField].length) {
      errors.push(`${countField}_inconsistent`);
    }
  }
  if (
    Array.isArray(reference.ordered_queue_placement_group_reference_ids) && Number.isInteger(reference.group_count)
    && reference.group_count !== reference.ordered_queue_placement_group_reference_ids.length
  ) {
    errors.push('group_count_inconsistent');
  }
  for (const field of [...ORDER_PRESERVED_FIELDS, 'queue_placement_order_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (ORDER_PRESERVED_FIELDS.every((field) => typeof reference[field] === 'boolean') && typeof reference.queue_placement_order_validated === 'boolean') {
    const expectedValidated = ORDER_PRESERVED_FIELDS.every((field) => reference[field] === true);
    if (reference.queue_placement_order_validated !== expectedValidated) errors.push('queue_placement_order_validated_inconsistent_with_preserved_flags');
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computePlacementOrderFingerprint(reference) !== reference.placement_order_fingerprint) errors.push('placement_order_fingerprint_mismatch');
  } catch (error) {
    errors.push('placement_order_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueuePlacementOrderReference(input = {}) {
  const orderedMaterializationIds = Array.isArray(input.ordered_queue_materialization_entry_reference_ids) ? input.ordered_queue_materialization_entry_reference_ids : [];
  const orderedEntryIds = Array.isArray(input.ordered_queue_placement_entry_reference_ids) ? input.ordered_queue_placement_entry_reference_ids : [];
  const placedIds = uniqueSorted(input.placed_queue_placement_entry_reference_ids || []);
  const notPlacedIds = uniqueSorted(input.not_placed_queue_placement_entry_reference_ids || []);
  const orderedGroupIds = Array.isArray(input.ordered_queue_placement_group_reference_ids) ? input.ordered_queue_placement_group_reference_ids : [];

  const reference = {
    runtime_queue_placement_order_reference_id: input.runtime_queue_placement_order_reference_id,
    runtime_queue_placement_order_reference_version: Number.isInteger(input.runtime_queue_placement_order_reference_version) ? input.runtime_queue_placement_order_reference_version : 1,
    runtime_queue_placement_package_id: input.runtime_queue_placement_package_id,
    runtime_queue_materialization_package_id: input.runtime_queue_materialization_package_id,
    runtime_queue_materialization_order_reference_id: input.runtime_queue_materialization_order_reference_id,
    runtime_queue_materialization_order_fingerprint: input.runtime_queue_materialization_order_fingerprint,
    ordered_queue_materialization_entry_reference_ids: orderedMaterializationIds,
    ordered_queue_placement_entry_reference_ids: orderedEntryIds,
    placed_queue_placement_entry_reference_ids: placedIds,
    not_placed_queue_placement_entry_reference_ids: notPlacedIds,
    ordered_queue_placement_group_reference_ids: orderedGroupIds,
    entry_count: orderedEntryIds.length,
    placed_count: placedIds.length,
    not_placed_count: notPlacedIds.length,
    group_count: orderedGroupIds.length,
    placement_order_fingerprint: 'pending',
    ...RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of ORDER_PRESERVED_FIELDS) {
    reference[field] = input[field] === true;
  }
  reference.queue_placement_order_validated = ORDER_PRESERVED_FIELDS.every((field) => reference[field] === true);
  reference.placement_order_fingerprint = computePlacementOrderFingerprint(reference);

  const validation = validateRuntimeQueuePlacementOrderReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_placement_order_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
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
  RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_FIELDS,
  RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_PLACEMENT_ORDER_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueuePlacementOrderReference,
  computePlacementOrderFingerprint,
  isOrderedUniqueList,
  isSortedUniqueList,
  validateRuntimeQueuePlacementOrderReference
};
