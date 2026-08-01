'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');
const { MODALITIES } = require('./model-contract');

// pr106: a declarative description of what a synthetic worker claims to support -- capability/
// modality/stage-type/model-provider/model/tool/workflow IDs, plus the 8 boolean support flags the
// boundary's own compatibility derivation cross-checks against each Scheduler Stage Reference.
// "Não aceitar worker_compatible=true como fonte de verdade" -- this contract only records what the
// worker declares; runtime-worker-assignment-boundary.js recomputes compatibility independently,
// never trusting these flags alone. External/irreversible support is permanently forced false --
// no worker ever claims to support what this whole lineage already forbids globally.
const RUNTIME_WORKER_CAPABILITY_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_capability_reference_validator_v1';

const ID_LIST_FIELDS = Object.freeze(['capability_ids', 'model_provider_ids', 'model_ids', 'tool_ids', 'workflow_ids']);

const SUPPORTS_FLAG_FIELDS = Object.freeze([
  'supports_no_llm', 'supports_model_reference', 'supports_tool_reference', 'supports_workflow_reference',
  'supports_parallel_reference', 'supports_state_change_reference', 'supports_external_effect_reference',
  'supports_irreversible_reference'
]);

const RUNTIME_WORKER_CAPABILITY_REFERENCE_FIELDS = Object.freeze([
  'worker_capability_reference_id', 'worker_capability_reference_version', 'runtime_worker_reference_id',
  ...ID_LIST_FIELDS.slice(0, 1), 'modality_ids', 'stage_type_ids', ...ID_LIST_FIELDS.slice(1),
  ...SUPPORTS_FLAG_FIELDS,
  'capability_validated', 'capability_applied',
  'capability_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_CAPABILITY_REFERENCE_SAFE_FLAGS = Object.freeze({
  supports_external_effect_reference: false,
  supports_irreversible_reference: false,
  capability_applied: false,
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

function isOrderedUniqueEnumSubset(list, allowed, maxItems = MAX_LIST_ITEMS) {
  return isOrderedUniqueStringList(list, maxItems) && list.every((item) => allowed.includes(item));
}

function computeCapabilityFingerprint(reference) {
  const { capability_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeWorkerCapabilityReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_capability_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_CAPABILITY_REFERENCE_FIELDS, 'runtime_worker_capability_reference', errors);
  for (const field of ['worker_capability_reference_id', 'runtime_worker_reference_id', 'capability_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.worker_capability_reference_version) || reference.worker_capability_reference_version < 1) {
    errors.push('worker_capability_reference_version_invalid');
  }
  if (!isOrderedUniqueStringList(reference.capability_ids)) errors.push('capability_ids_invalid');
  if (!isOrderedUniqueEnumSubset(reference.modality_ids, MODALITIES)) errors.push('modality_ids_invalid');
  if (!isOrderedUniqueEnumSubset(reference.stage_type_ids, STAGE_TYPES)) errors.push('stage_type_ids_invalid');
  if (!isOrderedUniqueStringList(reference.model_provider_ids)) errors.push('model_provider_ids_invalid');
  if (!isOrderedUniqueStringList(reference.model_ids)) errors.push('model_ids_invalid');
  if (!isOrderedUniqueStringList(reference.tool_ids)) errors.push('tool_ids_invalid');
  if (!isOrderedUniqueStringList(reference.workflow_ids)) errors.push('workflow_ids_invalid');
  for (const field of SUPPORTS_FLAG_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.capability_validated !== 'boolean') errors.push('capability_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_CAPABILITY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_WORKER_CAPABILITY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeCapabilityFingerprint(reference) !== reference.capability_fingerprint) errors.push('capability_fingerprint_mismatch');
  } catch (error) {
    errors.push('capability_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerCapabilityReference(input = {}) {
  const reference = {
    worker_capability_reference_id: input.worker_capability_reference_id,
    worker_capability_reference_version: Number.isInteger(input.worker_capability_reference_version) ? input.worker_capability_reference_version : 1,
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    capability_ids: uniqueSorted(input.capability_ids || []),
    modality_ids: uniqueSorted(input.modality_ids || []),
    stage_type_ids: uniqueSorted(input.stage_type_ids || []),
    model_provider_ids: uniqueSorted(input.model_provider_ids || []),
    model_ids: uniqueSorted(input.model_ids || []),
    tool_ids: uniqueSorted(input.tool_ids || []),
    workflow_ids: uniqueSorted(input.workflow_ids || []),
    capability_validated: true,
    capability_fingerprint: 'pending',
    ...RUNTIME_WORKER_CAPABILITY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_CAPABILITY_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of SUPPORTS_FLAG_FIELDS) {
    if (!(field in RUNTIME_WORKER_CAPABILITY_REFERENCE_SAFE_FLAGS)) reference[field] = input[field] === true;
  }
  reference.capability_fingerprint = computeCapabilityFingerprint(reference);

  const validation = validateRuntimeWorkerCapabilityReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_capability_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  ID_LIST_FIELDS,
  MAX_LIST_ITEMS,
  RUNTIME_WORKER_CAPABILITY_REFERENCE_FIELDS,
  RUNTIME_WORKER_CAPABILITY_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_CAPABILITY_REFERENCE_VALIDATOR_VERSION,
  SUPPORTS_FLAG_FIELDS,
  buildRuntimeWorkerCapabilityReference,
  computeCapabilityFingerprint,
  isOrderedUniqueEnumSubset,
  isOrderedUniqueStringList,
  validateRuntimeWorkerCapabilityReference
};
