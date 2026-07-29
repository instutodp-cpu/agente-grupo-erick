'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { hasDependencyCycle } = require('./orchestrator-plan-dependency');
const { validateRuntimeDependencySimulationReference } = require('./runtime-dependency-simulation-reference');

const RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_VALIDATOR_VERSION = 'runtime_dependency_simulation_manifest_validator_v1';

const RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_FIELDS = Object.freeze([
  'runtime_dependency_manifest_id', 'runtime_dependency_manifest_version', 'runtime_execution_package_id',
  'execution_plan_id', 'dependency_graph_reference_id', 'dependency_graph_fingerprint',
  'runtime_dependency_reference_ids', 'runtime_dependency_references', 'runtime_dependency_count', 'cycle_free',
  'all_stage_ids_present', 'all_dependencies_validated', 'dependencies_applied', 'manifest_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_SAFE_FLAGS = Object.freeze({
  dependencies_applied: false,
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

function detectRuntimeDependencyCycle(references) {
  return hasDependencyCycle(references.map((r) => ({ from_stage_id: r.from_runtime_stage_id, to_stage_id: r.to_runtime_stage_id })));
}

function computeRuntimeDependencySimulationManifestFingerprint(manifest) {
  const { manifest_fingerprint, ...rest } = manifest;
  return stablePayload(rest);
}

function validateRuntimeDependencySimulationManifest(manifest, options = {}) {
  const errors = [];
  if (!isPlainObject(manifest)) return { valid: false, errors: ['runtime_dependency_simulation_manifest_must_be_object'] };
  exactFields(manifest, RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_FIELDS, 'runtime_dependency_simulation_manifest', errors);
  for (const field of [
    'runtime_dependency_manifest_id', 'runtime_execution_package_id', 'execution_plan_id',
    'dependency_graph_reference_id', 'dependency_graph_fingerprint', 'manifest_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(manifest[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(manifest.runtime_dependency_manifest_version) || manifest.runtime_dependency_manifest_version < 1) {
    errors.push('runtime_dependency_manifest_version_invalid');
  }

  if (!Array.isArray(manifest.runtime_dependency_references) || manifest.runtime_dependency_references.length > MAX_LIST_ITEMS) {
    errors.push('runtime_dependency_references_invalid');
  } else {
    manifest.runtime_dependency_references.forEach((reference, index) => {
      errors.push(...validateRuntimeDependencySimulationReference(reference).errors.map((e) => `runtime_dependency_references[${index}]_${e}`));
    });
  }
  if (!isOrderedUniqueStringList(manifest.runtime_dependency_reference_ids)) errors.push('runtime_dependency_reference_ids_invalid');
  if (!Number.isInteger(manifest.runtime_dependency_count) || manifest.runtime_dependency_count < 0) {
    errors.push('runtime_dependency_count_invalid');
  } else if (Array.isArray(manifest.runtime_dependency_references) && manifest.runtime_dependency_count !== manifest.runtime_dependency_references.length) {
    errors.push('runtime_dependency_count_inconsistent');
  }

  const validReferences = Array.isArray(manifest.runtime_dependency_references) ? manifest.runtime_dependency_references.filter(isPlainObject) : [];
  if (typeof manifest.cycle_free !== 'boolean') errors.push('cycle_free_must_be_boolean');
  else if (validReferences.length === (manifest.runtime_dependency_references || []).length) {
    const expectedCycleFree = !detectRuntimeDependencyCycle(validReferences);
    if (manifest.cycle_free !== expectedCycleFree) errors.push('cycle_free_does_not_match_graph');
  }
  if (typeof manifest.all_stage_ids_present !== 'boolean') errors.push('all_stage_ids_present_must_be_boolean');
  if (options.knownStageIds && validReferences.length === (manifest.runtime_dependency_references || []).length) {
    const expectedPresent = validReferences.every((r) => options.knownStageIds.has(r.from_runtime_stage_id) && options.knownStageIds.has(r.to_runtime_stage_id));
    if (manifest.all_stage_ids_present !== expectedPresent) errors.push('all_stage_ids_present_does_not_match_references');
  }
  if (typeof manifest.all_dependencies_validated !== 'boolean') errors.push('all_dependencies_validated_must_be_boolean');
  else if (validReferences.length === (manifest.runtime_dependency_references || []).length) {
    const expectedValidated = validReferences.every((r) => r.dependency_validated === true);
    if (manifest.all_dependencies_validated !== expectedValidated) errors.push('all_dependencies_validated_does_not_match_references');
  }

  for (const [field, expected] of Object.entries(RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_SAFE_FLAGS)) {
    if (manifest[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (manifest.validator_version !== RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(manifest);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeRuntimeDependencySimulationManifestFingerprint(manifest) !== manifest.manifest_fingerprint) errors.push('manifest_fingerprint_mismatch');
  } catch (error) {
    errors.push('manifest_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(manifest));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// knownStageIds: the set of runtime stage reference ids this dependency graph is allowed to
// reference (from the sibling RuntimeStageSimulationManifest) -- required to derive
// all_stage_ids_present honestly, never assumed true.
function buildRuntimeDependencySimulationManifest(input = {}, options = {}) {
  const references = Array.isArray(input.runtime_dependency_references) ? input.runtime_dependency_references : [];
  const validReferences = references.filter(isPlainObject);
  const knownStageIds = options.knownStageIds instanceof Set ? options.knownStageIds : null;

  const manifest = {
    runtime_dependency_manifest_id: input.runtime_dependency_manifest_id,
    runtime_dependency_manifest_version: Number.isInteger(input.runtime_dependency_manifest_version) ? input.runtime_dependency_manifest_version : 1,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    dependency_graph_reference_id: input.dependency_graph_reference_id,
    dependency_graph_fingerprint: input.dependency_graph_fingerprint,
    runtime_dependency_reference_ids: [...validReferences.map((r) => r.runtime_dependency_reference_id)].sort(),
    runtime_dependency_references: references,
    runtime_dependency_count: references.length,
    cycle_free: !detectRuntimeDependencyCycle(validReferences),
    all_stage_ids_present: knownStageIds
      ? validReferences.every((r) => knownStageIds.has(r.from_runtime_stage_id) && knownStageIds.has(r.to_runtime_stage_id))
      : validReferences.length === references.length,
    all_dependencies_validated: validReferences.length === references.length && validReferences.every((r) => r.dependency_validated === true),
    manifest_fingerprint: 'pending',
    ...RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_SAFE_FLAGS,
    validator_version: RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_VALIDATOR_VERSION
  };
  manifest.manifest_fingerprint = computeRuntimeDependencySimulationManifestFingerprint(manifest);

  const validation = validateRuntimeDependencySimulationManifest(manifest, { knownStageIds });
  if (!validation.valid) {
    throw new Error(`runtime_dependency_simulation_manifest_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(manifest);
}

module.exports = {
  MAX_LIST_ITEMS,
  RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_FIELDS,
  RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_SAFE_FLAGS,
  RUNTIME_DEPENDENCY_SIMULATION_MANIFEST_VALIDATOR_VERSION,
  buildRuntimeDependencySimulationManifest,
  computeRuntimeDependencySimulationManifestFingerprint,
  detectRuntimeDependencyCycle,
  isOrderedUniqueStringList,
  validateRuntimeDependencySimulationManifest
};
