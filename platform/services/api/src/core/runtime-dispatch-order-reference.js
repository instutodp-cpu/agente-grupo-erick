'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr107: "A ordem de dispatch é uma subsequência estável da ordem topológica do Scheduler Package."
// `ordered_dispatch_stage_reference_ids`/`ordered_dispatch_intent_reference_ids` preserve genuine
// input order (never re-sorted -- unlike every other ID list in this lineage, order here is the
// entire point), while the 5 partition lists stay canonically sorted-unique for lookup. "Não
// recalcular por score." `scheduler_order_preserved`/`required_predecessor_order_preserved` are
// computed by the boundary (which alone holds the full Scheduler Package dependency graph) and
// recorded here, never independently re-derived by this contract in isolation --
// `dispatch_order_validated` is the one genuinely derived flag, true only when both are true.
const RUNTIME_DISPATCH_ORDER_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_order_reference_validator_v1';

const ORDERED_LIST_FIELDS = Object.freeze(['ordered_dispatch_stage_reference_ids', 'ordered_dispatch_intent_reference_ids']);

const PARTITION_LIST_FIELDS = Object.freeze([
  'prepared_dispatch_intent_reference_ids', 'waiting_dependency_intent_reference_ids',
  'waiting_approval_intent_reference_ids', 'optional_intent_reference_ids', 'blocked_intent_reference_ids'
]);

const COUNT_FIELDS = Object.freeze([
  'dispatch_stage_count', 'dispatch_intent_count', 'prepared_intent_count', 'waiting_dependency_count',
  'waiting_approval_count', 'optional_count', 'blocked_count'
]);

