'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');

// pr108: a single-scope declarative quota -- exactly one of tenant_id/organization_id/project_id/
// agent_id is genuinely bound per reference (the others stay null), mirroring "Validar por: tenant;
// organização; projeto; agente" as independent quota references rather than one combined record.
// 8 dimensions (admission/backlog/parallel/model/tool/workflow/tokens/cost), each a genuine
// [maximum, current, available] triple. "Nenhuma quota é alterada, reservada ou consumida" --
// `quota_applied`/`quota_reserved`/`quota_consumed` are permanently forced `false`.
const RUNTIME_QUEUE_QUOTA_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_quota_reference_validator_v1';

const SCOPE_FIELDS = Object.freeze(['tenant_id', 'organization_id', 'project_id', 'agent_id']);

const QUOTA_DIMENSIONS = Object.freeze([
  ['maximum_admission_count', 'current_admission_count', 'available_admission_count'],
  ['maximum_backlog_count', 'current_backlog_count', 'available_backlog_count'],
  ['maximum_parallel_count', 'current_parallel_count', 'available_parallel_count'],
  ['maximum_model_count', 'current_model_count', 'available_model_count'],
  ['maximum_tool_count', 'current_tool_count', 'available_tool_count'],
  ['maximum_workflow_count', 'current_workflow_count', 'available_workflow_count'],
  ['maximum_tokens', 'current_tokens', 'available_tokens'],
  ['maximum_cost_minor_units', 'current_cost_minor_units', 'available_cost_minor_units']
]);

const QUOTA_NUMERIC_FIELDS = Object.freeze(QUOTA_DIMENSIONS.flat());

const RUNTIME_QUEUE_QUOTA_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_quota_reference_id', 'runtime_queue_quota_reference_version',
  'runtime_queue_class_reference_id',
  ...SCOPE_FIELDS,
  ...QUOTA_NUMERIC_FIELDS,
  'quota_validated', 'quota_applied', 'quota_reserved', 'quota_consumed',
  'quota_fingerprint', 'quota_digest',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_QUOTA_REFERENCE_SAFE_FLAGS = Object.freeze({
  quota_applied: false,
  quota_reserved: false,
  quota_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_QUOTA_BOUND = 1000000000;

function computeQueueQuotaFingerprint(reference) {
  const { quota_fingerprint, quota_digest, ...rest } = reference;
  return stablePayload(rest);
}

function computeQueueQuotaDigest(reference) {
  const { quota_digest, ...rest } = reference;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeQueueQuotaReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_quota_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_QUOTA_REFERENCE_FIELDS, 'runtime_queue_quota_reference', errors);
  for (const field of [
    'runtime_queue_quota_reference_id', 'runtime_queue_class_reference_id',
    'quota_fingerprint', 'quota_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_quota_reference_version) || reference.runtime_queue_quota_reference_version < 1) {
    errors.push('runtime_queue_quota_reference_version_invalid');
  }
  for (const field of SCOPE_FIELDS) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!SCOPE_FIELDS.some((field) => isNonEmptyString(reference[field]))) errors.push('at_least_one_scope_field_required');
  for (const field of QUOTA_NUMERIC_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_QUOTA_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [maxField, usedField, availableField] of QUOTA_DIMENSIONS) {
    const maximum = reference[maxField];
    const used = reference[usedField];
    const available = reference[availableField];
    if (Number.isInteger(maximum) && Number.isInteger(used) && Number.isInteger(available)) {
      if (used + available !== maximum) errors.push(`${maxField}_not_equal_to_used_plus_available`);
      if (used > maximum) errors.push(`${usedField}_exceeds_maximum`);
      if (available > maximum) errors.push(`${availableField}_exceeds_maximum`);
    }
  }
  if (typeof reference.quota_validated !== 'boolean') errors.push('quota_validated_must_be_boolean');
  else {
    const expectedValidated = QUOTA_DIMENSIONS.every(([m, u, a]) => (
      Number.isInteger(reference[m]) && Number.isInteger(reference[u]) && Number.isInteger(reference[a]) && reference[u] + reference[a] === reference[m]
    ));
    if (reference.quota_validated !== expectedValidated) errors.push('quota_validated_inconsistent_with_dimensions');
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_QUOTA_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_QUOTA_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueueQuotaFingerprint(reference) !== reference.quota_fingerprint) errors.push('quota_fingerprint_mismatch');
  } catch (error) {
    errors.push('quota_fingerprint_mismatch');
  }
  try {
    if (computeQueueQuotaDigest(reference) !== reference.quota_digest) errors.push('quota_digest_mismatch');
  } catch (error) {
    errors.push('quota_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueQuotaReference(input = {}) {
  const consistent = QUOTA_DIMENSIONS.every(([m, u, a]) => (
    Number.isInteger(input[m]) && Number.isInteger(input[u]) && Number.isInteger(input[a]) && input[u] + input[a] === input[m]
  ));

  const reference = {
    runtime_queue_quota_reference_id: input.runtime_queue_quota_reference_id,
    runtime_queue_quota_reference_version: Number.isInteger(input.runtime_queue_quota_reference_version) ? input.runtime_queue_quota_reference_version : 1,
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id,
    quota_validated: consistent,
    quota_fingerprint: 'pending',
    quota_digest: 'pending',
    ...RUNTIME_QUEUE_QUOTA_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_QUOTA_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of SCOPE_FIELDS) {
    reference[field] = input[field] === undefined ? null : input[field];
  }
  for (const field of QUOTA_NUMERIC_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  reference.quota_fingerprint = computeQueueQuotaFingerprint(reference);
  reference.quota_digest = computeQueueQuotaDigest(reference);

  const validation = validateRuntimeQueueQuotaReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_quota_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_QUOTA_BOUND,
  QUOTA_DIMENSIONS,
  QUOTA_NUMERIC_FIELDS,
  RUNTIME_QUEUE_QUOTA_REFERENCE_FIELDS,
  RUNTIME_QUEUE_QUOTA_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_QUOTA_REFERENCE_VALIDATOR_VERSION,
  SCOPE_FIELDS,
  buildRuntimeQueueQuotaReference,
  computeQueueQuotaDigest,
  computeQueueQuotaFingerprint,
  validateRuntimeQueueQuotaReference
};
