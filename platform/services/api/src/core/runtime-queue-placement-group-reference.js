'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr110: a purely declarative grouping of placed entries sharing the same `placement_group_key` --
// "uma vinculação declarativa entre uma materialization entry e um agrupamento lógico simulado."
// Never a real queue, topic, or partition. The group's own member order
// (`ordered_queue_placement_entry_reference_ids`) is always a genuine subsequence of the global
// canonical order the boundary already walked -- never independently sorted by group, key, or any
// other incidental criterion.
const RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_placement_group_reference_validator_v1';

const MAX_LIST_ITEMS = 500;

function isOrderedUniqueList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length > 0 && list.length <= maxItems && list.every(isNonEmptyString) && new Set(list).size === list.length;
}

const RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_placement_group_reference_id', 'runtime_queue_placement_group_reference_version',
  'runtime_queue_placement_package_id',
  'placement_group_key', 'runtime_queue_class_reference_id',
  'ordered_queue_placement_entry_reference_ids', 'member_count',
  'group_order_preserved',
  'queue_created',
  'placement_group_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_SAFE_FLAGS = Object.freeze({
  queue_created: false,
  simulation: true,
  production_blocked: true
});

function computePlacementGroupFingerprint(reference) {
  const { placement_group_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueuePlacementGroupReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_placement_group_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_FIELDS, 'runtime_queue_placement_group_reference', errors);
  for (const field of [
    'runtime_queue_placement_group_reference_id', 'runtime_queue_placement_package_id',
    'placement_group_key', 'runtime_queue_class_reference_id',
    'placement_group_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_placement_group_reference_version) || reference.runtime_queue_placement_group_reference_version < 1) {
    errors.push('runtime_queue_placement_group_reference_version_invalid');
  }
  if (!isOrderedUniqueList(reference.ordered_queue_placement_entry_reference_ids)) errors.push('ordered_queue_placement_entry_reference_ids_invalid');
  if (
    !Number.isInteger(reference.member_count) || reference.member_count < 1
    || (Array.isArray(reference.ordered_queue_placement_entry_reference_ids) && reference.member_count !== reference.ordered_queue_placement_entry_reference_ids.length)
  ) {
    errors.push('member_count_inconsistent');
  }
  if (typeof reference.group_order_preserved !== 'boolean') errors.push('group_order_preserved_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computePlacementGroupFingerprint(reference) !== reference.placement_group_fingerprint) errors.push('placement_group_fingerprint_mismatch');
  } catch (error) {
    errors.push('placement_group_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueuePlacementGroupReference(input = {}) {
  const orderedIds = Array.isArray(input.ordered_queue_placement_entry_reference_ids) ? input.ordered_queue_placement_entry_reference_ids : [];
  const reference = {
    runtime_queue_placement_group_reference_id: input.runtime_queue_placement_group_reference_id,
    runtime_queue_placement_group_reference_version: Number.isInteger(input.runtime_queue_placement_group_reference_version) ? input.runtime_queue_placement_group_reference_version : 1,
    runtime_queue_placement_package_id: input.runtime_queue_placement_package_id,
    placement_group_key: input.placement_group_key,
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id,
    ordered_queue_placement_entry_reference_ids: orderedIds,
    member_count: orderedIds.length,
    group_order_preserved: input.group_order_preserved === true,
    placement_group_fingerprint: 'pending',
    ...RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_VALIDATOR_VERSION
  };
  reference.placement_group_fingerprint = computePlacementGroupFingerprint(reference);

  const validation = validateRuntimeQueuePlacementGroupReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_placement_group_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_LIST_ITEMS,
  RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_FIELDS,
  RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_PLACEMENT_GROUP_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueuePlacementGroupReference,
  computePlacementGroupFingerprint,
  isOrderedUniqueList,
  validateRuntimeQueuePlacementGroupReference
};