const RUNTIME_DISPATCH_ORDER_REFERENCE_FIELDS = Object.freeze([
  'dispatch_order_reference_id', 'dispatch_order_reference_version',
  'runtime_dispatch_package_id', 'runtime_scheduler_package_id',
  ...ORDERED_LIST_FIELDS,
  ...PARTITION_LIST_FIELDS,
  ...COUNT_FIELDS,
  'scheduler_order_preserved', 'required_predecessor_order_preserved', 'dispatch_order_validated', 'dispatch_order_applied',
  'order_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_ORDER_REFERENCE_SAFE_FLAGS = Object.freeze({
  dispatch_order_applied: false,
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

function computeDispatchOrderFingerprint(reference) {
  const { order_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchOrderReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_order_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_ORDER_REFERENCE_FIELDS, 'runtime_dispatch_order_reference', errors);
  for (const field of ['dispatch_order_reference_id', 'runtime_dispatch_package_id', 'runtime_scheduler_package_id', 'order_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.dispatch_order_reference_version) || reference.dispatch_order_reference_version < 1) {
    errors.push('dispatch_order_reference_version_invalid');
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueList(reference[field])) errors.push(`${field}_invalid`);
  }
  for (const field of PARTITION_LIST_FIELDS) {
    if (!isSortedUniqueList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (
    PARTITION_LIST_FIELDS.every((field) => Array.isArray(reference[field])) && Array.isArray(reference.ordered_dispatch_intent_reference_ids)
  ) {
    const union = PARTITION_LIST_FIELDS.flatMap((field) => reference[field]);
    if (new Set(union).size !== union.length) errors.push('intent_partition_lists_overlap');
    if (union.length !== reference.ordered_dispatch_intent_reference_ids.length || !union.every((id) => reference.ordered_dispatch_intent_reference_ids.includes(id))) {
      errors.push('intent_partition_lists_do_not_cover_ordered_intents');
    }
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (Array.isArray(reference.ordered_dispatch_stage_reference_ids) && Number.isInteger(reference.dispatch_stage_count) && reference.dispatch_stage_count !== reference.ordered_dispatch_stage_reference_ids.length) {
    errors.push('dispatch_stage_count_inconsistent');
  }
  if (Array.isArray(reference.ordered_dispatch_intent_reference_ids) && Number.isInteger(reference.dispatch_intent_count) && reference.dispatch_intent_count !== reference.ordered_dispatch_intent_reference_ids.length) {
    errors.push('dispatch_intent_count_inconsistent');
  }
  const partitionCountByField = {
    prepared_dispatch_intent_reference_ids: 'prepared_intent_count', waiting_dependency_intent_reference_ids: 'waiting_dependency_count',
    waiting_approval_intent_reference_ids: 'waiting_approval_count', optional_intent_reference_ids: 'optional_count',
    blocked_intent_reference_ids: 'blocked_count'
  };
  for (const [listField, countField] of Object.entries(partitionCountByField)) {
    if (Array.isArray(reference[listField]) && Number.isInteger(reference[countField]) && reference[countField] !== reference[listField].length) {
      errors.push(`${countField}_inconsistent`);
    }
  }
  for (const field of ['scheduler_order_preserved', 'required_predecessor_order_preserved', 'dispatch_order_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.scheduler_order_preserved === 'boolean' && typeof reference.required_predecessor_order_preserved === 'boolean' && typeof reference.dispatch_order_validated === 'boolean') {
    const expectedValidated = reference.scheduler_order_preserved === true && reference.required_predecessor_order_preserved === true;
    if (reference.dispatch_order_validated !== expectedValidated) errors.push('dispatch_order_validated_inconsistent_with_preserved_flags');
  }
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_ORDER_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_ORDER_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeDispatchOrderFingerprint(reference) !== reference.order_fingerprint) errors.push('order_fingerprint_mismatch');
  } catch (error) {
    errors.push('order_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchOrderReference(input = {}) {
  const orderedStageIds = Array.isArray(input.ordered_dispatch_stage_reference_ids) ? input.ordered_dispatch_stage_reference_ids : [];
  const orderedIntentIds = Array.isArray(input.ordered_dispatch_intent_reference_ids) ? input.ordered_dispatch_intent_reference_ids : [];
  const preparedIds = uniqueSorted(input.prepared_dispatch_intent_reference_ids || []);
  const waitingDependencyIds = uniqueSorted(input.waiting_dependency_intent_reference_ids || []);
  const waitingApprovalIds = uniqueSorted(input.waiting_approval_intent_reference_ids || []);
  const optionalIds = uniqueSorted(input.optional_intent_reference_ids || []);
  const blockedIds = uniqueSorted(input.blocked_intent_reference_ids || []);
  const schedulerOrderPreserved = input.scheduler_order_preserved === true;
  const requiredPredecessorOrderPreserved = input.required_predecessor_order_preserved === true;

  const reference = {
    dispatch_order_reference_id: input.dispatch_order_reference_id,
    dispatch_order_reference_version: Number.isInteger(input.dispatch_order_reference_version) ? input.dispatch_order_reference_version : 1,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    ordered_dispatch_stage_reference_ids: orderedStageIds,
    ordered_dispatch_intent_reference_ids: orderedIntentIds,
    prepared_dispatch_intent_reference_ids: preparedIds,
    waiting_dependency_intent_reference_ids: waitingDependencyIds,
    waiting_approval_intent_reference_ids: waitingApprovalIds,
    optional_intent_reference_ids: optionalIds,
    blocked_intent_reference_ids: blockedIds,
    dispatch_stage_count: orderedStageIds.length,
    dispatch_intent_count: orderedIntentIds.length,
    prepared_intent_count: preparedIds.length,
    waiting_dependency_count: waitingDependencyIds.length,
    waiting_approval_count: waitingApprovalIds.length,
    optional_count: optionalIds.length,
    blocked_count: blockedIds.length,
    scheduler_order_preserved: schedulerOrderPreserved,
    required_predecessor_order_preserved: requiredPredecessorOrderPreserved,
    dispatch_order_validated: schedulerOrderPreserved && requiredPredecessorOrderPreserved,
    order_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_ORDER_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_ORDER_REFERENCE_VALIDATOR_VERSION
  };
  reference.order_fingerprint = computeDispatchOrderFingerprint(reference);

  const validation = validateRuntimeDispatchOrderReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_order_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  COUNT_FIELDS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  ORDERED_LIST_FIELDS,
  PARTITION_LIST_FIELDS,
  RUNTIME_DISPATCH_ORDER_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_ORDER_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_ORDER_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDispatchOrderReference,
  computeDispatchOrderFingerprint,
  isOrderedUniqueList,
  isSortedUniqueList,
  validateRuntimeDispatchOrderReference
};
