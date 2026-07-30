'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');
const { MODALITIES } = require('./model-contract');

// pr106: "Worker não pode ser representado por ID solto." A versioned, fingerprinted, immutable
// declarative description of a synthetic worker -- identity, scope, supported stage types/
// modalities/capabilities/model-provider/model/tool/workflow IDs, network/secret/effect policy
// references, and its own capability/capacity/health sub-reference bindings. "A referência não
// comprova que um worker real existe" -- nothing here ever starts a process, opens a connection, or
// reserves anything (worker_reserved/worker_started/worker_connection_opened are permanently
// forced false).
const RUNTIME_WORKER_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_reference_validator_v1';

const WORKER_TYPES = Object.freeze(['LOCAL_REFERENCE', 'REMOTE_REFERENCE', 'SHARED_REFERENCE', 'DEDICATED_REFERENCE']);

const WORKER_CLASSIFICATIONS = Object.freeze([
  'DETERMINISTIC_WORKER_REFERENCE', 'MODEL_WORKER_REFERENCE', 'TOOL_WORKER_REFERENCE', 'WORKFLOW_WORKER_REFERENCE',
  'MULTI_CAPABILITY_WORKER_REFERENCE'
]);

const WORKER_STATUSES = Object.freeze([
  'WORKER_AVAILABLE_REFERENCE_SIMULATION', 'WORKER_CAPACITY_EXHAUSTED_REFERENCE', 'WORKER_UNHEALTHY_REFERENCE',
  'WORKER_DISABLED_REFERENCE', 'WORKER_BLOCKED_REFERENCE'
]);

const NULLABLE_SCOPE_FIELDS = Object.freeze(['tenant_scope_id', 'organization_scope_id', 'project_scope_id']);

const SUPPORTED_LIST_FIELDS = Object.freeze([
  'supported_capability_ids', 'supported_model_provider_ids', 'supported_model_ids', 'supported_tool_ids',
  'supported_workflow_ids'
]);

