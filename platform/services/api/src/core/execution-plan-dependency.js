'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { DEPENDENCY_TYPES, hasDependencyCycle } = require('./orchestrator-plan-dependency');

const EXECUTION_PLAN_DEPENDENCY_VALIDATOR_VERSION = 'execution_plan_dependency_validator_v1';

const EXECUTION_PLAN_DEPENDENCY_FIELDS = Object.freeze([
  'dependency_id', 'dependency_version', 'execution_plan_id', 'from_stage_id', 'to_stage_id', 'dependency_type',
  'required', 'dependency_validated', 'dependency_satisfied', 'dependency_applied', 'dependency_fingerprint',
  'reason_codes', 'validator_version'
]);

const EXECUTION_PLAN_DEPENDENCY_SAFE_FLAGS = Object.freeze({
  dependency_satisfied: false,
  dependency_applied: false
});

const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateExecutionPlanDependency(dependency) {
  const errors = [];
  if (!isPlainObject(dependency)) return { valid: false, errors: ['execution_plan_dependency_must_be_object'] };
  exactFields(dependency, EXECUTION_PLAN_DEPENDENCY_FIELDS, 'execution_plan_dependency', errors);
  for (const field of ['dependency_id', 'execution_plan_id', 'from_stage_id', 'to_stage_id', 'dependency_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(dependency[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(dependency.dependency_version) || dependency.dependency_version < 1) errors.push('dependency_version_invalid');
  if (!DEPENDENCY_TYPES.includes(dependency.dependency_type)) errors.push(`dependency_type_not_allowed::${dependency.dependency_type}`);
  for (const field of ['required', 'dependency_validated']) {
    if (typeof dependency[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!isOrderedUniqueStringList(dependency.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_DEPENDENCY_SAFE_FLAGS)) {
    if (dependency[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (isNonEmptyString(dependency.from_stage_id) && dependency.from_stage_id === dependency.to_stage_id) {
    errors.push('dependency_cannot_reference_its_own_stage');
  }
  if (dependency.validator_version !== EXECUTION_PLAN_DEPENDENCY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(dependency);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(dependency));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeDependencyFingerprint(dependency) {
  const { dependency_fingerprint, ...rest } = dependency;
  return stablePayload(rest);
}

function buildExecutionPlanDependency(input = {}) {
  const dependency = {
    dependency_id: input.dependency_id,
    dependency_version: Number.isInteger(input.dependency_version) ? input.dependency_version : 1,
    execution_plan_id: input.execution_plan_id,
    from_stage_id: input.from_stage_id,
    to_stage_id: input.to_stage_id,
    dependency_type: input.dependency_type,
    required: input.required === true,
    dependency_validated: input.dependency_validated === true,
    dependency_satisfied: false,
    dependency_applied: false,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    validator_version: EXECUTION_PLAN_DEPENDENCY_VALIDATOR_VERSION
  };
  dependency.dependency_fingerprint = computeDependencyFingerprint({ ...dependency, dependency_fingerprint: undefined });

  const validation = validateExecutionPlanDependency(dependency);
  if (!validation.valid) {
    throw new Error(`execution_plan_dependency_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(dependency);
}

// Detects a cycle, self-dependency, or a stage id not present in the known stage id set --
// reuses PR #94's own hasDependencyCycle rather than reimplementing graph traversal.
function analyzeExecutionPlanDependencies(dependencies, stageIds) {
  const stageIdSet = new Set(stageIds);
  const seen = new Set();
  let selfDependencyDetected = false;
  let missingReferenceDetected = false;
  let duplicateDetected = false;
  for (const dependency of dependencies) {
    if (!isPlainObject(dependency)) continue;
    if (dependency.from_stage_id === dependency.to_stage_id) selfDependencyDetected = true;
    if (!stageIdSet.has(dependency.from_stage_id) || !stageIdSet.has(dependency.to_stage_id)) missingReferenceDetected = true;
    const key = `${dependency.from_stage_id}->${dependency.to_stage_id}`;
    if (seen.has(key)) duplicateDetected = true;
    seen.add(key);
  }
  const cycleDetected = dependencies.length > 0 && hasDependencyCycle(dependencies);
  return { cycleDetected, selfDependencyDetected, missingReferenceDetected, duplicateDetected };
}

module.exports = {
  EXECUTION_PLAN_DEPENDENCY_FIELDS,
  EXECUTION_PLAN_DEPENDENCY_SAFE_FLAGS,
  EXECUTION_PLAN_DEPENDENCY_VALIDATOR_VERSION,
  MAX_LIST_ITEMS,
  analyzeExecutionPlanDependencies,
  buildExecutionPlanDependency,
  computeDependencyFingerprint,
  isOrderedUniqueStringList,
  validateExecutionPlanDependency
};
