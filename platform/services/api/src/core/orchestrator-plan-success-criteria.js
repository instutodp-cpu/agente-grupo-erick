'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_SUCCESS_CRITERIA_VALIDATOR_VERSION = 'orchestrator_success_criteria_validator_v1';

const ORCHESTRATOR_SUCCESS_CRITERIA_FIELDS = Object.freeze([
  'criteria_id', 'criteria_version', 'criteria_type', 'target_reference_id', 'required', 'evaluation_reference',
  'criteria_satisfied', 'evaluation_executed', 'validator_version'
]);

const CRITERIA_TYPES = Object.freeze([
  'VALIDATION_REFERENCE', 'POLICY_REFERENCE', 'MEMORY_PRESERVATION_REFERENCE', 'CONTEXT_BUDGET_REFERENCE',
  'CAPABILITY_REFERENCE', 'QUALITY_REFERENCE', 'STRUCTURED_OUTPUT_REFERENCE', 'TOOL_RESULT_REFERENCE',
  'WORKFLOW_RESULT_REFERENCE', 'HUMAN_APPROVAL_REFERENCE', 'AUDIT_REFERENCE'
]);

const ORCHESTRATOR_SUCCESS_CRITERIA_SAFE_FLAGS = Object.freeze({
  criteria_satisfied: false,
  evaluation_executed: false
});

function validateOrchestratorSuccessCriteria(criteria) {
  const errors = [];
  if (!isPlainObject(criteria)) return { valid: false, errors: ['success_criteria_must_be_object'] };
  exactFields(criteria, ORCHESTRATOR_SUCCESS_CRITERIA_FIELDS, 'success_criteria', errors);
  for (const field of ['criteria_id', 'target_reference_id', 'evaluation_reference', 'validator_version']) {
    if (!isNonEmptyString(criteria[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(criteria.criteria_version) || criteria.criteria_version < 1) errors.push('criteria_version_invalid');
  if (!CRITERIA_TYPES.includes(criteria.criteria_type)) errors.push(`criteria_type_not_allowed::${criteria.criteria_type}`);
  if (typeof criteria.required !== 'boolean') errors.push('required_must_be_boolean');
  for (const [field, expected] of Object.entries(ORCHESTRATOR_SUCCESS_CRITERIA_SAFE_FLAGS)) {
    if (criteria[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (criteria.validator_version !== ORCHESTRATOR_SUCCESS_CRITERIA_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(criteria);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(criteria));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CRITERIA_TYPES,
  ORCHESTRATOR_SUCCESS_CRITERIA_FIELDS,
  ORCHESTRATOR_SUCCESS_CRITERIA_SAFE_FLAGS,
  ORCHESTRATOR_SUCCESS_CRITERIA_VALIDATOR_VERSION,
  validateOrchestratorSuccessCriteria
};
