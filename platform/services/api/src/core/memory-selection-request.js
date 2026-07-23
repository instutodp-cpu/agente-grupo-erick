'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const {
  validateContinuitySummaryReference,
  validateMemorySelectionItemReference,
  validateProjectStateReference
} = require('./memory-selection-item-reference');
const { validateSelectionPolicy } = require('./memory-selection-policy');
const { validateSelectionBudget } = require('./memory-selection-budget');

const MEMORY_SELECTION_REQUEST_VALIDATOR_VERSION = 'memory_selection_request_validator_v1';

const MEMORY_SELECTION_REQUEST_FIELDS = Object.freeze([
  'selection_request_id', 'selection_request_version', 'agent_id', 'tenant_id', 'organization_id', 'project_id',
  'session_reference_id', 'user_preference_references', 'project_state_reference', 'continuity_summary_references',
  'memory_item_references', 'selection_policy', 'selection_budget', 'correlation_id', 'causation_id', 'trace_id',
  'logical_sequence', 'expected_registry_version', 'simulation_context', 'validator_version'
]);

const MAX_USER_PREFERENCE_REFERENCES = 200;
const MAX_MEMORY_ITEM_REFERENCES = 1000;
const MAX_CONTINUITY_SUMMARY_REFERENCES = 50;

function validateItemReferenceList(list, validator, maxItems, label, errors) {
  if (!Array.isArray(list) || list.length > maxItems) {
    errors.push(`${label}_invalid`);
    return;
  }
  list.forEach((item, index) => {
    const validation = validator(item);
    errors.push(...validation.errors.map((error) => `${label}[${index}]_${error}`));
  });
}

function validateMemorySelectionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['memory_selection_request_must_be_object'] };
  exactFields(request, MEMORY_SELECTION_REQUEST_FIELDS, 'memory_selection_request', errors);
  for (const field of [
    'selection_request_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
    'correlation_id', 'causation_id', 'trace_id', 'expected_registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.selection_request_version) || request.selection_request_version < 1) {
    errors.push('selection_request_version_invalid');
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');

  validateItemReferenceList(
    request.user_preference_references, validateMemorySelectionItemReference,
    MAX_USER_PREFERENCE_REFERENCES, 'user_preference_references', errors
  );
  validateItemReferenceList(
    request.memory_item_references, validateMemorySelectionItemReference,
    MAX_MEMORY_ITEM_REFERENCES, 'memory_item_references', errors
  );
  validateItemReferenceList(
    request.continuity_summary_references, validateContinuitySummaryReference,
    MAX_CONTINUITY_SUMMARY_REFERENCES, 'continuity_summary_references', errors
  );
  errors.push(...validateProjectStateReference(request.project_state_reference).errors.map((error) => `project_state_reference_${error}`));
  errors.push(...validateSelectionPolicy(request.selection_policy).errors.map((error) => `selection_policy_${error}`));
  errors.push(...validateSelectionBudget(request.selection_budget).errors.map((error) => `selection_budget_${error}`));
  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((error) => `simulation_context_${error}`));

  if (
    isNonEmptyString(request.tenant_id) && isNonEmptyString(request.organization_id) &&
    !request.organization_id.startsWith(`${request.tenant_id}:`)
  ) {
    errors.push('organization_id_not_compatible_with_tenant');
  }
  if (request.validator_version !== MEMORY_SELECTION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_CONTINUITY_SUMMARY_REFERENCES,
  MAX_MEMORY_ITEM_REFERENCES,
  MAX_USER_PREFERENCE_REFERENCES,
  MEMORY_SELECTION_REQUEST_FIELDS,
  MEMORY_SELECTION_REQUEST_VALIDATOR_VERSION,
  validateMemorySelectionRequest
};
