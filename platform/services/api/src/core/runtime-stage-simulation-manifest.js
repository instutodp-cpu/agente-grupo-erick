'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateRuntimeStageSimulationReference } = require('./runtime-stage-simulation-reference');

// Aggregates every RuntimeStageSimulationReference into a single auditable manifest -- preserves
// stages 1:1 (same count, same order, same stage_type, same references, same estimates), never
// infers or reconstructs anything. manifest_applied is always false: preparing this manifest is
// not admitting or running it (that distinction belongs to the future Runtime Readiness and
// Admission Boundary, PR #104).
const RUNTIME_STAGE_SIMULATION_MANIFEST_VALIDATOR_VERSION = 'runtime_stage_simulation_manifest_validator_v1';

const RUNTIME_STAGE_SIMULATION_MANIFEST_FIELDS = Object.freeze([
  'runtime_stage_manifest_id', 'runtime_stage_manifest_version', 'runtime_request_id', 'runtime_execution_package_id',
  'execution_plan_id', 'stage_manifest_reference_id', 'stage_manifest_fingerprint', 'runtime_stage_reference_ids',
  'runtime_stage_references', 'runtime_stage_count', 'ordered_runtime_stage_ids', 'model_stage_count',
  'tool_stage_count', 'workflow_stage_count', 'parallel_stage_count', 'optional_stage_count', 'approval_stage_count',
  'state_change_stage_count', 'external_effect_stage_count', 'irreversible_stage_count', 'estimated_input_tokens',
  'estimated_output_tokens', 'estimated_total_tokens', 'estimated_total_cost_minor_units', 'manifest_validated',
  'manifest_applied', 'manifest_fingerprint', 'simulation', 'production_blocked', 'validator_version'
]);

const STAGE_COUNT_FIELDS = Object.freeze([
  'model_stage_count', 'tool_stage_count', 'workflow_stage_count', 'parallel_stage_count', 'optional_stage_count',
  'approval_stage_count', 'state_change_stage_count', 'external_effect_stage_count', 'irreversible_stage_count'
]);

