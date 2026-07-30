'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr105: a parallel group derived exclusively from the Runtime Dependency Manifest and Scheduler
// Policy -- never accepted as a free grouping from the caller ("Não aceitar grupos paralelos livres
// do caller"). runtime-scheduler-boundary.js is the only place that actually derives membership
// (every member parallelizable=true, no sequential edge within the group, same topological level);
// this contract only validates the resulting shape is internally consistent (counts partition the
// member list, limits are booleans the boundary already recomputed) and that no operational flag is
// ever forced true.
const RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_VALIDATOR_VERSION = 'runtime_scheduler_parallel_group_reference_validator_v1';

const COUNT_FIELDS = Object.freeze(['required_stage_count', 'optional_stage_count', 'model_stage_count', 'tool_stage_count', 'workflow_stage_count']);
const LIMIT_FLAG_FIELDS = Object.freeze(['capacity_within_limit', 'concurrency_within_limit', 'budget_within_limit']);

const RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_FIELDS = Object.freeze([
  'parallel_group_reference_id', 'parallel_group_reference_version',
  'runtime_scheduler_package_id', 'runtime_execution_package_id',
  'parallel_group_sequence', 'scheduler_stage_reference_ids', 'source_runtime_stage_reference_ids',
  'source_dependency_reference_ids',
  'stage_count', ...COUNT_FIELDS,
  'estimated_total_tokens', 'estimated_total_cost_minor_units',
  ...LIMIT_FLAG_FIELDS, 'parallel_group_validated', 'parallel_group_applied', 'parallel_group_started', 'parallel_group_completed',
  'parallel_group_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_SAFE_FLAGS = Object.freeze({
  parallel_group_applied: false,
  parallel_group_started: false,
  parallel_group_completed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_COUNT = 100000;
const MAX_TOKENS = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeParallelGroupFingerprint(reference) {
  const { parallel_group_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeSchedulerParallelGroupReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_scheduler_parallel_group_reference_must_be_object'] };
  exactFields(reference, RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_FIELDS, 'runtime_scheduler_parallel_group_reference', errors);
  for (const field of [
    'parallel_group_reference_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
    'parallel_group_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.parallel_group_reference_version) || reference.parallel_group_reference_version < 1) {
    errors.push('parallel_group_reference_version_invalid');
  }
  if (!Number.isInteger(reference.parallel_group_sequence) || reference.parallel_group_sequence < 0) errors.push('parallel_group_sequence_invalid');
  if (!isOrderedUniqueStringList(reference.scheduler_stage_reference_ids)) errors.push('scheduler_stage_reference_ids_invalid');
  if (!isOrderedUniqueStringList(reference.source_runtime_stage_reference_ids)) errors.push('source_runtime_stage_reference_ids_invalid');
  if (!isOrderedUniqueStringList(reference.source_dependency_reference_ids, MAX_LIST_ITEMS)) errors.push('source_dependency_reference_ids_invalid');
  if (
    Array.isArray(reference.scheduler_stage_reference_ids) && reference.scheduler_stage_reference_ids.length < 2
  ) {
    errors.push('parallel_group_must_have_at_least_two_members');
  }
  if (!Number.isInteger(reference.stage_count) || reference.stage_count < 0 || reference.stage_count > MAX_COUNT) errors.push('stage_count_invalid');
  else if (Array.isArray(reference.scheduler_stage_reference_ids) && reference.stage_count !== reference.scheduler_stage_reference_ids.length) {
    errors.push('stage_count_inconsistent_with_members');
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(reference.required_stage_count) && Number.isInteger(reference.optional_stage_count)
    && Number.isInteger(reference.stage_count)
    && reference.required_stage_count + reference.optional_stage_count !== reference.stage_count
  ) {
    errors.push('required_and_optional_stage_counts_do_not_partition_stage_count');
  }
  if (!Number.isInteger(reference.estimated_total_tokens) || reference.estimated_total_tokens < 0 || reference.estimated_total_tokens > MAX_TOKENS) {
    errors.push('estimated_total_tokens_invalid');
  }
  if (!Number.isInteger(reference.estimated_total_cost_minor_units) || reference.estimated_total_cost_minor_units < 0 || reference.estimated_total_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_total_cost_minor_units_invalid');
  }
  for (const field of LIMIT_FLAG_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  const expectedValidated = LIMIT_FLAG_FIELDS.every((field) => reference[field] === true);
  if (typeof reference.parallel_group_validated !== 'boolean') errors.push('parallel_group_validated_must_be_boolean');
  else if (reference.parallel_group_validated !== expectedValidated) errors.push('parallel_group_validated_inconsistent_with_limits');
  for (const [field, expected] of Object.entries(RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeParallelGroupFingerprint(reference) !== reference.parallel_group_fingerprint) errors.push('parallel_group_fingerprint_mismatch');
  } catch (error) {
    errors.push('parallel_group_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerParallelGroupReference(input = {}) {
  const reference = {
    parallel_group_reference_id: input.parallel_group_reference_id,
    parallel_group_reference_version: Number.isInteger(input.parallel_group_reference_version) ? input.parallel_group_reference_version : 1,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    parallel_group_sequence: Number.isInteger(input.parallel_group_sequence) ? input.parallel_group_sequence : 0,
    scheduler_stage_reference_ids: uniqueSorted(input.scheduler_stage_reference_ids || []),
    source_runtime_stage_reference_ids: uniqueSorted(input.source_runtime_stage_reference_ids || []),
    source_dependency_reference_ids: uniqueSorted(input.source_dependency_reference_ids || []),
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_total_cost_minor_units: Number.isInteger(input.estimated_total_cost_minor_units) ? input.estimated_total_cost_minor_units : 0,
    parallel_group_fingerprint: 'pending',
    ...RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_VALIDATOR_VERSION
  };
  reference.stage_count = Array.isArray(input.scheduler_stage_reference_ids) ? input.scheduler_stage_reference_ids.length : 0;
  for (const field of COUNT_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  for (const field of LIMIT_FLAG_FIELDS) {
    reference[field] = input[field] === true;
  }
  reference.parallel_group_validated = LIMIT_FLAG_FIELDS.every((field) => reference[field] === true);
  reference.parallel_group_fingerprint = computeParallelGroupFingerprint(reference);

  const validation = validateRuntimeSchedulerParallelGroupReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_parallel_group_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  COUNT_FIELDS,
  LIMIT_FLAG_FIELDS,
  MAX_COST_MINOR_UNITS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  MAX_TOKENS,
  RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_FIELDS,
  RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_SAFE_FLAGS,
  RUNTIME_SCHEDULER_PARALLEL_GROUP_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeSchedulerParallelGroupReference,
  computeParallelGroupFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeSchedulerParallelGroupReference
};
