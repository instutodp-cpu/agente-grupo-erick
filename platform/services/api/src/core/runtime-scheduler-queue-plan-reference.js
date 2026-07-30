'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr105: "A queue plan é apenas uma lista declarativa ordenada. Não criar estrutura operacional de
// fila." The 5 category lists (eligible/waiting-dependency/waiting-approval/optional/blocked) must
// completely and disjointly partition `ordered_scheduler_stage_reference_ids` -- every stage the
// scheduler request carries appears in exactly one category, never zero, never more than one.
// queue_created/queue_used/job_created/scheduler_started stay permanently forced false: this
// contract never represents a real queue, however ordered its declarative list is.
const RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_VALIDATOR_VERSION = 'runtime_scheduler_queue_plan_reference_validator_v1';

// [category list field, count field] pairs -- the 5 disjoint partitions of the ordered stage list.
const CATEGORY_DIMENSIONS = Object.freeze([
  ['eligible_scheduler_stage_reference_ids', 'eligible_count'],
  ['waiting_dependency_stage_reference_ids', 'waiting_dependency_count'],
  ['waiting_approval_stage_reference_ids', 'waiting_approval_count'],
  ['optional_stage_reference_ids', 'optional_count'],
  ['blocked_stage_reference_ids', 'blocked_count']
]);

const CATEGORY_LIST_FIELDS = Object.freeze(CATEGORY_DIMENSIONS.map((d) => d[0]));
const CATEGORY_COUNT_FIELDS = Object.freeze(CATEGORY_DIMENSIONS.map((d) => d[1]));

const RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_FIELDS = Object.freeze([
  'scheduler_queue_plan_reference_id', 'scheduler_queue_plan_reference_version',
  'runtime_scheduler_package_id', 'runtime_execution_package_id',
  'ordered_scheduler_stage_reference_ids', ...CATEGORY_LIST_FIELDS,
  'parallel_group_reference_ids', 'approval_wait_reference_ids',
  'queue_entry_count', ...CATEGORY_COUNT_FIELDS, 'parallel_group_count',
  'queue_order_validated', 'queue_plan_validated', 'queue_plan_applied',
  'queue_created', 'queue_used', 'job_created', 'scheduler_started',
  'queue_plan_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_SAFE_FLAGS = Object.freeze({
  queue_plan_applied: false,
  queue_created: false,
  queue_used: false,
  job_created: false,
  scheduler_started: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 500;
const MAX_COUNT = 100000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  return list.every(isNonEmptyString) && new Set(list).size === list.length;
}

function isSortedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!isOrderedUniqueStringList(list, maxItems)) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeQueuePlanFingerprint(reference) {
  const { queue_plan_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function partitionMatches(ordered, categoryLists) {
  const orderedSet = new Set(ordered);
  const seen = new Set();
  for (const list of categoryLists) {
    for (const id of list) {
      if (!orderedSet.has(id) || seen.has(id)) return false;
      seen.add(id);
    }
  }
  return seen.size === ordered.length;
}

function validateRuntimeSchedulerQueuePlanReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_scheduler_queue_plan_reference_must_be_object'] };
  exactFields(reference, RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_FIELDS, 'runtime_scheduler_queue_plan_reference', errors);
  for (const field of [
    'scheduler_queue_plan_reference_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
    'queue_plan_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.scheduler_queue_plan_reference_version) || reference.scheduler_queue_plan_reference_version < 1) {
    errors.push('scheduler_queue_plan_reference_version_invalid');
  }
  if (!isOrderedUniqueStringList(reference.ordered_scheduler_stage_reference_ids)) errors.push('ordered_scheduler_stage_reference_ids_invalid');
  for (const field of CATEGORY_LIST_FIELDS) {
    if (!isSortedUniqueStringList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!isSortedUniqueStringList(reference.parallel_group_reference_ids)) errors.push('parallel_group_reference_ids_invalid');
  if (!isSortedUniqueStringList(reference.approval_wait_reference_ids)) errors.push('approval_wait_reference_ids_invalid');

  const structurallySound = Array.isArray(reference.ordered_scheduler_stage_reference_ids) && CATEGORY_LIST_FIELDS.every((f) => Array.isArray(reference[f]));
  const expectedPartition = structurallySound && partitionMatches(reference.ordered_scheduler_stage_reference_ids, CATEGORY_LIST_FIELDS.map((f) => reference[f]));
  if (typeof reference.queue_order_validated !== 'boolean') errors.push('queue_order_validated_must_be_boolean');
  else if (structurallySound && reference.queue_order_validated !== expectedPartition) errors.push('queue_order_validated_does_not_match_partition');

  if (!Number.isInteger(reference.queue_entry_count) || reference.queue_entry_count < 0 || reference.queue_entry_count > MAX_COUNT) {
    errors.push('queue_entry_count_invalid');
  } else if (Array.isArray(reference.ordered_scheduler_stage_reference_ids) && reference.queue_entry_count !== reference.ordered_scheduler_stage_reference_ids.length) {
    errors.push('queue_entry_count_inconsistent');
  }
  for (const [listField, countField] of CATEGORY_DIMENSIONS) {
    if (!Number.isInteger(reference[countField]) || reference[countField] < 0 || reference[countField] > MAX_COUNT) {
      errors.push(`${countField}_invalid`);
    } else if (Array.isArray(reference[listField]) && reference[countField] !== reference[listField].length) {
      errors.push(`${countField}_inconsistent`);
    }
  }
  if (!Number.isInteger(reference.parallel_group_count) || reference.parallel_group_count < 0 || reference.parallel_group_count > MAX_COUNT) {
    errors.push('parallel_group_count_invalid');
  } else if (Array.isArray(reference.parallel_group_reference_ids) && reference.parallel_group_count !== reference.parallel_group_reference_ids.length) {
    errors.push('parallel_group_count_inconsistent');
  }

  const expectedValidated = expectedPartition === true;
  if (typeof reference.queue_plan_validated !== 'boolean') errors.push('queue_plan_validated_must_be_boolean');
  else if (structurallySound && reference.queue_plan_validated !== expectedValidated) errors.push('queue_plan_validated_inconsistent_with_order');

  for (const [field, expected] of Object.entries(RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueuePlanFingerprint(reference) !== reference.queue_plan_fingerprint) errors.push('queue_plan_fingerprint_mismatch');
  } catch (error) {
    errors.push('queue_plan_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerQueuePlanReference(input = {}) {
  const ordered = Array.isArray(input.ordered_scheduler_stage_reference_ids) ? input.ordered_scheduler_stage_reference_ids : [];
  const reference = {
    scheduler_queue_plan_reference_id: input.scheduler_queue_plan_reference_id,
    scheduler_queue_plan_reference_version: Number.isInteger(input.scheduler_queue_plan_reference_version) ? input.scheduler_queue_plan_reference_version : 1,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    ordered_scheduler_stage_reference_ids: ordered,
    parallel_group_reference_ids: uniqueSorted(input.parallel_group_reference_ids || []),
    approval_wait_reference_ids: uniqueSorted(input.approval_wait_reference_ids || []),
    queue_plan_fingerprint: 'pending',
    ...RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_VALIDATOR_VERSION
  };
  for (const [listField, countField] of CATEGORY_DIMENSIONS) {
    reference[listField] = uniqueSorted(input[listField] || []);
    reference[countField] = reference[listField].length;
  }
  reference.queue_entry_count = ordered.length;
  reference.parallel_group_count = reference.parallel_group_reference_ids.length;
  reference.queue_order_validated = partitionMatches(ordered, CATEGORY_LIST_FIELDS.map((f) => reference[f]));
  reference.queue_plan_validated = reference.queue_order_validated;
  reference.queue_plan_fingerprint = computeQueuePlanFingerprint(reference);

  const validation = validateRuntimeSchedulerQueuePlanReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_queue_plan_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  CATEGORY_COUNT_FIELDS,
  CATEGORY_DIMENSIONS,
  CATEGORY_LIST_FIELDS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_FIELDS,
  RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_SAFE_FLAGS,
  RUNTIME_SCHEDULER_QUEUE_PLAN_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeSchedulerQueuePlanReference,
  computeQueuePlanFingerprint,
  isOrderedUniqueStringList,
  isSortedUniqueStringList,
  partitionMatches,
  validateRuntimeSchedulerQueuePlanReference
};