const RUNTIME_STAGE_SIMULATION_MANIFEST_SAFE_FLAGS = Object.freeze({
  manifest_applied: false,
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

// Canonical order = stage_sequence, mirroring orchestrator-stage-manifest-reference.js's own
// isCanonicalStageSequenceOrder exactly (record.stage_sequence === index).
function isCanonicalRuntimeStageOrder(references) {
  return references.every((reference, index) => isPlainObject(reference) && reference.stage_sequence === index);
}

function computeRuntimeStageSimulationManifestFingerprint(manifest) {
  const { manifest_fingerprint, ...rest } = manifest;
  return stablePayload(rest);
}

function validateRuntimeStageSimulationManifest(manifest) {
  const errors = [];
  if (!isPlainObject(manifest)) return { valid: false, errors: ['runtime_stage_simulation_manifest_must_be_object'] };
  exactFields(manifest, RUNTIME_STAGE_SIMULATION_MANIFEST_FIELDS, 'runtime_stage_simulation_manifest', errors);
  for (const field of [
    'runtime_stage_manifest_id', 'runtime_request_id', 'runtime_execution_package_id', 'execution_plan_id',
    'stage_manifest_reference_id', 'stage_manifest_fingerprint', 'manifest_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(manifest[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(manifest.runtime_stage_manifest_version) || manifest.runtime_stage_manifest_version < 1) {
    errors.push('runtime_stage_manifest_version_invalid');
  }

  if (!Array.isArray(manifest.runtime_stage_references) || manifest.runtime_stage_references.length === 0 || manifest.runtime_stage_references.length > MAX_LIST_ITEMS) {
    errors.push('runtime_stage_references_invalid');
  } else {
    manifest.runtime_stage_references.forEach((reference, index) => {
      errors.push(...validateRuntimeStageSimulationReference(reference).errors.map((e) => `runtime_stage_references[${index}]_${e}`));
    });
    const validReferences = manifest.runtime_stage_references.filter(isPlainObject);
    if (validReferences.length === manifest.runtime_stage_references.length) {
      const ids = validReferences.map((reference) => reference.runtime_stage_reference_id);
      if (new Set(ids).size !== ids.length) errors.push('runtime_stage_references_duplicate_id');
      if (!isCanonicalRuntimeStageOrder(validReferences)) errors.push('runtime_stage_references_not_in_canonical_sequence_order');
    }
  }

  if (!isOrderedUniqueStringList(manifest.runtime_stage_reference_ids)) {
    errors.push('runtime_stage_reference_ids_invalid');
  } else if (Array.isArray(manifest.runtime_stage_references)) {
    const validReferences = manifest.runtime_stage_references.filter(isPlainObject);
    if (validReferences.length === manifest.runtime_stage_references.length) {
      const expectedIds = [...validReferences.map((reference) => reference.runtime_stage_reference_id)].sort();
      if (manifest.runtime_stage_reference_ids.length !== expectedIds.length
        || manifest.runtime_stage_reference_ids.some((id, index) => id !== expectedIds[index])) {
        errors.push('runtime_stage_reference_ids_diverge_from_runtime_stage_references');
      }
    }
  }

  if (!Array.isArray(manifest.ordered_runtime_stage_ids) || !manifest.ordered_runtime_stage_ids.every(isNonEmptyString) || manifest.ordered_runtime_stage_ids.length > MAX_LIST_ITEMS) {
    errors.push('ordered_runtime_stage_ids_invalid');
  } else if (Array.isArray(manifest.runtime_stage_references)) {
    const validReferences = manifest.runtime_stage_references.filter(isPlainObject);
    if (validReferences.length === manifest.runtime_stage_references.length) {
      const expectedOrder = validReferences.map((reference) => reference.runtime_stage_reference_id);
      if (manifest.ordered_runtime_stage_ids.length !== expectedOrder.length
        || manifest.ordered_runtime_stage_ids.some((id, index) => id !== expectedOrder[index])) {
        errors.push('ordered_runtime_stage_ids_diverge_from_stage_sequence');
      }
    }
  }

  if (!Number.isInteger(manifest.runtime_stage_count) || manifest.runtime_stage_count < 0) {
    errors.push('runtime_stage_count_invalid');
  } else if (Array.isArray(manifest.runtime_stage_references) && manifest.runtime_stage_count !== manifest.runtime_stage_references.length) {
    errors.push('runtime_stage_count_inconsistent');
  }

  for (const field of STAGE_COUNT_FIELDS) {
    if (!Number.isInteger(manifest[field]) || manifest[field] < 0) errors.push(`${field}_invalid`);
  }
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_total_cost_minor_units']) {
    if (!Number.isInteger(manifest[field]) || manifest[field] < 0) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(manifest.estimated_input_tokens) && Number.isInteger(manifest.estimated_output_tokens) &&
    Number.isInteger(manifest.estimated_total_tokens) &&
    manifest.estimated_total_tokens !== manifest.estimated_input_tokens + manifest.estimated_output_tokens
  ) {
    errors.push('estimated_total_tokens_mismatch');
  }

  if (typeof manifest.manifest_validated !== 'boolean') errors.push('manifest_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_STAGE_SIMULATION_MANIFEST_SAFE_FLAGS)) {
    if (manifest[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (manifest.validator_version !== RUNTIME_STAGE_SIMULATION_MANIFEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(manifest);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeRuntimeStageSimulationManifestFingerprint(manifest) !== manifest.manifest_fingerprint) errors.push('manifest_fingerprint_mismatch');
  } catch (error) {
    errors.push('manifest_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(manifest));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeStageSimulationManifest(input = {}) {
  const references = Array.isArray(input.runtime_stage_references) ? input.runtime_stage_references : [];
  const validReferences = references.filter(isPlainObject);

  const estimatedInputTokens = validReferences.reduce((sum, r) => sum + (Number.isInteger(r.estimated_input_tokens) ? r.estimated_input_tokens : 0), 0);
  const estimatedOutputTokens = validReferences.reduce((sum, r) => sum + (Number.isInteger(r.estimated_output_tokens) ? r.estimated_output_tokens : 0), 0);
  const estimatedTotalCost = validReferences.reduce((sum, r) => sum + (Number.isInteger(r.estimated_cost_minor_units) ? r.estimated_cost_minor_units : 0), 0);

  const manifest = {
    runtime_stage_manifest_id: input.runtime_stage_manifest_id,
    runtime_stage_manifest_version: Number.isInteger(input.runtime_stage_manifest_version) ? input.runtime_stage_manifest_version : 1,
    runtime_request_id: input.runtime_request_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    stage_manifest_reference_id: input.stage_manifest_reference_id,
    stage_manifest_fingerprint: input.stage_manifest_fingerprint,
    runtime_stage_reference_ids: [...validReferences.map((r) => r.runtime_stage_reference_id)].sort(),
    runtime_stage_references: references,
    runtime_stage_count: references.length,
    ordered_runtime_stage_ids: validReferences.map((r) => r.runtime_stage_reference_id),
    model_stage_count: validReferences.filter((r) => r.stage_type === 'MODEL_REFERENCE_STAGE').length,
    tool_stage_count: validReferences.filter((r) => r.stage_type === 'TOOL_REFERENCE_STAGE').length,
    workflow_stage_count: validReferences.filter((r) => r.stage_type === 'WORKFLOW_REFERENCE_STAGE').length,
    parallel_stage_count: validReferences.filter((r) => r.parallelizable === true).length,
    optional_stage_count: validReferences.filter((r) => r.optional === true).length,
    approval_stage_count: validReferences.filter((r) => r.approval_required === true).length,
    state_change_stage_count: validReferences.filter((r) => r.side_effect_classification === 'STATE_CHANGE_REFERENCE').length,
    external_effect_stage_count: validReferences.filter((r) => r.side_effect_classification === 'EXTERNAL_EFFECT_REFERENCE').length,
    irreversible_stage_count: validReferences.filter((r) => r.side_effect_classification === 'IRREVERSIBLE_REFERENCE').length,
    estimated_input_tokens: estimatedInputTokens,
    estimated_output_tokens: estimatedOutputTokens,
    estimated_total_tokens: estimatedInputTokens + estimatedOutputTokens,
    estimated_total_cost_minor_units: estimatedTotalCost,
    manifest_validated: validReferences.length === references.length && references.length > 0
      && validReferences.every((r) => validateRuntimeStageSimulationReference(r).valid),
    manifest_fingerprint: 'pending',
    ...RUNTIME_STAGE_SIMULATION_MANIFEST_SAFE_FLAGS,
    validator_version: RUNTIME_STAGE_SIMULATION_MANIFEST_VALIDATOR_VERSION
  };
  manifest.manifest_fingerprint = computeRuntimeStageSimulationManifestFingerprint(manifest);

  const validation = validateRuntimeStageSimulationManifest(manifest);
  if (!validation.valid) {
    throw new Error(`runtime_stage_simulation_manifest_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(manifest);
}

module.exports = {
  MAX_LIST_ITEMS,
  RUNTIME_STAGE_SIMULATION_MANIFEST_FIELDS,
  RUNTIME_STAGE_SIMULATION_MANIFEST_SAFE_FLAGS,
  RUNTIME_STAGE_SIMULATION_MANIFEST_VALIDATOR_VERSION,
  STAGE_COUNT_FIELDS,
  buildRuntimeStageSimulationManifest,
  computeRuntimeStageSimulationManifestFingerprint,
  isCanonicalRuntimeStageOrder,
  isOrderedUniqueStringList,
  validateRuntimeStageSimulationManifest
};
