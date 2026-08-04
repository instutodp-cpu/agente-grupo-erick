'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');
const { MODALITIES } = require('./model-contract');
const { CAPABILITY_TYPES } = require('./model-capability-contract');

// pr108: "Uma fila não pode ser apenas um nome ou string." A versioned, fingerprinted, immutable
// declarative description of a logical queue -- domain, type, priority, partition/fairness/retry
// strategy, scope, supported stage-type/capability/modality/model/tool/workflow surface, and
// declarative backlog/inflight/parallel/model/tool/workflow/token/cost limits.
// "Queue Class Reference é uma descrição declarativa. Ela não comprova que uma fila, tópico, broker
// ou consumer real existe." `queue_created`/`queue_class_applied` are permanently forced `false`.
const RUNTIME_QUEUE_CLASS_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_class_reference_validator_v1';

const QUEUE_CLASS_TYPES = Object.freeze([
  'SHARED_QUEUE_REFERENCE', 'DEDICATED_QUEUE_REFERENCE', 'TENANT_QUEUE_REFERENCE', 'ORGANIZATION_QUEUE_REFERENCE',
  'PROJECT_QUEUE_REFERENCE', 'AGENT_QUEUE_REFERENCE'
]);

const QUEUE_PRIORITY_CLASSES = Object.freeze([
  'CRITICAL_REFERENCE', 'HIGH_REFERENCE', 'NORMAL_REFERENCE', 'LOW_REFERENCE', 'BACKGROUND_REFERENCE'
]);

const QUEUE_PARTITION_STRATEGIES = Object.freeze([
  'TENANT_PARTITION_REFERENCE', 'ORGANIZATION_PARTITION_REFERENCE', 'PROJECT_PARTITION_REFERENCE',
  'AGENT_PARTITION_REFERENCE', 'CAPABILITY_PARTITION_REFERENCE', 'STAGE_TYPE_PARTITION_REFERENCE',
  'COMPOSITE_PARTITION_REFERENCE'
]);

const QUEUE_FAIRNESS_STRATEGIES = Object.freeze([
  'STRICT_PRIORITY_WITH_TENANT_FAIRNESS', 'WEIGHTED_ROUND_ROBIN_REFERENCE', 'FIFO_WITHIN_PRIORITY_REFERENCE',
  'DETERMINISTIC_FAIR_SHARE_REFERENCE'
]);

// "Nenhuma retry é executada nesta PR."
const QUEUE_RETRY_CLASSES = Object.freeze(['NO_RETRY_REFERENCE', 'LIMITED_RETRY_REFERENCE', 'MANUAL_REVIEW_REFERENCE']);

const NULLABLE_SCOPE_FIELDS = Object.freeze(['tenant_scope_id', 'organization_scope_id', 'project_scope_id']);

const SUPPORTED_LIST_FIELDS = Object.freeze([
  'supported_stage_types', 'supported_capability_ids', 'supported_modality_ids', 'supported_model_provider_ids',
  'supported_model_ids', 'supported_tool_ids', 'supported_workflow_ids'
]);

const SUPPORTS_FLAG_FIELDS = Object.freeze([
  'supports_no_llm', 'supports_model', 'supports_tool', 'supports_workflow', 'supports_parallel', 'supports_optional',
  'supports_state_change', 'supports_external_effect', 'supports_irreversible'
]);

// "External/irreversible sempre bloqueados" -- the same two effects already globally forbidden in
// every prior layer of this lineage are never genuinely supported by any Queue Class, regardless of
// caller input.
const SUPPORTS_SAFE_FLAGS = Object.freeze({
  supports_external_effect: false,
  supports_irreversible: false
});

const MAXIMUM_FIELDS = Object.freeze([
  'maximum_backlog_count', 'maximum_inflight_count', 'maximum_parallel_count', 'maximum_model_count',
  'maximum_tool_count', 'maximum_workflow_count', 'maximum_tokens', 'maximum_cost_minor_units',
  'maximum_logical_age_sequences'
]);

