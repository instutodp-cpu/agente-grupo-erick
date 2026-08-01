'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr106: "Compatibilidade deve ser recalculada. Não aceitar worker_compatible=true como fonte de
// verdade." runtime-worker-assignment-boundary.js is the only place that actually derives every one
// of the 17 match dimensions (tenant/organization/project/agent-scope, stage-type, capability,
// modality, model/tool/workflow support, network/secret/effect policy, health, capacity,
// concurrency, freshness); this contract only validates that `worker_compatible` is the logical AND
// of all 17 -- never a caller-declared shortcut. `compatibility_applied` stays permanently false: no
// compatibility result is ever "applied" to reserve or bind anything.
const RUNTIME_WORKER_COMPATIBILITY_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_compatibility_reference_validator_v1';

const MATCH_FIELDS = Object.freeze([
  'tenant_match', 'organization_match', 'project_match', 'agent_scope_match', 'stage_type_match', 'capability_match',
  'modality_match', 'model_support_match', 'tool_support_match', 'workflow_support_match', 'network_policy_match',
  'secret_policy_match', 'effect_policy_match', 'health_match', 'capacity_match', 'concurrency_match',
  'freshness_match'
]);

const RUNTIME_WORKER_COMPATIBILITY_REFERENCE_FIELDS = Object.freeze([
  'worker_compatibility_reference_id', 'worker_compatibility_reference_version',
  'runtime_worker_assignment_request_id', 'runtime_scheduler_package_id', 'scheduler_stage_reference_id',
  'runtime_stage_reference_id', 'runtime_worker_reference_id',
  ...MATCH_FIELDS,
  'worker_compatible', 'compatibility_validated', 'compatibility_applied',
  'mismatch_reason_codes',
  'compatibility_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_COMPATIBILITY_REFERENCE_SAFE_FLAGS = Object.freeze({
  compatibility_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 50;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeCompatibilityFingerprint(reference) {
  const { compatibility_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeWorkerCompatibilityReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_compatibility_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_COMPATIBILITY_REFERENCE_FIELDS, 'runtime_worker_compatibility_reference', errors);
  for (const field of [
    'worker_compatibility_reference_id', 'runtime_worker_assignment_request_id', 'runtime_scheduler_package_id',
    'scheduler_stage_reference_id', 'runtime_stage_reference_id', 'runtime_worker_reference_id',
    'compatibility_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.worker_compatibility_reference_version) || reference.worker_compatibility_reference_version < 1) {
    errors.push('worker_compatibility_reference_version_invalid');
  }
  for (const field of MATCH_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  const expectedCompatible = MATCH_FIELDS.every((field) => reference[field] === true);
  if (typeof reference.worker_compatible !== 'boolean') errors.push('worker_compatible_must_be_boolean');
  else if (reference.worker_compatible !== expectedCompatible) errors.push('worker_compatible_inconsistent_with_matches');
  if (typeof reference.compatibility_validated !== 'boolean') errors.push('compatibility_validated_must_be_boolean');
  if (!isOrderedUniqueStringList(reference.mismatch_reason_codes)) errors.push('mismatch_reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_COMPATIBILITY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_WORKER_COMPATIBILITY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeCompatibilityFingerprint(reference) !== reference.compatibility_fingerprint) errors.push('compatibility_fingerprint_mismatch');
  } catch (error) {
    errors.push('compatibility_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerCompatibilityReference(input = {}) {
  const reference = {
    worker_compatibility_reference_id: input.worker_compatibility_reference_id,
    worker_compatibility_reference_version: Number.isInteger(input.worker_compatibility_reference_version) ? input.worker_compatibility_reference_version : 1,
    runtime_worker_assignment_request_id: input.runtime_worker_assignment_request_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    compatibility_validated: true,
    mismatch_reason_codes: Array.isArray(input.mismatch_reason_codes) ? uniqueSorted(input.mismatch_reason_codes) : [],
    compatibility_fingerprint: 'pending',
    ...RUNTIME_WORKER_COMPATIBILITY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_COMPATIBILITY_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of MATCH_FIELDS) {
    reference[field] = input[field] === true;
  }
  reference.worker_compatible = MATCH_FIELDS.every((field) => reference[field] === true);
  reference.compatibility_fingerprint = computeCompatibilityFingerprint(reference);

  const validation = validateRuntimeWorkerCompatibilityReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_compatibility_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MATCH_FIELDS,
  MAX_LIST_ITEMS,
  RUNTIME_WORKER_COMPATIBILITY_REFERENCE_FIELDS,
  RUNTIME_WORKER_COMPATIBILITY_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_COMPATIBILITY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeWorkerCompatibilityReference,
  computeCompatibilityFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeWorkerCompatibilityReference
};
