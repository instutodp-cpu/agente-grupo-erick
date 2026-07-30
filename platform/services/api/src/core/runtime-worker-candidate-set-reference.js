'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr106: the declarative partition of every worker evaluated for a single Scheduler Stage Reference
// into compatible/incompatible sets, plus (when at least one compatible worker exists) a single
// deterministically-selected recommendation. "Nenhuma recomendação quando não houver compatível" --
// recommended_worker_reference_id is null whenever compatible_worker_reference_ids is empty, and
// always a member of that set otherwise. candidate_set_applied stays permanently false: a candidate
// set is only ever a declarative snapshot, never consumed.
const RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_candidate_set_reference_validator_v1';

const SELECTION_STRATEGIES = Object.freeze(['DETERMINISTIC_CAPABILITY_CAPACITY_PRIORITY']);

const RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_FIELDS = Object.freeze([
  'worker_candidate_set_reference_id', 'worker_candidate_set_reference_version',
  'runtime_worker_assignment_request_id', 'runtime_scheduler_package_id', 'scheduler_stage_reference_id',
  'runtime_stage_reference_id',
  'worker_compatibility_reference_ids', 'compatible_worker_reference_ids', 'incompatible_worker_reference_ids',
  'candidate_count', 'compatible_candidate_count', 'incompatible_candidate_count',
  'recommended_worker_reference_id', 'selection_strategy', 'selection_reason_codes',
  'candidate_set_validated', 'candidate_set_applied',
  'candidate_set_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_SAFE_FLAGS = Object.freeze({
  candidate_set_applied: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 500;
const MAX_COUNT = 100000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeCandidateSetFingerprint(reference) {
  const { candidate_set_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeWorkerCandidateSetReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_candidate_set_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_FIELDS, 'runtime_worker_candidate_set_reference', errors);
  for (const field of [
    'worker_candidate_set_reference_id', 'runtime_worker_assignment_request_id', 'runtime_scheduler_package_id',
    'scheduler_stage_reference_id', 'runtime_stage_reference_id', 'candidate_set_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.worker_candidate_set_reference_version) || reference.worker_candidate_set_reference_version < 1) {
    errors.push('worker_candidate_set_reference_version_invalid');
  }
  if (!isOrderedUniqueStringList(reference.worker_compatibility_reference_ids)) errors.push('worker_compatibility_reference_ids_invalid');
  if (!isOrderedUniqueStringList(reference.compatible_worker_reference_ids)) errors.push('compatible_worker_reference_ids_invalid');
  if (!isOrderedUniqueStringList(reference.incompatible_worker_reference_ids)) errors.push('incompatible_worker_reference_ids_invalid');
  if (
    Array.isArray(reference.compatible_worker_reference_ids) && Array.isArray(reference.incompatible_worker_reference_ids)
    && reference.compatible_worker_reference_ids.some((id) => reference.incompatible_worker_reference_ids.includes(id))
  ) {
    errors.push('compatible_and_incompatible_sets_overlap');
  }
  for (const field of ['candidate_count', 'compatible_candidate_count', 'incompatible_candidate_count']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (
    Array.isArray(reference.compatible_worker_reference_ids) && Array.isArray(reference.incompatible_worker_reference_ids)
    && Number.isInteger(reference.candidate_count) && Number.isInteger(reference.compatible_candidate_count)
    && Number.isInteger(reference.incompatible_candidate_count)
  ) {
    if (reference.compatible_candidate_count !== reference.compatible_worker_reference_ids.length) errors.push('compatible_candidate_count_inconsistent');
    if (reference.incompatible_candidate_count !== reference.incompatible_worker_reference_ids.length) errors.push('incompatible_candidate_count_inconsistent');
    if (reference.candidate_count !== reference.compatible_candidate_count + reference.incompatible_candidate_count) {
      errors.push('candidate_count_does_not_partition_compatible_and_incompatible');
    }
  }
  if (reference.recommended_worker_reference_id !== null && !isNonEmptyString(reference.recommended_worker_reference_id)) {
    errors.push('recommended_worker_reference_id_must_be_null_or_string');
  }
  if (Array.isArray(reference.compatible_worker_reference_ids)) {
    if (reference.compatible_worker_reference_ids.length === 0 && reference.recommended_worker_reference_id !== null) {
      errors.push('recommended_worker_reference_id_must_be_null_when_no_compatible_candidate');
    }
    if (
      reference.recommended_worker_reference_id !== null
      && !reference.compatible_worker_reference_ids.includes(reference.recommended_worker_reference_id)
    ) {
      errors.push('recommended_worker_reference_id_must_be_a_compatible_candidate');
    }
  }
  if (!SELECTION_STRATEGIES.includes(reference.selection_strategy)) errors.push('selection_strategy_invalid');
  if (!isOrderedUniqueStringList(reference.selection_reason_codes)) errors.push('selection_reason_codes_invalid');
  if (typeof reference.candidate_set_validated !== 'boolean') errors.push('candidate_set_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeCandidateSetFingerprint(reference) !== reference.candidate_set_fingerprint) errors.push('candidate_set_fingerprint_mismatch');
  } catch (error) {
    errors.push('candidate_set_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerCandidateSetReference(input = {}) {
  const compatibleIds = uniqueSorted(input.compatible_worker_reference_ids || []);
  const incompatibleIds = uniqueSorted(input.incompatible_worker_reference_ids || []);
  const reference = {
    worker_candidate_set_reference_id: input.worker_candidate_set_reference_id,
    worker_candidate_set_reference_version: Number.isInteger(input.worker_candidate_set_reference_version) ? input.worker_candidate_set_reference_version : 1,
    runtime_worker_assignment_request_id: input.runtime_worker_assignment_request_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    worker_compatibility_reference_ids: uniqueSorted(input.worker_compatibility_reference_ids || []),
    compatible_worker_reference_ids: compatibleIds,
    incompatible_worker_reference_ids: incompatibleIds,
    candidate_count: compatibleIds.length + incompatibleIds.length,
    compatible_candidate_count: compatibleIds.length,
    incompatible_candidate_count: incompatibleIds.length,
    recommended_worker_reference_id: input.recommended_worker_reference_id === undefined ? null : input.recommended_worker_reference_id,
    selection_strategy: SELECTION_STRATEGIES.includes(input.selection_strategy) ? input.selection_strategy : 'DETERMINISTIC_CAPABILITY_CAPACITY_PRIORITY',
    selection_reason_codes: Array.isArray(input.selection_reason_codes) ? uniqueSorted(input.selection_reason_codes) : [],
    candidate_set_validated: true,
    candidate_set_fingerprint: 'pending',
    ...RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_VALIDATOR_VERSION
  };
  reference.candidate_set_fingerprint = computeCandidateSetFingerprint(reference);

  const validation = validateRuntimeWorkerCandidateSetReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_candidate_set_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_COUNT,
  MAX_LIST_ITEMS,
  RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_FIELDS,
  RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_CANDIDATE_SET_REFERENCE_VALIDATOR_VERSION,
  SELECTION_STRATEGIES,
  buildRuntimeWorkerCandidateSetReference,
  computeCandidateSetFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeWorkerCandidateSetReference
};