const RUNTIME_QUEUE_CLASS_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_class_reference_id', 'runtime_queue_class_reference_version',
  'queue_class_name', 'queue_class_type', 'queue_domain', 'queue_priority_class', 'queue_partition_strategy',
  'queue_fairness_strategy', 'queue_retry_class', 'queue_dead_letter_reference_id',
  ...NULLABLE_SCOPE_FIELDS, 'agent_scope_ids',
  ...SUPPORTED_LIST_FIELDS,
  ...SUPPORTS_FLAG_FIELDS,
  ...MAXIMUM_FIELDS,
  'queue_class_active', 'queue_class_validated', 'queue_class_applied', 'queue_created',
  'queue_class_fingerprint', 'queue_class_digest',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const RUNTIME_QUEUE_CLASS_REFERENCE_SAFE_FLAGS = Object.freeze({
  ...SUPPORTS_SAFE_FLAGS,
  queue_class_applied: false,
  queue_created: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_QUEUE_CLASS_BOUND = 1000000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function isOrderedUniqueEnumSubset(list, allowed, maxItems = MAX_LIST_ITEMS) {
  return isOrderedUniqueStringList(list, maxItems) && list.every((item) => allowed.includes(item));
}

function computeQueueClassFingerprint(reference) {
  const { queue_class_fingerprint, queue_class_digest, ...rest } = reference;
  return stablePayload(rest);
}

function computeQueueClassDigest(reference) {
  const { queue_class_digest, ...rest } = reference;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeQueueClassReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_class_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_CLASS_REFERENCE_FIELDS, 'runtime_queue_class_reference', errors);
  for (const field of [
    'runtime_queue_class_reference_id', 'queue_class_name', 'queue_domain',
    'queue_class_fingerprint', 'queue_class_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_class_reference_version) || reference.runtime_queue_class_reference_version < 1) {
    errors.push('runtime_queue_class_reference_version_invalid');
  }
  if (!QUEUE_CLASS_TYPES.includes(reference.queue_class_type)) errors.push('queue_class_type_invalid');
  if (!QUEUE_PRIORITY_CLASSES.includes(reference.queue_priority_class)) errors.push('queue_priority_class_invalid');
  if (!QUEUE_PARTITION_STRATEGIES.includes(reference.queue_partition_strategy)) errors.push('queue_partition_strategy_invalid');
  if (!QUEUE_FAIRNESS_STRATEGIES.includes(reference.queue_fairness_strategy)) errors.push('queue_fairness_strategy_invalid');
  if (!QUEUE_RETRY_CLASSES.includes(reference.queue_retry_class)) errors.push('queue_retry_class_invalid');
  if (reference.queue_dead_letter_reference_id !== null && !isNonEmptyString(reference.queue_dead_letter_reference_id)) {
    errors.push('queue_dead_letter_reference_id_must_be_null_or_string');
  }
  for (const field of NULLABLE_SCOPE_FIELDS) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!isOrderedUniqueStringList(reference.agent_scope_ids)) errors.push('agent_scope_ids_invalid');
  if (!isOrderedUniqueEnumSubset(reference.supported_stage_types, STAGE_TYPES)) errors.push('supported_stage_types_invalid');
  if (!isOrderedUniqueEnumSubset(reference.supported_capability_ids, CAPABILITY_TYPES)) errors.push('supported_capability_ids_invalid');
  if (!isOrderedUniqueEnumSubset(reference.supported_modality_ids, MODALITIES)) errors.push('supported_modality_ids_invalid');
  for (const field of ['supported_model_provider_ids', 'supported_model_ids', 'supported_tool_ids', 'supported_workflow_ids']) {
    if (!isOrderedUniqueStringList(reference[field])) errors.push(`${field}_invalid`);
  }
  for (const field of SUPPORTS_FLAG_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of MAXIMUM_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_QUEUE_CLASS_BOUND) errors.push(`${field}_invalid`);
  }
  if (typeof reference.queue_class_active !== 'boolean') errors.push('queue_class_active_must_be_boolean');
  if (typeof reference.queue_class_validated !== 'boolean') errors.push('queue_class_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_CLASS_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (reference.validator_version !== RUNTIME_QUEUE_CLASS_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueueClassFingerprint(reference) !== reference.queue_class_fingerprint) errors.push('queue_class_fingerprint_mismatch');
  } catch (error) {
    errors.push('queue_class_fingerprint_mismatch');
  }
  try {
    if (computeQueueClassDigest(reference) !== reference.queue_class_digest) errors.push('queue_class_digest_mismatch');
  } catch (error) {
    errors.push('queue_class_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueClassReference(input = {}) {
  const reference = {
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id,
    runtime_queue_class_reference_version: Number.isInteger(input.runtime_queue_class_reference_version) ? input.runtime_queue_class_reference_version : 1,
    queue_class_name: input.queue_class_name,
    queue_class_type: input.queue_class_type,
    queue_domain: input.queue_domain,
    queue_priority_class: input.queue_priority_class,
    queue_partition_strategy: input.queue_partition_strategy,
    queue_fairness_strategy: input.queue_fairness_strategy,
    queue_retry_class: input.queue_retry_class,
    queue_dead_letter_reference_id: input.queue_dead_letter_reference_id === undefined ? null : input.queue_dead_letter_reference_id,
    agent_scope_ids: uniqueSorted(input.agent_scope_ids || []),
    supported_stage_types: uniqueSorted(input.supported_stage_types || []),
    supported_capability_ids: uniqueSorted(input.supported_capability_ids || []),
    supported_modality_ids: uniqueSorted(input.supported_modality_ids || []),
    supported_model_provider_ids: uniqueSorted(input.supported_model_provider_ids || []),
    supported_model_ids: uniqueSorted(input.supported_model_ids || []),
    supported_tool_ids: uniqueSorted(input.supported_tool_ids || []),
    supported_workflow_ids: uniqueSorted(input.supported_workflow_ids || []),
    queue_class_active: input.queue_class_active === true,
    queue_class_validated: true,
    queue_class_fingerprint: 'pending',
    queue_class_digest: 'pending',
    rollout_percentage: 0,
    ...RUNTIME_QUEUE_CLASS_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_CLASS_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of NULLABLE_SCOPE_FIELDS) {
    reference[field] = input[field] === undefined ? null : input[field];
  }
  for (const field of SUPPORTS_FLAG_FIELDS) {
    reference[field] = field in SUPPORTS_SAFE_FLAGS ? SUPPORTS_SAFE_FLAGS[field] : input[field] === true;
  }
  for (const field of MAXIMUM_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  reference.queue_class_fingerprint = computeQueueClassFingerprint(reference);
  reference.queue_class_digest = computeQueueClassDigest(reference);

  const validation = validateRuntimeQueueClassReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_class_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAXIMUM_FIELDS,
  MAX_LIST_ITEMS,
  MAX_QUEUE_CLASS_BOUND,
  NULLABLE_SCOPE_FIELDS,
  QUEUE_CLASS_TYPES,
  QUEUE_FAIRNESS_STRATEGIES,
  QUEUE_PARTITION_STRATEGIES,
  QUEUE_PRIORITY_CLASSES,
  QUEUE_RETRY_CLASSES,
  RUNTIME_QUEUE_CLASS_REFERENCE_FIELDS,
  RUNTIME_QUEUE_CLASS_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_CLASS_REFERENCE_VALIDATOR_VERSION,
  SUPPORTED_LIST_FIELDS,
  SUPPORTS_FLAG_FIELDS,
  SUPPORTS_SAFE_FLAGS,
  buildRuntimeQueueClassReference,
  computeQueueClassDigest,
  computeQueueClassFingerprint,
  isOrderedUniqueEnumSubset,
  isOrderedUniqueStringList,
  validateRuntimeQueueClassReference
};
