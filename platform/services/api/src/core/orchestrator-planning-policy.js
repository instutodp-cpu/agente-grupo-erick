'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_PLANNING_POLICY_VALIDATOR_VERSION = 'orchestrator_planning_policy_validator_v1';

const ORCHESTRATOR_PLANNING_POLICY_FIELDS = Object.freeze([
  'planning_policy_id', 'planning_policy_version', 'allow_task_decomposition', 'allow_parallel_stages',
  'allow_agent_delegation', 'allow_tool_references', 'allow_workflow_reference', 'allow_model_reference',
  'allow_no_llm', 'allow_fallback_plan', 'allow_escalation_plan', 'require_memory_preservation',
  'require_project_state', 'require_continuity', 'require_policy_approval', 'maximum_stages',
  'maximum_parallel_stages', 'maximum_agent_references', 'maximum_tool_references', 'maximum_workflow_depth',
  'maximum_fallbacks', 'maximum_escalations', 'fail_on_required_reference_missing', 'fail_on_binding_mismatch',
  'fail_on_budget_exceeded', 'simulation', 'production_blocked', 'validator_version'
]);

const ALLOW_FLAG_FIELDS = Object.freeze([
  'allow_task_decomposition', 'allow_parallel_stages', 'allow_agent_delegation', 'allow_tool_references',
  'allow_workflow_reference', 'allow_model_reference', 'allow_no_llm', 'allow_fallback_plan', 'allow_escalation_plan'
]);

const MAXIMUM_FIELDS = Object.freeze([
  'maximum_stages', 'maximum_parallel_stages', 'maximum_agent_references', 'maximum_tool_references',
  'maximum_workflow_depth', 'maximum_fallbacks', 'maximum_escalations'
]);

const ORCHESTRATOR_PLANNING_POLICY_SAFE_FLAGS = Object.freeze({
  require_memory_preservation: true,
  require_project_state: true,
  require_continuity: true,
  fail_on_required_reference_missing: true,
  fail_on_binding_mismatch: true,
  fail_on_budget_exceeded: true,
  simulation: true,
  production_blocked: true
});

const MAX_MAXIMUM_BOUND = 1000;

function validateOrchestratorPlanningPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['planning_policy_must_be_object'] };
  exactFields(policy, ORCHESTRATOR_PLANNING_POLICY_FIELDS, 'planning_policy', errors);
  for (const field of ['planning_policy_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.planning_policy_version) || policy.planning_policy_version < 1) errors.push('planning_policy_version_invalid');
  for (const field of ALLOW_FLAG_FIELDS) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of MAXIMUM_FIELDS) {
    if (!Number.isInteger(policy[field]) || policy[field] < 0 || policy[field] > MAX_MAXIMUM_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [field, expected] of Object.entries(ORCHESTRATOR_PLANNING_POLICY_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== ORCHESTRATOR_PLANNING_POLICY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  ALLOW_FLAG_FIELDS,
  MAXIMUM_FIELDS,
  MAX_MAXIMUM_BOUND,
  ORCHESTRATOR_PLANNING_POLICY_FIELDS,
  ORCHESTRATOR_PLANNING_POLICY_SAFE_FLAGS,
  ORCHESTRATOR_PLANNING_POLICY_VALIDATOR_VERSION,
  validateOrchestratorPlanningPolicy
};