const RUNTIME_WORKER_REFERENCE_FIELDS = Object.freeze([
  'runtime_worker_reference_id', 'runtime_worker_reference_version',
  'runtime_environment_reference_id', 'runtime_registry_snapshot_reference_id',
  'worker_type', 'worker_classification', 'worker_status',
  ...NULLABLE_SCOPE_FIELDS, 'agent_scope_ids',
  'supported_stage_types', 'supported_modalities', ...SUPPORTED_LIST_FIELDS,
  'network_policy_reference_id', 'secret_policy_reference_id', 'effect_policy_reference_id',
  'worker_capability_reference_id', 'worker_capacity_reference_id', 'worker_health_reference_id',
  'maximum_parallel_assignments', 'current_parallel_assignments', 'available_parallel_assignments',
  'worker_registered', 'worker_active_reference', 'worker_reserved', 'worker_started', 'worker_connection_opened',
  'worker_fingerprint', 'worker_digest',
  'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const RUNTIME_WORKER_REFERENCE_SAFE_FLAGS = Object.freeze({
  worker_registered: true,
  worker_reserved: false,
  worker_started: false,
  worker_connection_opened: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_ASSIGNMENTS = 1000000;

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

function computeWorkerFingerprint(reference) {
  const { worker_fingerprint, worker_digest, ...rest } = reference;
  return stablePayload(rest);
}

function computeWorkerDigest(reference) {
  const { worker_digest, ...rest } = reference;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeWorkerReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_REFERENCE_FIELDS, 'runtime_worker_reference', errors);
  for (const field of [
    'runtime_worker_reference_id', 'runtime_environment_reference_id', 'runtime_registry_snapshot_reference_id',
    'network_policy_reference_id', 'secret_policy_reference_id', 'effect_policy_reference_id',
    'worker_capability_reference_id', 'worker_capacity_reference_id', 'worker_health_reference_id',
    'worker_fingerprint', 'worker_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_worker_reference_version) || reference.runtime_worker_reference_version < 1) {
    errors.push('runtime_worker_reference_version_invalid');
  }
  if (!WORKER_TYPES.includes(reference.worker_type)) errors.push('worker_type_invalid');
  if (!WORKER_CLASSIFICATIONS.includes(reference.worker_classification)) errors.push('worker_classification_invalid');
  if (!WORKER_STATUSES.includes(reference.worker_status)) errors.push('worker_status_invalid');
  for (const field of NULLABLE_SCOPE_FIELDS) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!isOrderedUniqueStringList(reference.agent_scope_ids)) errors.push('agent_scope_ids_invalid');
  if (!isOrderedUniqueEnumSubset(reference.supported_stage_types, STAGE_TYPES)) errors.push('supported_stage_types_invalid');
  if (!isOrderedUniqueEnumSubset(reference.supported_modalities, MODALITIES)) errors.push('supported_modalities_invalid');
  for (const field of SUPPORTED_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(reference[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['maximum_parallel_assignments', 'current_parallel_assignments', 'available_parallel_assignments']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_ASSIGNMENTS) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(reference.maximum_parallel_assignments) && Number.isInteger(reference.current_parallel_assignments)
    && Number.isInteger(reference.available_parallel_assignments)
  ) {
    if (reference.current_parallel_assignments > reference.maximum_parallel_assignments) errors.push('current_parallel_assignments_exceeds_maximum');
    if (reference.available_parallel_assignments !== reference.maximum_parallel_assignments - reference.current_parallel_assignments) {
      errors.push('available_parallel_assignments_does_not_match_maximum_minus_current');
    }
  }
  if (typeof reference.worker_active_reference !== 'boolean') errors.push('worker_active_reference_must_be_boolean');
  else if (reference.worker_active_reference !== (reference.worker_status === 'WORKER_AVAILABLE_REFERENCE_SIMULATION')) {
    errors.push('worker_active_reference_does_not_match_status');
  }
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (reference.validator_version !== RUNTIME_WORKER_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeWorkerFingerprint(reference) !== reference.worker_fingerprint) errors.push('worker_fingerprint_mismatch');
  } catch (error) {
    errors.push('worker_fingerprint_mismatch');
  }
  try {
    if (computeWorkerDigest(reference) !== reference.worker_digest) errors.push('worker_digest_mismatch');
  } catch (error) {
    errors.push('worker_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerReference(input = {}) {
  const status = WORKER_STATUSES.includes(input.worker_status) ? input.worker_status : 'WORKER_BLOCKED_REFERENCE';
  const reference = {
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    runtime_worker_reference_version: Number.isInteger(input.runtime_worker_reference_version) ? input.runtime_worker_reference_version : 1,
    runtime_environment_reference_id: input.runtime_environment_reference_id,
    runtime_registry_snapshot_reference_id: input.runtime_registry_snapshot_reference_id,
    worker_type: input.worker_type,
    worker_classification: input.worker_classification,
    worker_status: status,
    agent_scope_ids: uniqueSorted(input.agent_scope_ids || []),
    supported_stage_types: uniqueSorted(input.supported_stage_types || []),
    supported_modalities: uniqueSorted(input.supported_modalities || []),
    network_policy_reference_id: input.network_policy_reference_id,
    secret_policy_reference_id: input.secret_policy_reference_id,
    effect_policy_reference_id: input.effect_policy_reference_id,
    worker_capability_reference_id: input.worker_capability_reference_id,
    worker_capacity_reference_id: input.worker_capacity_reference_id,
    worker_health_reference_id: input.worker_health_reference_id,
    maximum_parallel_assignments: Number.isInteger(input.maximum_parallel_assignments) ? input.maximum_parallel_assignments : 0,
    current_parallel_assignments: Number.isInteger(input.current_parallel_assignments) ? input.current_parallel_assignments : 0,
    worker_active_reference: status === 'WORKER_AVAILABLE_REFERENCE_SIMULATION',
    worker_fingerprint: 'pending',
    worker_digest: 'pending',
    rollout_percentage: 0,
    ...RUNTIME_WORKER_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of NULLABLE_SCOPE_FIELDS) {
    reference[field] = input[field] === undefined ? null : input[field];
  }
  for (const field of SUPPORTED_LIST_FIELDS) {
    reference[field] = uniqueSorted(input[field] || []);
  }
  reference.available_parallel_assignments = reference.maximum_parallel_assignments - reference.current_parallel_assignments;
  reference.worker_fingerprint = computeWorkerFingerprint(reference);
  reference.worker_digest = computeWorkerDigest(reference);

  const validation = validateRuntimeWorkerReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_ASSIGNMENTS,
  MAX_LIST_ITEMS,
  NULLABLE_SCOPE_FIELDS,
  RUNTIME_WORKER_REFERENCE_FIELDS,
  RUNTIME_WORKER_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_REFERENCE_VALIDATOR_VERSION,
  SUPPORTED_LIST_FIELDS,
  WORKER_CLASSIFICATIONS,
  WORKER_STATUSES,
  WORKER_TYPES,
  buildRuntimeWorkerReference,
  computeWorkerDigest,
  computeWorkerFingerprint,
  isOrderedUniqueEnumSubset,
  isOrderedUniqueStringList,
  validateRuntimeWorkerReference
};
