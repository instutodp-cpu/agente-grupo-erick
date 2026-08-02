'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { QUEUE_FAIRNESS_STRATEGIES, QUEUE_PRIORITY_CLASSES } = require('./runtime-queue-class-reference');

// pr108: "A fairness deve usar somente dados declarativos." Ranks are derived exclusively from
// priority class, dispatch/logical sequence, and canonical identity IDs -- "Nenhum score
// aleatório. Nenhum relógio real. Nenhum timer." `queue_position_reserved`/`fairness_applied` are
// permanently forced `false`.
const RUNTIME_QUEUE_FAIRNESS_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_fairness_reference_validator_v1';

const IDENTITY_FIELDS = Object.freeze(['tenant_id', 'organization_id', 'project_id', 'agent_id']);

const RANK_FIELDS = Object.freeze([
  'tenant_admission_rank', 'organization_admission_rank', 'project_admission_rank', 'agent_admission_rank',
  'global_admission_rank'
]);

const RUNTIME_QUEUE_FAIRNESS_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_fairness_reference_id', 'runtime_queue_fairness_reference_version',
  'runtime_queue_admission_request_id', 'runtime_queue_class_reference_id',
  'fairness_strategy',
  ...IDENTITY_FIELDS,
  'priority_class', 'dispatch_sequence', 'logical_sequence',
  ...RANK_FIELDS,
  'fairness_validated', 'fairness_applied', 'queue_position_reserved',
  'fairness_reason_codes',
  'fairness_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_FAIRNESS_REFERENCE_SAFE_FLAGS = Object.freeze({
  fairness_applied: false,
  queue_position_reserved: false,
  simulation: true,
  production_blocked: true
});

const MAX_RANK = 1000000;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function computeQueueFairnessFingerprint(reference) {
  const { fairness_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeQueueFairnessReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_fairness_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_FAIRNESS_REFERENCE_FIELDS, 'runtime_queue_fairness_reference', errors);
  for (const field of [
    'runtime_queue_fairness_reference_id', 'runtime_queue_admission_request_id', 'runtime_queue_class_reference_id',
    ...IDENTITY_FIELDS, 'fairness_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_fairness_reference_version) || reference.runtime_queue_fairness_reference_version < 1) {
    errors.push('runtime_queue_fairness_reference_version_invalid');
  }
  if (!QUEUE_FAIRNESS_STRATEGIES.includes(reference.fairness_strategy)) errors.push('fairness_strategy_invalid');
  if (!QUEUE_PRIORITY_CLASSES.includes(reference.priority_class)) errors.push('priority_class_invalid');
  for (const field of ['dispatch_sequence', 'logical_sequence']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0) errors.push(`${field}_invalid`);
  }
  for (const field of RANK_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_RANK) errors.push(`${field}_invalid`);
  }
  if (typeof reference.fairness_validated !== 'boolean') errors.push('fairness_validated_must_be_boolean');
  if (!isSanitizedList(reference.fairness_reason_codes, MAX_REASON_CODES)) errors.push('fairness_reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_FAIRNESS_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_FAIRNESS_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueueFairnessFingerprint(reference) !== reference.fairness_fingerprint) errors.push('fairness_fingerprint_mismatch');
  } catch (error) {
    errors.push('fairness_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueFairnessReference(input = {}) {
  const reference = {
    runtime_queue_fairness_reference_id: input.runtime_queue_fairness_reference_id,
    runtime_queue_fairness_reference_version: Number.isInteger(input.runtime_queue_fairness_reference_version) ? input.runtime_queue_fairness_reference_version : 1,
    runtime_queue_admission_request_id: input.runtime_queue_admission_request_id,
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id,
    fairness_strategy: input.fairness_strategy,
    priority_class: input.priority_class,
    dispatch_sequence: Number.isInteger(input.dispatch_sequence) ? input.dispatch_sequence : 0,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    fairness_validated: true,
    fairness_reason_codes: Array.isArray(input.fairness_reason_codes) ? uniqueSorted(input.fairness_reason_codes) : [],
    fairness_fingerprint: 'pending',
    ...RUNTIME_QUEUE_FAIRNESS_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_FAIRNESS_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of IDENTITY_FIELDS) {
    reference[field] = input[field];
  }
  for (const field of RANK_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  reference.fairness_fingerprint = computeQueueFairnessFingerprint(reference);

  const validation = validateRuntimeQueueFairnessReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_fairness_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  IDENTITY_FIELDS,
  MAX_RANK,
  MAX_REASON_CODES,
  RANK_FIELDS,
  RUNTIME_QUEUE_FAIRNESS_REFERENCE_FIELDS,
  RUNTIME_QUEUE_FAIRNESS_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_FAIRNESS_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueueFairnessReference,
  computeQueueFairnessFingerprint,
  validateRuntimeQueueFairnessReference
};
