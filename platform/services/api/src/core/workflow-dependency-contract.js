'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const WORKFLOW_DEPENDENCY_CONTRACT_VALIDATOR_VERSION = 'workflow_dependency_contract_validator_v1';
const WORKFLOW_DEPENDENCY_FIELDS = Object.freeze([
  'dependency_id', 'dependency_type', 'depends_on_step_id', 'simulation', 'production_blocked', 'validator_version'
]);
const WORKFLOW_DEPENDENCY_TYPES = Object.freeze([
  'AFTER_SUCCESS_REFERENCE', 'AFTER_FAILURE_REFERENCE', 'PARALLEL_REFERENCE', 'JOIN_REFERENCE'
]);
const MAX_DEPENDENCIES = 100;

function validateWorkflowDependency(dependency) {
  const errors = [];
  if (!isPlainObject(dependency)) return { valid: false, errors: ['dependency_must_be_object'] };
  exactFields(dependency, WORKFLOW_DEPENDENCY_FIELDS, 'dependency', errors);
  for (const field of ['dependency_id', 'depends_on_step_id', 'validator_version']) {
    if (!isNonEmptyString(dependency[field])) errors.push(`${field}_invalid`);
  }
  if (!WORKFLOW_DEPENDENCY_TYPES.includes(dependency.dependency_type)) errors.push(`dependency_type_not_allowed::${dependency.dependency_type}`);
  if (dependency.simulation !== true) errors.push('simulation_must_be_true');
  if (dependency.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (dependency.validator_version !== WORKFLOW_DEPENDENCY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(dependency);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(dependency));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateWorkflowDependencyList(dependencies, label) {
  const errors = [];
  if (!Array.isArray(dependencies) || dependencies.length > MAX_DEPENDENCIES) {
    return [`${label}_must_be_array`];
  }
  const seenIds = new Set();
  dependencies.forEach((dependency, index) => {
    const validation = validateWorkflowDependency(dependency);
    errors.push(...validation.errors.map((error) => `${label}[${index}]_${error}`));
    if (isPlainObject(dependency) && isNonEmptyString(dependency.dependency_id)) {
      if (seenIds.has(dependency.dependency_id)) errors.push(`${label}_duplicate::${dependency.dependency_id}`);
      seenIds.add(dependency.dependency_id);
    }
  });
  return errors;
}

module.exports = {
  MAX_DEPENDENCIES,
  WORKFLOW_DEPENDENCY_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_DEPENDENCY_FIELDS,
  WORKFLOW_DEPENDENCY_TYPES,
  validateWorkflowDependency,
  validateWorkflowDependencyList
};
