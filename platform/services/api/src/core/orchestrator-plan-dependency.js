'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_PLAN_DEPENDENCY_VALIDATOR_VERSION = 'orchestrator_plan_dependency_validator_v1';

const ORCHESTRATOR_PLAN_DEPENDENCY_FIELDS = Object.freeze([
  'dependency_id', 'from_stage_id', 'to_stage_id', 'dependency_type', 'required', 'satisfied_in_simulation',
  'dependency_applied', 'reason_codes', 'validator_version'
]);

const DEPENDENCY_TYPES = Object.freeze([
  'AFTER_SUCCESS_REFERENCE', 'AFTER_VALIDATION_REFERENCE', 'AFTER_APPROVAL_REFERENCE', 'AFTER_FAILURE_REFERENCE',
  'PARALLEL_REFERENCE', 'JOIN_REFERENCE', 'CONDITIONAL_REFERENCE'
]);

const ORCHESTRATOR_PLAN_DEPENDENCY_SAFE_FLAGS = Object.freeze({
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

function validateOrchestratorPlanDependency(dependency) {
  const errors = [];
  if (!isPlainObject(dependency)) return { valid: false, errors: ['plan_dependency_must_be_object'] };
  exactFields(dependency, ORCHESTRATOR_PLAN_DEPENDENCY_FIELDS, 'plan_dependency', errors);
  for (const field of ['dependency_id', 'from_stage_id', 'to_stage_id', 'validator_version']) {
    if (!isNonEmptyString(dependency[field])) errors.push(`${field}_invalid`);
  }
  if (!DEPENDENCY_TYPES.includes(dependency.dependency_type)) errors.push(`dependency_type_not_allowed::${dependency.dependency_type}`);
  if (typeof dependency.required !== 'boolean') errors.push('required_must_be_boolean');
  if (typeof dependency.satisfied_in_simulation !== 'boolean') errors.push('satisfied_in_simulation_must_be_boolean');
  if (!isOrderedUniqueStringList(dependency.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(ORCHESTRATOR_PLAN_DEPENDENCY_SAFE_FLAGS)) {
    if (dependency[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (isNonEmptyString(dependency.from_stage_id) && dependency.from_stage_id === dependency.to_stage_id) {
    errors.push('dependency_cannot_reference_its_own_stage');
  }
  if (dependency.validator_version !== ORCHESTRATOR_PLAN_DEPENDENCY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(dependency);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(dependency));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// Detects a cycle in the directed graph formed by from_stage_id -> to_stage_id edges.
// Returns true if a cycle exists (DFS with a recursion-stack, so it also catches
// self-loops and multi-node cycles, not just direct A<->B pairs).
function hasDependencyCycle(dependencies) {
  const edges = new Map();
  for (const dependency of dependencies) {
    if (!isPlainObject(dependency) || !isNonEmptyString(dependency.from_stage_id) || !isNonEmptyString(dependency.to_stage_id)) continue;
    if (!edges.has(dependency.from_stage_id)) edges.set(dependency.from_stage_id, []);
    edges.get(dependency.from_stage_id).push(dependency.to_stage_id);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visited.has(node)) return false;
    if (visiting.has(node)) return true;
    visiting.add(node);
    for (const next of edges.get(node) || []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  for (const node of edges.keys()) {
    if (visit(node)) return true;
  }
  return false;
}

module.exports = {
  DEPENDENCY_TYPES,
  MAX_LIST_ITEMS,
  ORCHESTRATOR_PLAN_DEPENDENCY_FIELDS,
  ORCHESTRATOR_PLAN_DEPENDENCY_SAFE_FLAGS,
  ORCHESTRATOR_PLAN_DEPENDENCY_VALIDATOR_VERSION,
  hasDependencyCycle,
  isOrderedUniqueStringList,
  validateOrchestratorPlanDependency
};
