'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');
const { QUEUE_PARTITION_STRATEGIES } = require('./runtime-queue-class-reference');

// pr108: derives, per the Queue Class's own `queue_partition_strategy`, exactly which declarative
// dimension a Dispatch Intent's partition key comes from -- "A partition key deve ser derivada da
// strategy," never content of prompt or message. `partition_key_type` is structurally 1:1 with
// `partition_strategy` (STRATEGY_TO_KEY_TYPE below), never independently declared.
const RUNTIME_QUEUE_PARTITION_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_partition_reference_validator_v1';

const PARTITION_KEY_TYPES = Object.freeze([
  'TENANT_ID_REFERENCE', 'ORGANIZATION_ID_REFERENCE', 'PROJECT_ID_REFERENCE', 'AGENT_ID_REFERENCE',
  'CAPABILITY_SET_REFERENCE', 'STAGE_TYPE_REFERENCE', 'COMPOSITE_KEY_REFERENCE'
]);

const STRATEGY_TO_KEY_TYPE = Object.freeze({
  TENANT_PARTITION_REFERENCE: 'TENANT_ID_REFERENCE',
  ORGANIZATION_PARTITION_REFERENCE: 'ORGANIZATION_ID_REFERENCE',
  PROJECT_PARTITION_REFERENCE: 'PROJECT_ID_REFERENCE',
  AGENT_PARTITION_REFERENCE: 'AGENT_ID_REFERENCE',
  CAPABILITY_PARTITION_REFERENCE: 'CAPABILITY_SET_REFERENCE',
  STAGE_TYPE_PARTITION_REFERENCE: 'STAGE_TYPE_REFERENCE',
  COMPOSITE_PARTITION_REFERENCE: 'COMPOSITE_KEY_REFERENCE'
});

const NULLABLE_IDENTITY_FIELDS = Object.freeze(['tenant_id', 'organization_id', 'project_id', 'agent_id', 'stage_type']);

const RUNTIME_QUEUE_PARTITION_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_partition_reference_id', 'runtime_queue_partition_reference_version',
  'runtime_queue_class_reference_id',
  'partition_strategy', 'partition_key_type', 'partition_key_value',
  ...NULLABLE_IDENTITY_FIELDS, 'capability_ids',
  'partition_validated', 'partition_applied', 'queue_created', 'queue_item_created',
  'partition_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_PARTITION_REFERENCE_SAFE_FLAGS = Object.freeze({
  partition_applied: false,
  queue_created: false,
  queue_item_created: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeQueuePartitionFingerprint(reference) {
  const { partition_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueuePartitionReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_partition_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_PARTITION_REFERENCE_FIELDS, 'runtime_queue_partition_reference', errors);
  for (const field of [
    'runtime_queue_partition_reference_id', 'runtime_queue_class_reference_id', 'partition_key_value',
    'partition_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_partition_reference_version) || reference.runtime_queue_partition_reference_version < 1) {
    errors.push('runtime_queue_partition_reference_version_invalid');
  }
  if (!QUEUE_PARTITION_STRATEGIES.includes(reference.partition_strategy)) errors.push('partition_strategy_invalid');
  if (!PARTITION_KEY_TYPES.includes(reference.partition_key_type)) errors.push('partition_key_type_invalid');
  if (STRATEGY_TO_KEY_TYPE[reference.partition_strategy] !== undefined && reference.partition_key_type !== STRATEGY_TO_KEY_TYPE[reference.partition_strategy]) {
    errors.push('partition_key_type_does_not_match_strategy');
  }
  for (const field of ['tenant_id', 'organization_id', 'project_id', 'agent_id']) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (reference.stage_type !== null && !STAGE_TYPES.includes(reference.stage_type)) errors.push('stage_type_must_be_null_or_valid');
  if (!isOrderedUniqueStringList(reference.capability_ids)) errors.push('capability_ids_invalid');
  for (const field of ['partition_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_PARTITION_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_PARTITION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueuePartitionFingerprint(reference) !== reference.partition_fingerprint) errors.push('partition_fingerprint_mismatch');
  } catch (error) {
    errors.push('partition_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueuePartitionReference(input = {}) {
  const reference = {
    runtime_queue_partition_reference_id: input.runtime_queue_partition_reference_id,
    runtime_queue_partition_reference_version: Number.isInteger(input.runtime_queue_partition_reference_version) ? input.runtime_queue_partition_reference_version : 1,
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id,
    partition_strategy: input.partition_strategy,
    partition_key_type: STRATEGY_TO_KEY_TYPE[input.partition_strategy],
    partition_key_value: input.partition_key_value,
    capability_ids: uniqueSorted(input.capability_ids || []),
    partition_validated: true,
    partition_fingerprint: 'pending',
    ...RUNTIME_QUEUE_PARTITION_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_PARTITION_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of ['tenant_id', 'organization_id', 'project_id', 'agent_id', 'stage_type']) {
    reference[field] = input[field] === undefined ? null : input[field];
  }
  reference.partition_fingerprint = computeQueuePartitionFingerprint(reference);

  const validation = validateRuntimeQueuePartitionReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_partition_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_LIST_ITEMS,
  NULLABLE_IDENTITY_FIELDS,
  PARTITION_KEY_TYPES,
  RUNTIME_QUEUE_PARTITION_REFERENCE_FIELDS,
  RUNTIME_QUEUE_PARTITION_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_PARTITION_REFERENCE_VALIDATOR_VERSION,
  STRATEGY_TO_KEY_TYPE,
  buildRuntimeQueuePartitionReference,
  computeQueuePartitionFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeQueuePartitionReference
};
