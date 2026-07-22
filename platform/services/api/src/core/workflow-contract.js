'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateWorkflowConditionList } = require('./workflow-condition-contract');
const { validateWorkflowApprovalContract } = require('./workflow-approval-contract');
const { validateWorkflowTimeoutContract } = require('./workflow-timeout-contract');
const { validateWorkflowRetryContract } = require('./workflow-retry-contract');
const { validateWorkflowCompensationContract } = require('./workflow-compensation-contract');

const WORKFLOW_CONTRACT_VALIDATOR_VERSION = 'workflow_contract_validator_v1';
const WORKFLOW_FIELDS = Object.freeze([
  'workflow_id', 'workflow_version', 'tenant_id', 'organization_id', 'display_name', 'description', 'status',
  'step_references', 'entry_conditions', 'exit_conditions', 'approval_policy_reference', 'timeout_reference',
  'retry_reference', 'compensation_reference', 'simulation_context', 'logical_sequence', 'validator_version'
]);
const WORKFLOW_STATUSES = Object.freeze(['DRAFT', 'VALIDATED_SIMULATION', 'SUSPENDED', 'ARCHIVED']);
const FORBIDDEN_WORKFLOW_STATUSES = Object.freeze(['RUNNING', 'EXECUTING', 'ACTIVE', 'LIVE']);
const MAX_STEP_REFERENCES = 200;

function isUniqueNonEmptyStringList(list, maxItems) {
  if (!Array.isArray(list) || list.length < 1 || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  return new Set(list).size === list.length;
}

function validateWorkflowContract(workflow) {
  const errors = [];
  if (!isPlainObject(workflow)) return { valid: false, errors: ['workflow_must_be_object'] };
  exactFields(workflow, WORKFLOW_FIELDS, 'workflow', errors);
  for (const field of ['workflow_id', 'tenant_id', 'organization_id', 'display_name', 'description', 'validator_version']) {
    if (!isNonEmptyString(workflow[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(workflow.workflow_version) || workflow.workflow_version < 1) errors.push('workflow_version_invalid');
  if (!WORKFLOW_STATUSES.includes(workflow.status)) errors.push(`status_not_allowed::${workflow.status}`);
  if (FORBIDDEN_WORKFLOW_STATUSES.includes(workflow.status)) errors.push(`status_forbidden::${workflow.status}`);
  if (!isUniqueNonEmptyStringList(workflow.step_references, MAX_STEP_REFERENCES)) errors.push('step_references_invalid');

  errors.push(...validateWorkflowConditionList(workflow.entry_conditions, 'entry_conditions'));
  errors.push(...validateWorkflowConditionList(workflow.exit_conditions, 'exit_conditions'));

  errors.push(...validateWorkflowApprovalContract(workflow.approval_policy_reference).errors.map((error) => `approval_policy_reference_${error}`));
  errors.push(...validateWorkflowTimeoutContract(workflow.timeout_reference).errors.map((error) => `timeout_reference_${error}`));
  errors.push(...validateWorkflowRetryContract(workflow.retry_reference).errors.map((error) => `retry_reference_${error}`));
  errors.push(...validateWorkflowCompensationContract(workflow.compensation_reference).errors.map((error) => `compensation_reference_${error}`));
  errors.push(...validateAgentSimulationContext(workflow.simulation_context).errors.map((error) => `simulation_context_${error}`));

  if (!Number.isInteger(workflow.logical_sequence) || workflow.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (
    isNonEmptyString(workflow.tenant_id) && isNonEmptyString(workflow.organization_id) &&
    !workflow.organization_id.startsWith(`${workflow.tenant_id}:`)
  ) {
    errors.push('organization_id_not_compatible_with_tenant');
  }
  if (workflow.validator_version !== WORKFLOW_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(workflow);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(workflow));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  FORBIDDEN_WORKFLOW_STATUSES,
  MAX_STEP_REFERENCES,
  WORKFLOW_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_FIELDS,
  WORKFLOW_STATUSES,
  isUniqueNonEmptyStringList,
  validateWorkflowContract
};
